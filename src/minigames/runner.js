// Minigame runner (contracts section 10/11): a Screen for the phases minigameIntro -> minigame -> minigameResults.
// Owns: instructions + "Bereit!", 3-2-1 countdown, solo split view, message plumbing, the host sim loop, results screen, ?bot injection.
import { MSG, PHASE, MINIGAMES, MG_VIEW, SCREEN, TIMING, createRng, placementsFromScores, seatIndexOf } from '../contracts.js';
import { addAvatar } from '../avatar/index.js';
import { getMinigame } from './index.js';
import { box, label } from './draw.js';
import { soloLayout, spectatorLayout } from './layout.js';
import { buildIntro, buildResults } from './screens.js';

const LINGER_MS = 1200;      // host waits this long after the last final / the arena's `done` before reporting (so everybody sees the finish)
const STALE_INPUT_MS = 500;  // an arena input older than this counts as "no input" (tab hidden, lag)
const MAX_SIM_CATCHUP = 8;   // sim steps per frame at most
const EMPTY_FRAME = { move: { x: 0, y: 0 }, jump: false, action: false, confirm: false, back: false, pressed: { jump: false, action: false, confirm: false, back: false } };
const BTN = ['jump', 'action', 'confirm', 'back'];

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

  function report(results) {
    if (!cur || cur.reported) return;
    cur.reported = true;
    try { onHostResults(results); } catch (e) { warn('onHostResults threw', e); }
  }
  /** a BROKEN minigame (missing module, hostInit/hostStep/hostResult threw, entering failed): `void` => core pays no coins (contracts MinigameResults.void) */
  const tieAll = () => ({ placements: [cur.desc.seats.slice()], void: true });

  // ---------------------------------------------------------------- network handlers (installed once, route into `cur`)
  const offs = [
    session.on(MSG.mgProgress, (m, from) => {
      if (!cur || cur.stage !== 'play' || cur.kind !== 'solo') return;
      const seat = seatOf(from);
      if (seat !== selfSeat()) cur.thumbs.get(seat)?.inst?.update?.(m?.p);
    }),
    session.on(MSG.mgFinal, (m, from) => {
      if (!cur || cur.kind !== 'solo') return;
      const seat = seatOf(from);
      if (!cur.desc.seats.includes(seat) || cur.finals.has(seat)) return;
      const score = typeof m?.score === 'number' && Number.isFinite(m.score) ? m.score : null;
      cur.finals.set(seat, { score, label: typeof m?.label === 'string' ? m.label.slice(0, 60) : undefined });
      cur.onFinal?.(seat);
    }),
    session.on(MSG.mgInput, (m, from) => {
      if (!cur || !session.isHost || cur.kind === 'solo' || !cur.hostState) return;
      const seat = seatOf(from);
      if (!cur.desc.seats.includes(seat)) return;
      const f = cleanFrame(m), prev = cur.inputs.get(seat);
      if (prev) for (const b of BTN) f.pressed[b] = f.pressed[b] || prev.pressed[b];   // a tap must survive until the next sim step
      f.at = performance.now();
      cur.inputs.set(seat, f);
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
    function mountLane(rect, view, seat) {
      // the lane is clipped to its logical rect (a thumbnail must not paint over its neighbours)
      const lane = scene.obj.add([k.pos(rect.x, rect.y), k.scale(rect.scale), k.rect(logical.w, logical.h), k.mask('intersect')]);
      const ctx = {
        k, root: lane, view, seat, selfSeat: self, seats: seatObjs, mode: desc.mode, teams: desc.teams, seed: desc.seed, rng: createRng(desc.seed),
        logical, input, audio, addAvatar: avatarFor(lane), isBot: !!debug.bot, spectator: !participant, durationMs: mod.durationMs,   // the last two are extras beyond contracts section 10
        sendProgress: view === 'main' && solo && participant ? (p) => { pendingP = p; } : noop,
        finish: view === 'main' && solo && participant ? finishSelf : noop,
      };
      let inst = null;
      try { inst = mod.clientMount(ctx); } catch (e) {
        warn(`${desc.id}.clientMount threw`, e);
        label(k, lane, 'Hier ist was kaputt gegangen. 🙈', logical.w / 2, logical.h / 2, { size: 40 });
      }
      if (inst) scene.instances.push(inst);
      return { lane, inst };
    }
    const frame = (rect, name) => {
      box(k, scene.obj, rect.x - 3, rect.y - 3, rect.w + 6, rect.h + 6, '#000000', { radius: 4, outline: [3, '#3b4a6b'] });
      return label(k, scene.obj, name, rect.x + rect.w / 2, rect.y - 14, { size: 18, color: '#ffffff', outline: [3, '#14182a'], width: rect.w });
    };
    const capOf = (seat) => {
      const f = cur.finals.get(seat);
      return `${state.seats[seat].profile.name}${f ? `  ✓ ${f.label ?? 'fertig'}` : ''}`;
    };

    // ---- layout per kind / role
    if (solo && participant) {
      const others = desc.seats.filter((s) => s !== self);
      const lay = soloLayout(others.length, logical);
      centerX = lay.main.x + lay.main.w / 2;
      cur.main = mountLane(lay.main, 'main', self);
      cur.mainCaption = label(k, scene.obj, '', centerX, lay.main.y + lay.main.h - 18, { size: 22, color: '#ffffff', outline: [4, '#14182a'] });
      others.forEach((s, i) => {
        const r = lay.thumbs[i];
        const cap = frame(r, capOf(s));
        const t = mountLane(r, 'thumb', s);
        cur.thumbs.set(s, { ...t, cap });
      });
    } else if (solo) {
      const lay = spectatorLayout(desc.seats.length, logical);
      desc.seats.forEach((s, i) => {
        const cap = frame(lay[i], capOf(s));
        cur.thumbs.set(s, { ...mountLane(lay[i], 'thumb', s), cap });
      });
    } else {
      cur.main = mountLane({ x: 0, y: 0, scale: 1 }, 'main', participant ? self : desc.seats[0]);
    }
    cur.onFinal = (seat) => {
      const f = cur.finals.get(seat);
      if (seat === self && cur.mainCaption) cur.mainCaption.text = `Fertig: ${f?.label ?? ''}  – warte auf die anderen…`;
      const th = cur.thumbs.get(seat);
      if (th) th.cap.text = capOf(seat);
    };
    for (const seat of cur.finals.keys()) cur.onFinal(seat);

    // ---- countdown overlay
    const cd = label(k, scene.obj, '', centerX, SCREEN.h / 2, { size: 220, color: '#ffd43b', outline: [14, '#14182a'], opacity: 0 });
    let cdAge = 0;
    const showCd = (text, color) => { cd.text = text; cd.color = k.rgb(color); cd.opacity = 1; cdAge = 0; };

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
    const broadcastState = () => session.broadcast(MSG.mgState, { t: cur.hostState.t, s: cur.hostState }, { self: true });
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
        }
      }
      // ?bot
      if (debug.bot && participant && cur.main?.inst) {
        let inj = null;
        if (went) { try { inj = cur.main.inst.botInput?.() ?? null; } catch (e) { warn('botInput threw', e); } }
        input.inject(inj);
      }
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
      for (const off of offs) { try { off(); } catch { /* already gone */ } }
      root.destroy();
      if (debug.bot) input.inject(null);
    },
  };
}
