// Minigame runner (contracts section 10/11): a Screen for the phases minigameIntro -> minigame -> minigameResults.
// Owns: instructions + "Bereit!", 3-2-1 countdown, solo split view, message plumbing, the host sim loop, results screen, ?bot injection.
import { MSG, PHASE, MINIGAMES, MG_VIEW, SCREEN, TIMING, createRng, placementsFromScores, seatIndexOf } from '../contracts.js';
import { addAvatar } from '../avatar/index.js';
import { getMinigame } from './index.js';
import { box, label } from './draw.js';
import { fitView, soloLayout, spectatorLayout } from './layout.js';
import { textOpts } from './font.js';
import { buildIntro, buildResults } from './screens.js';
import { createBotDevice } from './botdevice.js';

const LINGER_MS = 1200;      // host waits this long after the last final / the arena's `done` before reporting (so everybody sees the finish)
const STALE_INPUT_MS = 500;  // an arena input older than this counts as "no input" (tab hidden, lag)
const MAX_SIM_CATCHUP = 8;   // sim steps per frame at most
const EMPTY_FRAME = { move: { x: 0, y: 0 }, jump: false, action: false, confirm: false, back: false, pressed: { jump: false, action: false, confirm: false, back: false } };
const BTN = ['jump', 'action', 'confirm', 'back'];
const TAG_SIZE = 18;     // thumbnail name tag, screen px
const BOT_LANE = { x: -4000, y: -4000, scale: 1 };   // a host-run bot (test mode) plays on a hidden lane far off screen
const SILENT = (audio) => new Proxy(audio, { get: (a, key) => (['sfx', 'say', 'music'].includes(key) ? () => {} : a[key]) });   // bots do not make noise

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
/** untrusted wire frame -> InputFrame */
function cleanFrame(m) {
  const f = { move: { x: num(m?.move?.x), y: num(m?.move?.y) }, pressed: {} };
  for (const b of BTN) { f[b] = m?.[b] === true; f.pressed[b] = m?.pressed?.[b] === true; }
  return f;
}

/**
 * @param {{ k:any, session:any, input:any, audio:any, debug?:any, onHostResults:(r:{placements:number[][], labels?:object, void?:boolean}) => void }} o
 * @returns {{ onState(state:any, events:any[]): void, destroy(): void }}
 */
export function createMinigameRunner({ k, session, input, audio, debug = {}, onHostResults }) {
  const root = k.add([k.pos(0, 0), k.z(1000)]);
  box(k, root, 0, 0, SCREEN.w, SCREEN.h, '#14182a');   // opaque backdrop, nothing of a mounted board shines through
  let state = null;
  let cur = null;          // the minigame being shown (see newCur)
  let scene = null;        // the current stage's objects + cleanups
  let destroyed = false;

  // ---------------------------------------------------------------- DOM caption slot
  // The caption bubble (DOM, src/ui) normally sits under the HUD strip of the board. While a minigame runs it moves to the bottom edge (class mg-play on #ui)
  // and, in the solo split view, shrinks to the thumbnail column (mg-col + --cap-l/--cap-w): never over the big lane, never over a name tag (those sit on top of each thumbnail).
  const uiEl = typeof document !== 'undefined' ? document.getElementById('ui') : null;
  let capCol = null;       // thumbnail column {x, w} in screen px, or null
  const view = () => fitView(k.canvas.getBoundingClientRect());
  function placeCaption() {
    if (!uiEl) return;
    const v = view();
    uiEl.style.setProperty('--cap-b', `${Math.max(0, window.innerHeight - (v.oy + SCREEN.h * v.s)) + 10 * v.s}px`);   // 10 screen px above the view's bottom edge
    uiEl.classList.toggle('mg-col', !!capCol);
    if (capCol) { uiEl.style.setProperty('--cap-l', `${v.ox + capCol.x * v.s}px`); uiEl.style.setProperty('--cap-w', `${capCol.w * v.s}px`); }
  }
  const onResize = () => requestAnimationFrame(() => { if (!destroyed) placeCaption(); });
  if (uiEl) { uiEl.classList.add('mg-play'); window.addEventListener('resize', onResize); placeCaption(); }

  // ---------------------------------------------------------------- helpers
  const noop = () => {};
  const warn = (msg, e) => console.error(`[minigames] ${msg}`, e ?? '');

  /** a stage = one game object (everything visible) + the cleanups (timers, intervals) that die with it */
  function newScene() {
    const s = { obj: root.add([k.pos(0, 0)]), cleanups: [] };
    s.later = (ms, fn) => { const id = setTimeout(() => { if (scene === s && !destroyed) fn(); }, ms); s.cleanups.push(() => clearTimeout(id)); };
    s.every = (ms, fn) => { const id = setInterval(() => { if (scene === s && !destroyed) fn(); }, ms); s.cleanups.push(() => clearInterval(id)); };
    return s;
  }
  function endScene() {
    if (!scene) return;
    const s = scene;
    scene = null;
    for (const c of s.cleanups) { try { c(); } catch (e) { warn('cleanup failed', e); } }
    for (const inst of s.instances ?? []) { try { inst.destroy(); } catch (e) { warn('instance.destroy failed', e); } }
    s.obj.destroy();
    capCol = null; placeCaption();
    if (debug.bot) input.inject(null);
  }
  function newCur(st) {
    const desc = st.minigame;
    return {
      key: `${st.round}:${desc.id}:${desc.seed}:${desc.purpose}`, desc, mod: getMinigame(desc.id), kind: desc.kind ?? MINIGAMES[desc.id]?.kind ?? 'solo',
      stage: null, reported: false, finals: new Map(), thumbs: new Map(), main: null, inputs: new Map(), hostState: null,
    };
  }
  const selfSeat = () => (state ? seatIndexOf(state, session.selfPlayerId) : -1);
  const isParticipant = () => !!cur && cur.desc.seats.includes(selfSeat());
  const seatOf = (playerId) => (state ? seatIndexOf(state, playerId) : -1);
  /** the seat a solo message is about: its sender, or (test mode) the host-run bot seat the host speaks for */
  const subjectOf = (m, from) => (Number.isInteger(m?.seat) && state?.seats[m.seat]?.hostBot && from === session.hostPlayerId() ? m.seat : seatOf(from));

  function report(results) {
    if (!cur || cur.reported) return;
    cur.reported = true;
    try { onHostResults(results); } catch (e) { warn('onHostResults threw', e); }
  }
  /** a BROKEN minigame (missing module, hostInit/hostStep/hostResult threw, entering failed): `void` => core pays no coins (contracts MinigameResults.void) */
  const tieAll = () => ({ placements: [cur.desc.seats.slice()], void: true });

  /** a solo seat is done (its own mgFinal, or the host speaking for a bot) */
  function acceptFinal(seat, m) {
    if (!cur || cur.kind !== 'solo') return;
    if (!cur.desc.seats.includes(seat) || cur.finals.has(seat)) return;
    const score = typeof m?.score === 'number' && Number.isFinite(m.score) ? m.score : null;
    cur.finals.set(seat, { score, label: typeof m?.label === 'string' ? m.label.slice(0, 60) : undefined });
    cur.onFinal?.(seat);
  }
  /** host: the latest input frame of an arena/team seat */
  function putFrame(seat, f) {
    if (!cur.desc.seats.includes(seat)) return;
    const prev = cur.inputs.get(seat);
    if (prev) for (const b of BTN) f.pressed[b] = f.pressed[b] || prev.pressed[b];   // a tap must survive until the next sim step
    f.at = performance.now();
    cur.inputs.set(seat, f);
  }

  // ---------------------------------------------------------------- network handlers (installed once, route into `cur`)
  const offs = [
    session.on(MSG.mgProgress, (m, from) => {
      if (!cur || cur.stage !== 'play' || cur.kind !== 'solo') return;
      const seat = subjectOf(m, from);
      if (seat !== selfSeat()) cur.thumbs.get(seat)?.inst?.update?.(m?.p);
    }),
    session.on(MSG.mgFinal, (m, from) => acceptFinal(subjectOf(m, from), m)),
    session.on(MSG.mgInput, (m, from) => {
      if (!cur || !session.isHost || cur.kind === 'solo' || !cur.hostState) return;
      putFrame(seatOf(from), cleanFrame(m));
    }),
    session.on(MSG.mgState, (m) => {
      if (!cur || cur.stage !== 'play' || cur.kind === 'solo') return;
      cur.main?.inst?.update?.(m?.s);
    }),
  ];

  // ---------------------------------------------------------------- stage: intro
  function enterIntro() {
    scene = newScene();
    const { mod, desc } = cur;
    const self = selfSeat(), participant = isParticipant();
    if (!mod) { label(k, scene.obj, `Minispiel "${desc.id}" fehlt.`, SCREEN.w / 2, SCREEN.h / 2, { size: 36 }); return; }
    // 3D modules may export `preload()` (e.g. () => preload3D()): fetch the lazy three.js chunk while the instructions are on screen
    if (participant) { try { Promise.resolve(mod.preload?.()).catch(() => {}); } catch { /* optional */ } }
    const intro = buildIntro({ k, parent: scene.obj, mod, desc, state, participant, addAvatar: avatarFor(scene.obj) });
    const t0 = performance.now();
    let sentReady = false, wasReady = false;
    const sendReady = () => { session.sendIntent({ type: 'ready' }); sentReady = true; };
    scene.obj.onUpdate(() => {
      const isReady = (state.minigame?.ready ?? []).includes(self);
      if (isReady && !wasReady) audio.sfx('ready');
      wasReady = isReady;
      if (participant && !isReady && input.pressed('confirm')) sendReady();
      intro.update(state, TIMING.INTRO_MAX_MS - (performance.now() - t0), isReady || sentReady);
    });
    if (debug.bot && participant) scene.later(TIMING.BOT_DELAY_MS, sendReady);
  }

  const avatarFor = (defaultParent) => (profile, o = {}) => addAvatar(k, o.parent ?? defaultParent, profile, { size: o.size, showName: o.showName });

  // ---------------------------------------------------------------- stage: play
  function enterPlay(fresh) {
    scene = newScene();
    scene.instances = [];
    const { mod, desc } = cur;
    const host = session.isHost;
    if (!mod) {
      label(k, scene.obj, `Minispiel "${desc.id}" fehlt.`, SCREEN.w / 2, SCREEN.h / 2, { size: 36 });
      if (host) scene.later(1500, () => report(tieAll()));
      return;
    }
    const kind = cur.kind, solo = kind === 'solo', logical = MG_VIEW[kind];
    const self = selfSeat(), participant = isParticipant();
    const seatObjs = desc.seats.map((i) => state.seats[i]);
    const startWall = performance.now();
    const goWall = startWall + (fresh ? TIMING.COUNTDOWN_MS : 0);
    const capWall = goWall + mod.durationMs + TIMING.MG_GRACE_MS;
    let went = false, finishedSelf = false, pendingP, lastSend = 0, seq = 0, lastInputSend = 0, lastTick = -1;
    let centerX = SCREEN.w / 2;

    // ---- mounting one instance on a positioned, scaled lane root
    let hudSink = null, hudLast = null;   // a module with its own canvas mirrors the countdown (ctx.mirrorHud), the Kaplay one would sit below its canvas
    // `bot` = a host-run test-mode bot { seat, dev }: the same instance a client would mount, on a hidden lane, fed by a device-less input
    function mountLane(rect, view, seat, bot = null) {
      const stage = scene;   // the scene this lane belongs to (ctx.alive / ctx.onEnd)
      // the lane is clipped to its logical rect (a thumbnail must not paint over its neighbours)
      const lane = scene.obj.add([k.pos(rect.x, rect.y), k.scale(rect.scale), k.rect(logical.w, logical.h), k.mask('intersect')]);
      if (bot) lane.hidden = true;
      const ctx = {
        k, root: lane, view, seat, selfSeat: bot ? bot.seat : self, seats: seatObjs, mode: desc.mode, teams: desc.teams, seed: desc.seed, rng: createRng(desc.seed),
        logical, input: bot ? bot.dev : input, audio: bot ? SILENT(audio) : audio, addAvatar: avatarFor(lane), isBot: bot ? true : !!debug.bot,
        spectator: bot ? false : !participant, durationMs: mod.durationMs,   // the last two are extras beyond contracts section 10
        rect: { x: rect.x, y: rect.y, w: logical.w * rect.scale, h: logical.h * rect.scale },   // the lane on the SCREEN (1280x720), for modules with their own canvas
        alive: () => scene === stage && !destroyed,                                             // false once this stage was torn down
        onEnd: (fn) => { if (scene === stage) stage.cleanups.push(fn); else { try { fn(); } catch (e) { warn('onEnd failed', e); } } },   // runs when the stage ends (before instance.destroy)
        mirrorHud: view === 'main' && !bot ? (fn) => { hudSink = fn; hudLast = null; } : noop,         // fn({ countdown:{text,color,opacity,scale}|null, caption:string }), called on change
        sendProgress: bot ? (p) => { bot.pending = p; } : view === 'main' && solo && participant ? (p) => { pendingP = p; } : noop,
        finish: bot ? (r) => botFinish(bot, r) : view === 'main' && solo && participant ? finishSelf : noop,
      };
      let inst = null;
      try { inst = mod.clientMount(ctx); } catch (e) {
        warn(`${desc.id}.clientMount threw`, e);
        label(k, lane, 'Hier ist was kaputt gegangen. 🙈', logical.w / 2, logical.h / 2, { size: 40 });
      }
      if (inst) scene.instances.push(inst);
      return { lane, inst };
    }
    // name tag over a thumbnail: ONE line, "Name  ✓ Ergebnis", the name is shortened with an ellipsis so the tag never grows past its thumbnail
    const tagW = (str) => k.formatText({ text: str, ...textOpts(k, TAG_SIZE) }).width;
    const capOf = (seat, maxW) => {
      const f = cur.finals.get(seat);
      const name = state.seats[seat].profile.name, tail = f ? `  ✓ ${f.label ?? 'fertig'}` : '';
      if (tagW(name + tail) <= maxW) return name + tail;
      const chars = Array.from(name);
      const keepTail = tagW(`…${tail}`) <= maxW;     // else the result label alone is too long: shorten everything
      const full = keepTail ? chars : Array.from(name + tail);
      const suffix = keepTail ? tail : '';
      while (full.length > 1 && tagW(`${full.join('')}…${suffix}`) > maxW) full.pop();
      return `${full.join('')}…${suffix}`;
    };
    const frame = (rect, seat) => {
      box(k, scene.obj, rect.x - 3, rect.y - 3, rect.w + 6, rect.h + 6, '#000000', { radius: 4, outline: [3, '#3b4a6b'] });
      const cap = label(k, scene.obj, capOf(seat, rect.w), rect.x + rect.w / 2, rect.y - 14, { size: TAG_SIZE, color: '#ffffff', outline: [3, '#14182a'] });
      cap.tagW = rect.w;
      return cap;
    };
    // the sound widget (DOM, top right) must not cover a tag: the thumbnail panel starts below it (screen px of its bottom edge + margin)
    const snd = typeof document !== 'undefined' ? document.querySelector('#ui .sound')?.getBoundingClientRect() : null;
    const v0 = view();
    const reserveTop = snd && snd.height ? Math.min(140, Math.max(0, (snd.bottom - v0.oy) / v0.s + 6)) : 0;

    // ---- layout per kind / role
    if (solo && participant) {
      const others = desc.seats.filter((s) => s !== self);
      const lay = soloLayout(others.length, logical, SCREEN, { reserveTop });
      centerX = lay.main.x + lay.main.w / 2;
      cur.main = mountLane(lay.main, 'main', self);
      cur.mainCaption = label(k, scene.obj, '', centerX, lay.main.y + lay.main.h - 18, { size: 22, color: '#ffffff', outline: [4, '#14182a'] });
      others.forEach((s, i) => {
        const r = lay.thumbs[i];
        const cap = frame(r, s);
        const t = mountLane(r, 'thumb', s);
        cur.thumbs.set(s, { ...t, cap });
      });
      const xs = lay.thumbs.map((t) => t.cell.x), xe = lay.thumbs.map((t) => t.cell.x + t.cell.w);
      if (xs.length) capCol = { x: Math.min(...xs), w: Math.max(...xe) - Math.min(...xs) };
      placeCaption();
    } else if (solo) {
      const lay = spectatorLayout(desc.seats.length, logical, SCREEN, { reserveTop });
      desc.seats.forEach((s, i) => {
        const cap = frame(lay[i], s);
        cur.thumbs.set(s, { ...mountLane(lay[i], 'thumb', s), cap });
      });
    } else {
      cur.main = mountLane({ x: 0, y: 0, scale: 1 }, 'main', participant ? self : desc.seats[0]);
    }
    // ---- test mode: the host plays its bot seats with the very same client instance a ?bot tab would run (hidden lane, device-less input)
    const bots = [];
    if (host && state.settings?.testMode) {
      for (const s of desc.seats) {
        if (!state.seats[s]?.hostBot) continue;
        const bot = { seat: s, dev: createBotDevice(), inst: null, pending: undefined, lastSend: 0, lastInput: 0, finished: false };
        bot.inst = mountLane(BOT_LANE, 'main', s, bot).inst;
        bots.push(bot);
      }
    }
    function flushBot(bot) {
      if (bot.pending === undefined) return;
      const p = bot.pending;
      bot.pending = undefined; bot.lastSend = performance.now();
      cur.thumbs.get(bot.seat)?.inst?.update?.(p);
      session.broadcast(MSG.mgProgress, { t: Math.round(bot.lastSend - goWall), p, seat: bot.seat });
    }
    function botFinish(bot, r) {
      if (bot.finished || !went) return;
      bot.finished = true;
      flushBot(bot);
      const m = { score: typeof r?.score === 'number' && Number.isFinite(r.score) ? Math.round(r.score * 1000) / 1000 : null, ...(r?.label ? { label: String(r.label).slice(0, 60) } : {}) };
      acceptFinal(bot.seat, m);
      session.broadcast(MSG.mgFinal, { ...m, seat: bot.seat });
    }
    /** per frame: the bot's wish -> its input device; solo bots stream progress at 10 Hz, arena bots feed the host sim at 30 Hz */
    function driveBots(now) {
      for (const bot of bots) {
        if (!bot.inst) continue;
        let inj = null;
        if (went && !bot.finished) { try { inj = bot.inst.botInput?.() ?? null; } catch (e) { warn('botInput threw', e); } }
        bot.dev.inject(inj);
        bot.dev.update();
        if (solo) { if (went && now - bot.lastSend >= 1000 / TIMING.SOLO_PROGRESS_HZ) flushBot(bot); }
        else if (went && now - bot.lastInput >= 1000 / TIMING.CLIENT_INPUT_HZ) { bot.lastInput = now; putFrame(bot.seat, cleanFrame(bot.dev.takeFrame())); }
      }
    }
    cur.onFinal = (seat) => {
      const f = cur.finals.get(seat);
      if (seat === self && cur.mainCaption) cur.mainCaption.text = `Fertig: ${f?.label ?? ''}  – warte auf die anderen…`;
      const th = cur.thumbs.get(seat);
      if (th) th.cap.text = capOf(seat, th.cap.tagW);
    };
    for (const seat of cur.finals.keys()) cur.onFinal(seat);
    // read-only debug hook for e2e geometry checks: main lane, thumbnail lanes and name tags in screen px
    globalThis.__wkMg = { main: cur.main ? { x: cur.main.lane.pos.x, y: cur.main.lane.pos.y, w: logical.w * cur.main.lane.scale.x, h: logical.h * cur.main.lane.scale.y } : null,
      thumbs: () => [...cur.thumbs].map(([seat, t]) => ({ seat, x: t.lane.pos.x, y: t.lane.pos.y, w: logical.w * t.lane.scale.x, h: logical.h * t.lane.scale.y })),
      tags: () => [...cur.thumbs].map(([seat, t]) => ({ seat, text: t.cap.text, x: t.cap.pos.x - t.cap.width / 2, y: t.cap.pos.y - t.cap.height / 2, w: t.cap.width, h: t.cap.height })) };

    // ---- countdown overlay
    const cd = label(k, scene.obj, '', centerX, SCREEN.h / 2, { size: 220, color: '#ffd43b', outline: [14, '#14182a'], opacity: 0 });
    let cdAge = 0, cdColor = '#ffd43b';
    const showCd = (text, color) => { cd.text = text; cdColor = color; cd.color = k.rgb(color); cd.opacity = 1; cdAge = 0; };
    function pushHud() {
      if (!hudSink) return;
      const h = { countdown: cd.opacity > 0 && cd.text ? { text: cd.text, color: cdColor, opacity: Math.round(cd.opacity * 100) / 100, scale: Math.round((cd.scale?.x ?? 1) * 100) / 100 } : null, caption: cur.mainCaption?.text ?? '' };
      const key = JSON.stringify(h);
      if (key === hudLast) return;
      hudLast = key;
      try { hudSink(h); } catch (e) { warn('mirrorHud sink threw', e); }
    }

    // ---- solo plumbing
    function flushProgress() {
      if (pendingP === undefined) return;
      session.broadcast(MSG.mgProgress, { t: Math.round(performance.now() - goWall), p: pendingP });
      pendingP = undefined; lastSend = performance.now();
    }
    function finishSelf(r) {
      if (finishedSelf || !went || !participant) return;
      finishedSelf = true;
      flushProgress();
      const score = typeof r?.score === 'number' && Number.isFinite(r.score) ? Math.round(r.score * 1000) / 1000 : null;
      session.broadcast(MSG.mgFinal, { score, ...(r?.label ? { label: String(r.label).slice(0, 60) } : {}) }, { self: true });
    }

    // ---- host: when is it over?
    let ending = false;
    function soloCheck() {
      if (ending || cur.reported) return;
      const now = performance.now();
      const need = desc.seats.filter((s) => state.seats[s]?.connected !== false);
      const all = need.every((s) => cur.finals.has(s));
      if (!all && now < capWall) return;
      ending = true;
      scene.later(all ? LINGER_MS : 0, () => {
        const entries = desc.seats.map((s) => ({ seat: s, score: cur.finals.get(s)?.score ?? null }));
        const labels = {};
        for (const s of desc.seats) if (cur.finals.get(s)?.label) labels[s] = cur.finals.get(s).label;
        if (!cur.finals.size) return report(tieAll());   // timeout and nobody ever reported a score: broken, not a genuine tie
        report({ placements: placementsFromScores(entries), labels });
      });
    }

    // ---- host arena sim
    const STEP = 1000 / TIMING.HOST_SIM_HZ, SEND_EVERY = 1000 / TIMING.HOST_STATE_HZ;
    let acc = 0, sendAcc = 0;
    if (host && !solo) {
      try {
        cur.hostState = mod.hostInit({ seats: desc.seats.slice(), seed: desc.seed, rng: createRng(desc.seed), mode: desc.mode, teams: desc.teams });
      } catch (e) { warn(`${desc.id}.hostInit threw`, e); cur.hostState = { t: 0, done: true, broken: true }; }
    }
    const broadcastState = () => {
      session.broadcast(MSG.mgState, { t: cur.hostState.t, s: cur.hostState }, { self: true });
      if (bots.length) {
        const snap = structuredClone(cur.hostState);
        for (const bot of bots) { try { bot.inst?.update?.(snap); } catch (e) { warn('bot update threw', e); } }
      }
    };
    function arenaEnd() {
      if (ending || cur.reported) return;
      ending = true;
      let results;
      try { results = cur.hostState.broken ? tieAll() : mod.hostResult(cur.hostState); } catch (e) { warn(`${desc.id}.hostResult threw`, e); results = tieAll(); }
      cur.hostState.done = true;
      broadcastState();
      scene.later(LINGER_MS, () => report(results));
    }
    function arenaStep(dtMs) {
      const hs = cur.hostState, now = performance.now();
      acc += Math.min(dtMs, 250);
      for (let i = 0; i < MAX_SIM_CATCHUP && acc >= STEP && !hs.done; i++, acc -= STEP) {
        const inputs = {};
        for (const s of desc.seats) {
          const f = cur.inputs.get(s);
          inputs[s] = f && state.seats[s]?.connected !== false && now - f.at < STALE_INPUT_MS ? f : EMPTY_FRAME;
        }
        try { mod.hostStep(hs, inputs, STEP); } catch (e) { warn(`${desc.id}.hostStep threw`, e); hs.done = true; hs.broken = true; }
        for (const f of cur.inputs.values()) for (const b of BTN) f.pressed[b] = false;   // taps are consumed by one step
      }
      if (acc > STEP * MAX_SIM_CATCHUP) acc = 0;
    }

    // ---- the frame loop
    scene.obj.onUpdate(() => {
      const dt = k.dt(), now = performance.now();
      cdAge += dt;
      if (cd.opacity > 0) { cd.opacity = went && cdAge > 0.7 ? Math.max(0, 1 - (cdAge - 0.7) / 0.25) : cd.opacity; cd.scale = k.vec2(1 + Math.max(0, 0.35 - cdAge) * 2); }
      // countdown
      if (!went) {
        const left = goWall - now;
        const n = Math.ceil(left / 1000);
        if (left > 0 && n !== lastTick) { lastTick = n; showCd(String(n), '#ffd43b'); audio.sfx('tick'); }
        if (left <= 0) {
          went = true;
          if (fresh) { showCd('LOS!', '#8ce99a'); audio.sfx('go'); }
          input.takeFrame();   // drop taps latched during the countdown
          try { cur.main?.inst?.go?.(); } catch (e) { warn('go() threw', e); }
          for (const bot of bots) { try { bot.inst?.go?.(); } catch (e) { warn('bot go() threw', e); } }
        }
      }
      pushHud();
      // ?bot
      if (debug.bot && participant && cur.main?.inst) {
        let inj = null;
        if (went) { try { inj = cur.main.inst.botInput?.() ?? null; } catch (e) { warn('botInput threw', e); } }
        input.inject(inj);
      }
      driveBots(now);
      // solo: stream my progress at 10 Hz
      if (solo && participant && went && pendingP !== undefined && now - lastSend >= 1000 / TIMING.SOLO_PROGRESS_HZ) flushProgress();
      // arena: stream my input at 30 Hz
      if (!solo && participant && went && now - lastInputSend >= 1000 / TIMING.CLIENT_INPUT_HZ) {
        lastInputSend = now;
        session.sendToHost(MSG.mgInput, { ...input.takeFrame(), seq: ++seq });
      }
      // arena host: sim + 20 Hz broadcast
      if (host && !solo && cur.hostState && !ending) {
        if (went) arenaStep(dt * 1000);
        sendAcc += dt * 1000;
        if (sendAcc >= SEND_EVERY) { sendAcc %= SEND_EVERY; broadcastState(); }
        if (cur.hostState.done) arenaEnd();
      }
    });
    if (host) scene.every(250, () => {
      if (solo) soloCheck();
      else if (!ending && performance.now() >= capWall) arenaEnd();   // hard cap (also when rAF is throttled)
    });
  }

  // ---------------------------------------------------------------- stage: results
  function enterResults() {
    scene = newScene();
    const { mod, desc } = cur;
    if (!desc.results) { label(k, scene.obj, '…', SCREEN.w / 2, SCREEN.h / 2, { size: 60 }); return; }
    const self = selfSeat();
    const res = buildResults({ k, parent: scene.obj, mod, desc, state, selfSeat: self, addAvatar: avatarFor(scene.obj) });
    const t0 = performance.now();
    scene.obj.onUpdate(() => res.update(performance.now() - t0));
    const mine = res.rank[self];
    if (mine === 1) { audio.sfx('win'); } else if (mine && mine === Math.max(...Object.values(res.rank)) && desc.results.placements.length > 1) audio.sfx('lose');
  }

  // ---------------------------------------------------------------- Screen
  return {
    onState(st) {
      if (destroyed) return;
      state = st;
      const mg = st.minigame;
      if (!mg || ![PHASE.minigameIntro, PHASE.minigame, PHASE.minigameResults].includes(st.phase)) return;
      const key = `${st.round}:${mg.id}:${mg.seed}:${mg.purpose}`;
      if (!cur || cur.key !== key) { endScene(); cur = newCur(st); }
      cur.desc = mg;
      const want = st.phase === PHASE.minigameIntro ? 'intro' : st.phase === PHASE.minigame ? 'play' : 'results';
      if (cur.stage === want) return;   // same stage: scenes read `state` themselves
      const prev = cur.stage;
      endScene();
      cur.stage = want;
      try {
        if (want === 'intro') enterIntro();
        else if (want === 'play') enterPlay(prev === 'intro');   // no intro seen = remount mid-game: skip the countdown and play on
        else enterResults();
      } catch (e) { warn(`entering ${want} failed`, e); if (want === 'play' && session.isHost) report(tieAll()); }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      endScene();
      if (uiEl) { uiEl.classList.remove('mg-play', 'mg-col'); window.removeEventListener('resize', onResize); }
      for (const off of offs) { try { off(); } catch { /* already gone */ } }
      root.destroy();
      if (debug.bot) input.inject(null);
    },
  };
}
