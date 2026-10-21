// Doodle-Knagger: Kaplay client (main lane + thumbnail). Rules, course and the bot's brain live in sim.js (pure, node-tested).
// Look: a squared notebook page, pencil lines that "boil" a little, marker-filled platforms. Everything is drawn immediate-mode
// from the sim state (see drawWorld); the only game objects are the blob avatar(s) and the HUD. The static artwork (paper, platforms, bottle, scribbles,
// HUD panels) is baked once into textures by art.js, text is formatted once per distinct string: a lane frame is a handful of quads, not ~400 polygons.
import { createRng } from '../../contracts.js';
import { addHint } from '../draw.js';
import { textOpts } from '../font.js';
import {
  W, H, C, STEP, DURATION_MS, makeCourse, newState, launch, step, newBot, botControl, heightM, fmtM, platX, gullPos, dronePos, wrapDelta,
} from './sim.js';
import LINES from './lines.js';
import { createArt, PAPER, INK, PENCIL, GRID_STEP } from './art.js';

const MAX_CAM = 60000;   // sanity cap for a remote's camera (the best bot climbs ~5000 px in a round)
const MARGIN = 120;   // px around the lane: course objects further off screen are not looked at (the course arrays are sorted by y)
const HINT = '{key:←}{key:→} / {key:A}{key:D} / {LS} / {DPAD} Steuern';
const DOODLE_TEXTS = ['sybau', 'Aura++', 'Döner?', 'x² + y²', 'Pfand!', 'Mittwoch', 'xD', 'Boing', 'ß ß ß', 'Das crazy'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export function mountDoodle(ctx) {
  const { k, root, input, audio } = ctx;
  const thumb = ctx.view === 'thumb';
  const profile = ctx.seats.find((s) => s.index === ctx.seat)?.profile ?? { name: '?', color: '#ffb400', hat: 'none' };
  const course = makeCourse(ctx.rng);
  const st = newState(course);
  const bot = newBot(createRng((ctx.seed ^ Math.imul(ctx.selfSeat + 1, 0x9E3779B1)) >>> 0));

  const V = (x, y) => k.vec2(x, y);
  const art = createArt(k, thumb ? 1 : 2);   // thumbnails are drawn at ~1/3 scale: a 1x texture is enough (and downsamples cleaner)
  const col = (c) => (typeof c === 'string' ? k.rgb(c) : c);
  let bt = 0;   // pencil "boil" frame
  const jit = (s) => Math.sin(s * 12.9898 + bt * 1.7) * 1.3;

  // ---- drawing helpers (all in lane px) ----
  const line = (pts, width, color, opacity = 1) => k.drawLines({ pts: pts.map((p) => V(p[0], p[1])), width, color: col(color), opacity, join: 'round', cap: 'round' });
  const pencil = (x1, y1, x2, y2, width = 2.5, color = INK, seed = 0, opacity = 1) => {
    const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 26)), pts = [];
    for (let i = 0; i <= n; i++) { const f = i / n; pts.push([x1 + (x2 - x1) * f + jit(seed + i * 2), y1 + (y2 - y1) * f + jit(seed + i * 2 + 1)]); }
    line(pts, width, color, opacity);
  };
  const poly = (pts, color, o = {}) => k.drawPolygon({ pts: pts.map((p) => V(p[0], p[1])), color: col(color), opacity: o.opacity ?? 1, outline: o.outline ? { width: o.outline[0], color: col(o.outline[1]) } : undefined });
  // text: Kaplay re-lays-out a string on every drawText; formatText once per distinct (string, size, colour, opacity) and only move it per frame
  const fmtCache = new Map();
  const txt = (str, x, y, size, color = INK, o = {}) => {
    const op = Math.round((o.opacity ?? 1) * 20) / 20, anchor = o.anchor ?? 'center';
    const key = `${size}|${color}|${op}|${anchor}|${str}`;
    let ft = fmtCache.get(key);
    if (!ft) {
      if (fmtCache.size > 400) fmtCache.clear();
      ft = k.formatText({ text: str, pos: V(0, 0), anchor, color: col(color), opacity: op, angle: 0, ...textOpts(k, size) });
      fmtCache.set(key, ft);
    }
    ft.opt.pos = V(x, y); ft.opt.angle = o.angle ?? 0;
    k.drawFormattedText(ft);
  };
  /** draws fn(sx) for the screen x and its wrapped copies that touch the lane */
  const wrapped = (sx, half, fn) => { for (const off of [-W, 0, W]) { const x = sx + off; if (x + half > -4 && x - half < W + 4) fn(x); } };

  // ---- the notebook page ----
  function drawPaper(camY) {
    const S = GRID_STEP, oy = ((-camY % S) + S) % S;
    art.blit(art.paper(), 0, oy - S);
    const hy = ((-camY % 220) + 220) % 220;
    for (let y = hy - 220; y < H + 20; y += 220) if (y > -20) art.blit(art.hole(), 34, y, { anchor: 'center' });
    // scribbles that sit in the world (one per 360 px band)
    const c0 = Math.floor(camY / 360) - 1, c1 = Math.floor((camY + H) / 360) + 1;
    for (let ci = c0; ci <= c1; ci++) {
      const h1 = hash(ci), h2 = hash(ci + 99), x = 130 + h2 * (W - 260), y = ci * 360 + 60 + hash(ci + 7) * 240 - camY;
      const kind = Math.floor(h1 * 6);
      if (kind === 3) txt(DOODLE_TEXTS[Math.floor(hash(ci + 3) * DOODLE_TEXTS.length)], x, y, 30, PENCIL, { opacity: 0.55, angle: (h2 - 0.5) * 24 });
      else art.blit(art.scribble(kind), x, y, { anchor: 'center' });
    }
  }

  // ---- platforms ----
  const springAnim = new Map();   // platform id -> k.time() of the last trigger
  function drawPlat(p, camY, t) {
    const sy = p.y - camY;
    if (sy < -40 || sy > H + 40) return;
    stats.plats++;
    const sx = platX(p, t), half = p.w / 2;
    const tb = p.broke >= 0 ? t - p.broke : -1;
    if (tb > C.CRUMBLE_S + 1.2) return;
    wrapped(sx, half + 20, (x) => {
      if (p.type === 'crumble') {
        // Pappe: a Pfand-carton that bounces you once, then falls apart
        const gone = tb > C.CRUMBLE_S;
        const fall = gone ? tb - C.CRUMBLE_S : 0, shake = tb >= 0 && !gone ? Math.sin(tb * 90) * 2 : 0;
        const piece = art.crumbleHalf(half);
        for (const side of [0, 1]) {
          const cx = side ? x + half / 2 : x - half / 2, dy = fall * fall * 700 * (side ? 1 : 1.3), ang = gone ? (side ? 1 : -1) * fall * 160 : 0;
          art.blit(piece, cx + shake + (side ? fall * 40 : -fall * 40), sy + dy + 7, { anchor: 'center', angle: ang, opacity: gone ? Math.max(0, 1 - fall / 1.2) : 1 });
        }
        if (!gone) { txt('PFAND', x, sy + 7, 11, '#6e5226', { opacity: 0.9 }); pencil(x, sy + 1, x - 4, sy + 13, 2, INK, p.id); }
        return;
      }
      const e = art.plat(p.type, p.w);
      art.blit(e, x - e.w / 2, sy - art.PLAT.padY);
      if (p.spring) {
        // Döner-Sprungfeder: coil + a Döner on top (stretched right after a bounce)
        const a = springAnim.get(p.id), age = a === undefined ? 9 : k.time() - a, ext = age < 0.35 ? 1 + Math.sin((age / 0.35) * Math.PI) * 0.9 : 1, ch = 20 * ext, sc = ch / 20;
        art.blit(art.coil(), x - 15, sy - 24 * sc, { height: 28 * sc });
        txt('🥙', x, sy - ch - 14, 34, '#ffffff');
      }
    });
  }

  // ---- pickups + hazards ----
  const drawBottle = (x, y, size, glow) => art.blit(art.bottle(size, glow), x, y, { anchor: 'center' });
  function drawItem(it, camY, t) {
    if (it.taken) return;
    const sy = it.y - camY + Math.sin(t * 4 + it.x) * 4;
    if (sy < -60 || sy > H + 60) return;
    wrapped(it.x, 40, (x) => { drawBottle(x, sy, 46, true); txt('Club-Mate', x, sy - 46, 14, INK, { opacity: 0.8 }); });
  }
  function drawGull(g, camY, t) {
    const gp = gullPos(g, t), sy = gp.y - camY;
    if (sy < -50 || sy > H + 50) return;
    wrapped(gp.x, 50, (x) => {
      const o = { anchor: 'center', flipX: g.dir < 0 };
      art.blit(art.gullWing(Math.sin(t * 14 + g.ph)), x, sy, o);   // the wing sits behind the body
      art.blit(art.gullBody(), x, sy, o);
    });
  }
  function drawDrone(d, camY, t, near) {
    const dp = dronePos(d, t), sy = dp.y - camY;
    if (sy < -50 || sy > H + 50) return;
    wrapped(dp.x, 60, (x) => {
      art.blit(art.drone(Math.floor(t * 4) % 2), x, sy, { anchor: 'center' });   // cone + body + stems + light; only the rotor blades spin live
      const spin = Math.cos(t * 40);
      for (const s of [-1, 1]) line([[x + s * (30 - 20 * spin), sy - 17], [x + s * (30 + 20 * spin), sy - 17]], 3, PENCIL);
      if (near) txt('KNÖLLCHEN!', x, sy - 36, 20, '#c62828', { outline: [3, PAPER] });
    });
  }

  // ---- floating pop-up words + fall banner ----
  const pops = [];
  const pop = (str, x, y, color = INK, size = 34) => { pops.push({ str, x, y, color, size, age: 0 }); if (pops.length > 8) pops.shift(); };
  let banner = null;   // { str, age }

  // ---- scene ----
  const view = { camY: -480, t: 0, x: W / 2, feet: 0, vx: 0, vy: 0, jet: 0, doner: false, inv: 0, stun: 0, facing: 1, h: 0, falls: 0 };
  // debug/test hook: what the last frame of this lane drew (e2e asserts the spectated thumbnails still show platforms)
  const stats = { view: ctx.view, seat: ctx.seat, plats: 0, camY: view.camY };
  (globalThis.__wkDoodle ??= {})[`${ctx.view}${ctx.seat}`] = stats;
  /** indices of the entries of `arr` (sorted by y, climbing = descending y) whose y lies in [lo, hi] */
  const eachIn = (arr, lo, hi, fn) => {
    let a = 0, b = arr.length;
    while (a < b) { const m = (a + b) >> 1; if (arr[m].y <= hi) b = m; else a = m + 1; }
    for (let i = a; i < arr.length && arr[i].y >= lo; i++) fn(arr[i]);
  };
  const bg = root.add([k.pos(0, 0)]);
  bg.onDraw(() => {
    bt = Math.floor(k.time() * 7);
    const camY = view.camY, lo = camY - MARGIN, hi = camY + H + MARGIN;
    stats.plats = 0; stats.camY = camY;
    drawPaper(camY);
    eachIn(course.plats, lo, hi, (p) => drawPlat(p, camY, view.t));
    eachIn(course.items, lo, hi, (it) => drawItem(it, camY, view.t));
    eachIn(course.gulls, lo, hi, (g) => drawGull(g, camY, view.t));
    eachIn(course.drones, lo, hi, (d) => drawDrone(d, camY, view.t, !thumb && Math.abs(dronePos(d, view.t).y - camY - (view.feet - camY)) < 260));
  });

  const av = ctx.addAvatar(profile, { size: C.R * 2, showName: false });
  const ghost = ctx.addAvatar(profile, { size: C.R * 2, showName: false });
  ghost.pos = V(-999, -999); ghost.hidden = true;

  const fx = root.add([k.pos(0, 0)]);
  let live = false, over = false, finished = false, wall0 = 0, hintObj = null, lastSay = -99, sayN = 0;
  const startedAt = k.time();
  fx.onDraw(() => {
    const sx = view.x, sy = view.feet - view.camY - C.R;   // blob centre on screen
    // rocket + flame on the blob
    if (view.jet > 0) {
      wrapped(sx, 40, (x) => {
        drawBottle(x - view.facing * 26, sy + 4, 40, false);
        const fl = 20 + Math.random() * 16;
        poly([[x - view.facing * 32, sy + 22], [x - view.facing * 20, sy + 22], [x - view.facing * 26, sy + 22 + fl]], '#ff9f1c', { outline: [2, '#c43d00'] });
        poly([[x - view.facing * 29, sy + 22], [x - view.facing * 23, sy + 22], [x - view.facing * 26, sy + 22 + fl * 0.55]], '#ffe066');
      });
    }
    if (view.doner) wrapped(sx, 40, (x) => txt('🥙', x + 30, sy + 12, 26, '#ffffff'));
    if (view.stun > 0) wrapped(sx, 40, (x) => txt('💫', x, sy - 46, 28, '#ffffff'));
    for (const p of pops) {
      const a = Math.min(1, (1.1 - p.age) * 2);
      if (a > 0) txt(p.str, p.x, p.y - p.age * 70, p.size, p.color, { opacity: a, outline: [4, PAPER], angle: -6 });
    }
    // HUD
    if (thumb) {
      art.blit(art.hudThumb(), art.HUD.thumb.x, art.HUD.thumb.y);
      txt(fmtM(view.h), 480, 90, 118, INK, { outline: [8, '#fff6a8'] });
    } else {
      art.blit(art.hudMain(), art.HUD.main.x, art.HUD.main.y);
      txt(fmtM(view.h), 143, 54, 50, INK, { outline: [5, '#fff6a8'] });
    }
    if (!thumb) {
      const left = live ? Math.max(0, Math.ceil((DURATION_MS - (performance.now() - wall0)) / 1000)) : Math.ceil(DURATION_MS / 1000);
      art.blit(art.hudClock(), art.HUD.clock.x, art.HUD.clock.y);
      txt(`${left}`, W - 52, 52, left > 9 ? 36 : 44, left <= 5 ? '#c62828' : INK);
      if (view.falls > 0) txt(`Abstürze: ${view.falls}`, 143, 106, 18, '#c62828', { outline: [3, PAPER] });
    }
    if (banner) { const a = Math.min(1, (2.2 - banner.age) * 2); txt(banner.str, W / 2, 250, 54, banner.color ?? '#c62828', { opacity: a, outline: [6, PAPER], angle: -4 }); }
  });

  function syncView(dt) {
    view.camY = st.camY; view.t = st.t; view.x = st.x; view.feet = st.y; view.vy = st.vy; view.jet = st.jet; view.doner = st.doner; view.stun = st.stun;
    view.facing = st.facing; view.h = heightM(st); view.falls = st.falls; view.inv = st.inv;
  }

  function say(key, every = 3.5) {
    const now = k.time();
    if (now - lastSay < every || sayN > 9) return;
    lastSay = now; sayN++;
    audio.say(pick(LINES[key]));
  }

  function onEvent(e) {
    const sy = st.y - st.camY - C.R - 40;
    if (e === 'bounce') { audio.sfx('jump', { volume: 0.35, rate: 0.9 + Math.random() * 0.4 }); }
    else if (e === 'spring') {
      audio.sfx('boing', { volume: 0.8 }); av.bounce?.();
      let near = null; for (const p of course.plats) if (p.spring && Math.abs(p.y - st.y) < 10 && (!near || Math.abs(wrapDelta(platX(p, st.t), st.x)) < Math.abs(wrapDelta(platX(near, st.t), st.x)))) near = p;
      if (near) springAnim.set(near.id, k.time());
      pop('BOING!', st.x, sy, '#d94a4a', 40); say('spring', 6);
    } else if (e === 'crumble') { audio.sfx('bump', { volume: 0.5, rate: 0.7 }); pop('KRACK', st.x, sy, '#8a6a3a', 28); }
    else if (e === 'jet') { audio.sfx('whoosh', { volume: 0.9 }); audio.sfx('endspurt', { volume: 0.5 }); pop('MATE!', st.x, sy, '#2e8b57', 42); say('jet', 4); }
    else if (e === 'gull' || e === 'gullHit') {
      audio.sfx('splat', { volume: 0.7 }); pop(e === 'gull' ? 'KRÄH! Döner weg!' : 'KRÄH!', st.x, sy, '#5a6b8c', 34); say('gull', 4);
    } else if (e === 'drone') { audio.sfx('error', { volume: 0.7 }); pop('KNÖLLCHEN!', st.x, sy, '#c62828', 38); say('drone', 4); }
    else if (e === 'fall') {
      audio.sfx('lose', { volume: 0.7 });
      banner = { str: 'Abgestürzt!', age: 0, color: '#c62828' }; say('fall', 5);
    } else if (e === 'mile') { audio.sfx('star', { volume: 0.6 }); pop(fmtM(heightM(st)), st.x, sy - 20, '#d9a441', 44); say('high', 5); }
  }

  function finishNow() {
    if (finished) return;
    finished = true; over = true;
    const m = heightM(st);
    audio.say(pick(LINES.end));
    ctx.finish({ score: m, label: fmtM(m) });
  }

  // ---- thumbnail: replays the remote's camera + blob from its progress packets ----
  let remote = null;   // { x, y(feet screen y), h, c(camY), t, f, d }
  let lastBounceH = 0;

  let acc = 0, progressKey = '';
  root.onUpdate(() => {
    const dt = Math.min(0.1, k.dt());
    for (const p of pops) p.age += dt;
    while (pops.length && pops[0].age > 1.1) pops.shift();
    if (banner) { banner.age += dt; if (banner.age > 2.2) banner = null; }

    if (thumb) {
      if (remote) {
        // a thumbnail never runs the sim, so nothing else extends its course: the remote can climb far past the start-up stretch
        course.ensure(Math.min(view.camY, remote.c) - MARGIN);
        const f = 1 - Math.exp(-dt * 12);
        view.camY += (remote.c - view.camY) * f;
        view.x += wrapDelta(view.x, remote.x) * f;
        view.feet += (remote.c + remote.y - view.feet) * f * 1.4;
        view.t += dt; view.t += (remote.t - view.t) * 0.1;
        view.h = remote.h; view.falls = remote.f;
        if (remote.d) view.jet = 0;
      }
    } else {
      if (live && !over) {
        acc += dt;
        const ix = Math.max(-1, Math.min(1, input.state.move.x));
        let n = 0;
        while (acc >= STEP && n++ < 6) { step(st, course, ix, STEP); acc -= STEP; }
        if (n >= 6) acc = 0;
        for (const e of st.ev) onEvent(e);
        st.ev.length = 0;
        if (performance.now() - wall0 >= DURATION_MS - 350) finishNow();
      }
      syncView(dt);
      const key = `${Math.round(st.x)}|${Math.round(st.y - st.camY)}|${Math.round(st.camY)}`;
      if (key !== progressKey) {
        progressKey = key;
        ctx.sendProgress({ x: Math.round(st.x), y: Math.round(st.y - st.camY), h: heightM(st), c: Math.round(st.camY), t: Math.round(st.t * 10) / 10, f: st.falls, d: over ? 1 : 0 });
      }
      if (hintObj && live && performance.now() - wall0 > 9000) { hintObj.setOpacity?.(0); hintObj = null; }
    }

    // blob(s) on screen
    const sy = view.feet - view.camY - C.R;
    av.pos = V(view.x, sy);
    av.setFacing?.(view.facing);
    const blink = view.inv > 0 && !thumb && Math.floor(k.time() * 14) % 2 === 0 && view.jet <= 0;
    av.hidden = blink;
    if (view.x < C.R + 8) { ghost.pos = V(view.x + W, sy); ghost.hidden = blink; }
    else if (view.x > W - C.R - 8) { ghost.pos = V(view.x - W, sy); ghost.hidden = blink; }
    else { ghost.pos = V(-999, -999); ghost.hidden = true; }
    ghost.setFacing?.(view.facing);
  });

  if (!thumb) hintObj = addHint(k, root, HINT, W / 2, H - 20, { size: 17, color: '#ffffff', outline: [4, INK] });
  syncView(0);

  return {
    go() {
      if (thumb || live) return;
      live = true; wall0 = performance.now();
      launch(st);
      say('start', 1);
      input.takeFrame?.();
    },
    update(p) {
      // untrusted wire data: one NaN / string in a packet must not poison the camera for good (the map would be gone for the rest of the round)
      if (thumb && p && typeof p === 'object') {
        const num = (v, d, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
        remote = {
          x: num(p.x, W / 2, -W, 2 * W), y: num(p.y, 0, -4 * H, 4 * H), h: num(p.h, 0, 0, 1e6), c: num(p.c, -480, -MAX_CAM, 4 * H),
          t: num(p.t, 0, 0, 1e5), f: num(p.f, 0, 0, 1e4), d: p.d ? 1 : 0,
        };
      }
    },
    botInput() {
      if (thumb || !live || over) return {};
      return { move: { x: botControl(st, course, bot), y: 0 } };
    },
    destroy() {},   // everything hangs off root (the runner destroys it)
  };
}
