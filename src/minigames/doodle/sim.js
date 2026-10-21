// Doodle-Knagger: pure simulation (no Kaplay, no Math.random). Course = platforms + hazards + pickups generated lazily from the shared rng
// (identical for every client: the draw order never depends on the player), physics = fixed 60 Hz steps, bot = steering heuristic.
// World: x wraps in [0, W); y points DOWN, the start platform is y = 0, climbing means y gets more negative. A score metre = PX_PER_M world px.

export const W = 960;
export const H = 720;
export const DURATION_MS = 32000;
export const STEP = 1 / 60;
export const PX_PER_M = 5;

export const C = {
  G: 1900,            // gravity px/s^2
  V_BOUNCE: 800,      // auto-bounce: rises 168 px
  V_SPRING: 1260,     // Doener-Sprungfeder: rises ~418 px
  VX: 430,            // max steering speed
  JET_V: 820, JET_T: 1.0,   // Club-Mate-Rakete
  R: 26,              // blob radius (collision + drawing)
  PLAT_H: 14,
  CAM_LINE: 300,      // the blob is never above this screen y: the camera follows it up
  FALL_MARGIN: 80,    // feet this far below the screen bottom = fell
  PENALTY_PX: 320,    // after a fall the blob restarts at least this far below the best height
  CRUMBLE_S: 0.28,    // Pappe breaks this long after the bounce
  SPRING_HALF: 36,    // landing this close to the spring's centre triggers it
};

const wrapX = (x) => ((x % W) + W) % W;
/** shortest signed horizontal distance a -> b on the wrapping screen */
export const wrapDelta = (a, b) => ((((b - a) % W) + W + W / 2) % W) - W / 2;

export const platX = (p, t) => (p.type === 'moving' ? wrapX(p.x + p.amp * Math.sin(p.ph + t * p.spd)) : p.x);
export const gullPos = (g, t) => ({ x: wrapX(g.x0 + g.dir * g.spd * t), y: g.y + 16 * Math.sin(t * 3 + g.ph) });
export const dronePos = (d, t) => ({ x: wrapX(d.x0 + d.amp * Math.sin(d.ph + t * d.spd)), y: d.y + 10 * Math.sin(t * 2.2 + d.ph) });

export const heightM = (st) => Math.floor((st.maxH / PX_PER_M) * 10) / 10;
/** '123 m' / '1.234 m' (German thousands dot) */
export const fmtM = (m) => `${Math.floor(m).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} m`;

// ------------------------------------------------------------------ course
export function makeCourse(rng) {
  const c = { rng, plats: [], gulls: [], drones: [], items: [], lastX: W / 2, lastY: 0, n: 0 };
  c.plats.push({ id: 0, x: W / 2, y: 0, w: 220, type: 'static', spring: false, broke: -1 });
  c.ensure = (topY) => { while (c.lastY > topY) genNext(c); };
  c.ensure(-1400);
  return c;
}

function genNext(c) {
  const r = c.rng;
  // always the same number of draws per platform, whatever branch is taken: the course never depends on the player
  const [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10] = [r.next(), r.next(), r.next(), r.next(), r.next(), r.next(), r.next(), r.next(), r.next(), r.next()];
  const n = ++c.n;
  const d = Math.min(1, -c.lastY / 7000);                       // difficulty 0..1
  const gap = 56 + d * 56 + r1 * 24;                            // max ~136 < 168 jump height
  const y = c.lastY - gap;
  const x = wrapX(c.lastX + (r2 * 2 - 1) * (190 + d * 50));
  const w = 112 - d * 30 + r3 * 14;                             // 112..126 -> 82..96
  let type = 'static';
  if (n > 6 && r4 < 0.1 + d * 0.22) type = 'moving';
  else if (n > 9 && r4 > 0.9 - d * 0.14) type = 'crumble';
  const p = { id: n, x, y, w, type, spring: false, broke: -1 };
  if (type === 'moving') { p.amp = 70 + r5 * 80; p.spd = 0.8 + r6 * 0.9; p.ph = r7 * 6.283; }
  else if (type === 'static' && n > 3 && r5 < 0.09) p.spring = true;
  c.plats.push(p);
  // hazards sit between two platforms, on the climbing path
  if (n > 10 && r8 < 0.075 + d * 0.04) c.gulls.push({ x0: r9 * W, y: y + gap / 2, dir: r10 < 0.5 ? -1 : 1, spd: 150 + r3 * 70, ph: r2 * 6.283 });
  else if (n > 24 && r8 > 0.945 - d * 0.03) c.drones.push({ x0: x, y: y + gap / 2, amp: 160 + r9 * 120, spd: 0.9 + r10 * 0.7, ph: r2 * 6.283 });
  else if (n > 16 && r8 > 0.8 && r8 < 0.822 + d * 0.015 && type === 'static') c.items.push({ kind: 'jet', x, y: y - 46, taken: false });
  c.lastX = x; c.lastY = y;
}

// ------------------------------------------------------------------ state
export function newState(course) {
  return {
    t: 0, x: W / 2, y: 0, vx: 0, vy: 0, push: 0, facing: 1,
    camY: -480, maxH: 0, jet: 0, doner: false, stun: 0, inv: 0, falls: 0, bounces: 0, springs: 0, hits: 0,
    ev: [], lastMile: 0, started: false,
  };
}

/** go(): the first bounce */
export function launch(st) { st.started = true; st.vy = -C.V_BOUNCE; st.ev.push('bounce'); st.bounces++; }

function respawn(st, course) {
  const bestY = -st.maxH;
  let pick = course.plats[0];
  // the highest solid platform that is at least PENALTY_PX below the best height
  for (const p of course.plats) if (p.type !== 'crumble' && p.y >= bestY + C.PENALTY_PX && p.y < pick.y + 0.5) pick = p;
  st.x = platX(pick, st.t); st.y = pick.y; st.vy = -C.V_BOUNCE; st.vx = 0; st.push = 0; st.jet = 0; st.stun = 0; st.doner = false;
  st.inv = 1.6; st.camY = st.y - 480; st.falls++;
  st.ev.push('fall', 'bounce'); st.bounces++;
}

/** advance one fixed step. inpX in -1..1. Events are pushed on st.ev (the caller drains it). */
export function step(st, course, inpX, dt = STEP) {
  if (!st.started) return;
  st.t += dt;
  const t = st.t;
  st.stun = Math.max(0, st.stun - dt);
  st.inv = Math.max(0, st.inv - dt);
  const ix = st.stun > 0 ? inpX * 0.25 : inpX;
  st.vx += (ix * C.VX - st.vx) * Math.min(1, 12 * dt);
  st.push *= Math.exp(-4 * dt);
  const prevY = st.y;
  st.x = wrapX(st.x + (st.vx + st.push) * dt);
  if (Math.abs(ix) > 0.1) st.facing = ix < 0 ? -1 : 1;
  course.ensure(st.y - 1500);

  if (st.jet > 0) {
    st.jet -= dt;
    st.vy += (-C.JET_V - st.vy) * Math.min(1, 14 * dt);
    st.inv = Math.max(st.inv, 0.2);
    if (st.jet <= 0) st.ev.push('jetEnd');
  } else st.vy += C.G * dt;
  st.y += st.vy * dt;

  // landing (only while falling, never while the rocket burns)
  if (st.jet <= 0 && st.vy > 0) {
    for (const p of course.plats) {
      if (p.y < prevY - 4 || p.y > st.y + 4) continue;   // the feet crossed this platform's top during the step
      if (p.broke >= 0 && t - p.broke > C.CRUMBLE_S) continue;
      const dx = Math.abs(wrapDelta(platX(p, t), st.x));
      if (dx > p.w / 2 + 14) continue;
      st.y = p.y;
      if (p.spring && dx <= C.SPRING_HALF) { st.vy = -C.V_SPRING; st.doner = true; st.springs++; st.ev.push('spring'); }
      else { st.vy = -C.V_BOUNCE; st.ev.push('bounce'); }
      st.bounces++;
      if (p.type === 'crumble' && p.broke < 0) { p.broke = t; st.ev.push('crumble'); }
      break;
    }
  }

  // pickups + hazards
  for (const it of course.items) {
    if (it.taken || Math.abs(it.y - st.y) > 700) continue;
    if (Math.abs(wrapDelta(it.x, st.x)) < 44 && Math.abs(it.y - (st.y - C.R)) < 50) { it.taken = true; st.jet = C.JET_T; st.vy = -C.JET_V * 0.6; st.ev.push('jet'); }
  }
  if (st.inv <= 0) {
    for (const g of course.gulls) {
      if (Math.abs(g.y - st.y) > 400) continue;
      const gp = gullPos(g, t);
      if (Math.hypot(wrapDelta(gp.x, st.x), gp.y - (st.y - C.R)) < C.R + 26) {
        const dir = wrapDelta(gp.x, st.x) >= 0 ? 1 : -1;
        st.push = dir * 560; st.stun = 0.45; st.inv = 1.3; st.hits++;
        if (st.doner) { st.doner = false; st.ev.push('gull'); } else { if (st.vy < 0) st.vy *= 0.25; st.ev.push('gullHit'); }
        break;
      }
    }
    for (const d of course.drones) {
      if (Math.abs(d.y - st.y) > 400) continue;
      const dp = dronePos(d, t);
      if (Math.hypot(wrapDelta(dp.x, st.x), dp.y - (st.y - C.R)) < C.R + 30) {
        st.vy = 380; st.stun = 0.7; st.inv = 1.5; st.hits++; st.ev.push('drone');
        break;
      }
    }
  }

  // camera, score, fall
  st.camY = Math.min(st.camY, st.y - C.CAM_LINE);
  if (-st.y > st.maxH) st.maxH = -st.y;
  const mile = Math.floor(heightM(st) / 250);
  if (mile > st.lastMile) { st.lastMile = mile; st.ev.push('mile'); }
  if (st.y - st.camY > H + C.FALL_MARGIN) respawn(st, course);
}

// ------------------------------------------------------------------ bot
export const BOT_NOISE = 36;   // sd (px) of the per-bounce aiming error; platforms are ~80-125 wide, so it sometimes misses

export function newBot(rng) { return { rng, err: 0, seen: -1 }; }

const gauss = (r) => (r.next() + r.next() + r.next() - 1.5) * 2;   // ~N(0, 1)-ish, |.|<=3

/** steering value -1..1: head for the highest platform it can still reach, with a per-bounce aiming error */
export function botControl(st, course, bot, noise = BOT_NOISE) {
  if (!st.started) return 0;
  if (st.bounces !== bot.seen) { bot.seen = st.bounces; bot.err = gauss(bot.rng) * noise; }
  const t = st.t;
  let best = null, bestScore = Infinity;
  for (const p of course.plats) {
    if (p.y > st.y + 260 || p.y < st.y - 320) continue;
    if (p.broke >= 0 && t - p.broke > C.CRUMBLE_S) continue;
    const a = C.G / 2, b = st.vy, c = st.y - p.y;
    const disc = b * b - 4 * a * c;
    if (disc < 0) continue;
    const tHit = (-b + Math.sqrt(disc)) / (2 * a);   // when the feet come down to this platform's height
    if (tHit < 0.03) continue;
    const px = platX(p, t + tHit);
    const dx = Math.abs(wrapDelta(st.x, px));
    if (dx - p.w * 0.3 > C.VX * tHit * 0.8) continue;
    const score = p.y - (p.spring ? 90 : 0) + (p.type === 'moving' ? 18 : 0);
    if (score < bestScore) { bestScore = score; best = px; }
  }
  if (best === null) return 0;
  const d = wrapDelta(st.x, best + bot.err);
  return Math.abs(d) < 10 ? 0 : Math.max(-1, Math.min(1, d / 80));
}
