// Ordnungsamt-Flucht: the host-side simulation. PURE: no Kaplay, no DOM, no Date/Math.random. Same seed + same inputs => same game.
// State is plain JSON (it is broadcast as mgState). Rules:
//  - everybody has LIVES lives. A van hit ("kontrolliert") costs one life, flings you a bit, stuns you briefly and gives INV_MS of invulnerability.
//  - at 0 lives you are out. Game ends when <= 1 player is left, or at DURATION_MS.
//  - `action` = shove: a short dash. Every rival touched during the dash gets a big knockback + stun. Cooldown COOLDOWN_MS.
//  - if a shoved player is hit by a van within CREDIT_MS, the shover gets a "Kollateralschaden" credit (tie-breaker for survivors).
//  - ranking: still alive > out; alive: more lives, then more credits; out: later is better. Equal keys tie.
import { createRng } from '../../contracts.js';

export const DURATION_MS = 30000;
export const ARENA = { w: 1280, h: 720, x0: 40, y0: 90, x1: 1240, y1: 690 };   // x0..y1 = where players may walk
export const C = {
  R: 22, SPEED: 270, ACCEL: 14, LIVES: 3,
  INV_MS: 1800, HIT_STUN_MS: 450, VAN_KB: 650,
  DASH_MS: 180, DASH_SPEED: 850, COOLDOWN_MS: 1000, SHOVE_KB: 1400, SHOVE_STUN_MS: 320, KB_HALF_MS: 90,
  CREDIT_MS: 1600, TELEGRAPH_MS: 900, VAN_W: 130, VAN_T: 60, EV_KEEP_MS: 600,
};

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ZERO = { move: { x: 0, y: 0 }, jump: false, action: false, confirm: false, back: false, pressed: { jump: false, action: false, confirm: false, back: false } };

/** @returns ArenaState */
export function hostInit({ seats, seed, rng }) {
  const r = rng ?? createRng(seed);
  const rot = r.next() * Math.PI * 2;
  const cx = (ARENA.x0 + ARENA.x1) / 2, cy = (ARENA.y0 + ARENA.y1) / 2;
  const ps = seats.map((s, i) => {
    const a = rot + (i / seats.length) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    return {
      s, x: r1(cx + dx * 380), y: r1(cy + dy * 220), vx: 0, vy: 0, kx: 0, ky: 0, fx: r2(-dx), fy: r2(-dy),
      dash: 0, cd: 0, stun: 0, inv: 0, lives: C.LIVES, out: null, cr: 0, ls: -1, lt: 0, dh: [],
    };
  });
  return { t: 0, done: false, dur: DURATION_MS, ps, vans: [], next: 1600, nid: 1, eid: 0, ev: [], rs: r.state() };
}

const vanSpeed = (mg) => lerp(240, 520, Math.min(1, mg.t / mg.dur));
const spawnGap = (mg) => lerp(1250, 450, Math.min(1, mg.t / mg.dur));
const alive = (mg) => mg.ps.filter((p) => p.out === null);

function pushEv(mg, e) { mg.ev.push({ i: ++mg.eid, t: mg.t, ...e }); }

function spawnVan(mg, rng) {
  const horizontal = rng.next() < 0.55;
  const dir = rng.next() < 0.5 ? -1 : 1;
  const speed = vanSpeed(mg) * (0.9 + rng.next() * 0.25);
  const targets = alive(mg);
  const tg = targets.length ? rng.pick(targets) : { x: 640, y: 400 };
  const lead = (speed * C.TELEGRAPH_MS) / 1000 + C.VAN_W / 2;
  const van = { id: mg.nid++ };
  if (horizontal) {
    Object.assign(van, { w: C.VAN_W, h: C.VAN_T, y: r1(clamp(tg.y + rng.int(-60, 60), ARENA.y0, ARENA.y1)), x: r1(dir > 0 ? -lead : ARENA.w + lead), vx: r1(dir * speed), vy: 0 });
  } else {
    Object.assign(van, { w: C.VAN_T, h: C.VAN_W, x: r1(clamp(tg.x + rng.int(-60, 60), ARENA.x0, ARENA.x1)), y: r1(dir > 0 ? -lead : ARENA.h + lead), vx: 0, vy: r1(dir * speed) });
  }
  mg.vans.push(van);
  pushEv(mg, { k: 'v', s: van.id });
}

function circleHitsRect(px, py, r, v) {
  const nx = clamp(px, v.x - v.w / 2, v.x + v.w / 2), ny = clamp(py, v.y - v.h / 2, v.y + v.h / 2);
  return (px - nx) ** 2 + (py - ny) ** 2 < r * r;
}

/** Advances the game by dtMs. `inputs`: seat -> InputFrame (missing seat = no input). Mutates and returns mg. */
export function hostStep(mg, inputs, dtMs) {
  if (mg.done) return mg;
  const sec = dtMs / 1000;
  mg.t += dtMs;
  mg.ev = mg.ev.filter((e) => mg.t - e.t <= C.EV_KEEP_MS);
  let rng = null;
  const R = () => (rng ??= createRng(mg.rs));

  // --- players ---
  for (const p of mg.ps) {
    if (p.out !== null) continue;
    const f = inputs?.[p.s] ?? ZERO;
    p.dash = Math.max(0, p.dash - dtMs); p.cd = Math.max(0, p.cd - dtMs); p.stun = Math.max(0, p.stun - dtMs); p.inv = Math.max(0, p.inv - dtMs);
    let mx = f.move?.x ?? 0, my = f.move?.y ?? 0;
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    const dl = Math.min(ml, 1);
    if (dl > 0.2 && p.stun === 0) { p.fx = r2(mx / dl); p.fy = r2(my / dl); }
    if (f.pressed?.action && p.cd === 0 && p.stun === 0 && p.dash === 0) {
      p.dash = C.DASH_MS; p.cd = C.COOLDOWN_MS; p.dh = [];
    }
    if (p.dash > 0) { p.vx = p.fx * C.DASH_SPEED; p.vy = p.fy * C.DASH_SPEED; }
    else {
      const k = Math.min(1, sec * C.ACCEL), ctl = p.stun > 0 ? 0 : 1;
      p.vx += (mx * C.SPEED * ctl - p.vx) * k;
      p.vy += (my * C.SPEED * ctl - p.vy) * k;
    }
    const decay = Math.pow(0.5, dtMs / C.KB_HALF_MS);
    p.kx *= decay; p.ky *= decay;
    p.x = clamp(p.x + (p.vx + p.kx) * sec, ARENA.x0, ARENA.x1);
    p.y = clamp(p.y + (p.vy + p.ky) * sec, ARENA.y0, ARENA.y1);
  }

  // --- shoves: a dashing player pushes every rival it touches (once per dash) ---
  for (const p of mg.ps) {
    if (p.out !== null || p.dash <= 0) continue;
    for (const q of mg.ps) {
      if (q === p || q.out !== null || p.dh.includes(q.s)) continue;
      const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
      if (d > 2 * C.R + 10) continue;
      const nx = d > 0.001 ? dx / d : p.fx, ny = d > 0.001 ? dy / d : p.fy;
      q.kx += nx * C.SHOVE_KB; q.ky += ny * C.SHOVE_KB;
      q.stun = Math.max(q.stun, C.SHOVE_STUN_MS);
      q.ls = p.s; q.lt = mg.t;
      p.dh.push(q.s);
      pushEv(mg, { k: 's', s: p.s, o: q.s, x: r1(q.x), y: r1(q.y) });
    }
  }

  // --- players push each other apart a little (so crowds feel like crowds) ---
  for (let i = 0; i < mg.ps.length; i++) for (let j = i + 1; j < mg.ps.length; j++) {
    const a = mg.ps[i], b = mg.ps[j];
    if (a.out !== null || b.out !== null) continue;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d >= 2 * C.R || d < 0.001) continue;
    const push = (2 * C.R - d) / 2, nx = dx / d, ny = dy / d;
    a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
  }

  // --- vans ---
  mg.next -= dtMs;
  while (mg.next <= 0) {
    const g = R();
    spawnVan(mg, g);
    if (mg.t > 6000 && g.next() < 0.35) spawnVan(mg, g);
    mg.next += spawnGap(mg) * (0.7 + g.next() * 0.6);
  }
  for (const v of mg.vans) { v.x = r1(v.x + v.vx * sec); v.y = r1(v.y + v.vy * sec); }
  mg.vans = mg.vans.filter((v) => !((v.vx > 0 && v.x - v.w / 2 > ARENA.w) || (v.vx < 0 && v.x + v.w / 2 < 0) || (v.vy > 0 && v.y - v.h / 2 > ARENA.h) || (v.vy < 0 && v.y + v.h / 2 < 0)));

  for (const p of mg.ps) {
    if (p.out !== null || p.inv > 0) continue;
    const v = mg.vans.find((van) => circleHitsRect(p.x, p.y, C.R, van));
    if (!v) continue;
    p.lives--; p.inv = C.INV_MS; p.stun = C.HIT_STUN_MS; p.dash = 0;
    p.kx += Math.sign(v.vx) * C.VAN_KB; p.ky += Math.sign(v.vy) * C.VAN_KB;
    const credit = p.ls >= 0 && mg.t - p.lt <= C.CREDIT_MS ? p.ls : -1;
    if (credit >= 0) mg.ps.find((q) => q.s === credit).cr++;
    pushEv(mg, { k: 'h', s: p.s, o: credit, x: r1(p.x), y: r1(p.y) });
    if (p.lives <= 0) { p.out = mg.t; p.vx = p.vy = 0; pushEv(mg, { k: 'o', s: p.s, x: r1(p.x), y: r1(p.y) }); }
  }

  // --- tidy numbers (keeps the broadcast small and the sim reproducible) ---
  for (const p of mg.ps) for (const key of ['x', 'y', 'vx', 'vy', 'kx', 'ky']) p[key] = r1(p[key]);
  if (rng) mg.rs = rng.state();
  if ((mg.ps.length > 1 && alive(mg).length <= 1) || mg.t >= mg.dur) mg.done = true;
  return mg;
}

const fmtSec = (ms) => (ms / 1000).toFixed(1).replace('.', ',');

/** Ranking, best first. Works on any state (also a hard-capped, not-yet-done one). */
export function hostResult(mg) {
  const keyOf = (p) => (p.out === null ? [1, p.lives, p.cr] : [0, p.out, 0]);
  const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i] - a[i]; return 0; };
  const sorted = mg.ps.map((p) => ({ p, key: keyOf(p) })).sort((a, b) => cmp(a.key, b.key) || a.p.s - b.p.s);
  const placements = [], labels = {};
  for (const e of sorted) {
    const prev = placements.length ? sorted.find((x) => x.p.s === placements[placements.length - 1][0]) : null;
    if (prev && cmp(prev.key, e.key) === 0) placements[placements.length - 1].push(e.p.s); else placements.push([e.p.s]);
    const extra = e.p.cr ? ` · ${e.p.cr}× Kollateralschaden` : '';
    labels[e.p.s] = (e.p.out === null ? `überlebt mit ${e.p.lives} Leben` : `kontrolliert nach ${fmtSec(e.p.out)} s`) + extra;
  }
  return { placements, labels };
}

/** A sensible bot for `seat`: dodges vans (sidestep out of the lane), keeps off the walls, sometimes shoves a rival, preferably one standing in a van lane.
 *  Pure given (mg, rng). Returns an InputFrame (pressed.action = the shove press this frame). */
export function botFrame(mg, seat, rng) {
  const me = mg.ps.find((p) => p.s === seat);
  const frame = { move: { x: 0, y: 0 }, jump: false, action: false, confirm: false, back: false, pressed: { jump: false, action: false, confirm: false, back: false } };
  if (!me || me.out !== null) return frame;

  // threat = van that will cross my position soonest
  const laneHit = (v, x, y) => {
    const horizontal = v.vx !== 0;
    const across = horizontal ? Math.abs(y - v.y) : Math.abs(x - v.x);
    const half = (horizontal ? v.h : v.w) / 2 + C.R + 16;
    if (across > half) return null;
    const ahead = horizontal ? (x - v.x) * Math.sign(v.vx) : (y - v.y) * Math.sign(v.vy);
    const speed = Math.abs(horizontal ? v.vx : v.vy);
    const len = (horizontal ? v.w : v.h) / 2 + C.R;
    if (ahead < -len) return null;               // already past
    const tt = Math.max(0, ahead - len) / speed;
    return tt < 0.95 ? { tt, horizontal, side: horizontal ? Math.sign(y - v.y) || 1 : Math.sign(x - v.x) || 1 } : null;
  };
  let threat = null;
  for (const v of mg.vans) { const h = laneHit(v, me.x, me.y); if (h && (!threat || h.tt < threat.tt)) threat = h; }

  let mx = 0, my = 0;
  if (threat) {
    const lo = threat.horizontal ? ARENA.y0 : ARENA.x0, hi = threat.horizontal ? ARENA.y1 : ARENA.x1, pos = threat.horizontal ? me.y : me.x;
    let side = threat.side;
    if ((side < 0 && pos - lo < 80) || (side > 0 && hi - pos < 80)) side = -side;   // no room that way: run across instead
    if (threat.horizontal) my = side; else mx = side;
  } else {
    // drift away from the walls toward the middle
    const cx = (ARENA.x0 + ARENA.x1) / 2, cy = (ARENA.y0 + ARENA.y1) / 2;
    if (me.x < ARENA.x0 + 90 || me.x > ARENA.x1 - 90) mx = Math.sign(cx - me.x);
    if (me.y < ARENA.y0 + 90 || me.y > ARENA.y1 - 90) my = Math.sign(cy - me.y);
    // shove a close rival (more eagerly when they stand in a van lane)
    if (me.cd === 0 && me.stun === 0) {
      let best = null;
      for (const q of mg.ps) {
        if (q.s === seat || q.out !== null) continue;
        const d = Math.hypot(q.x - me.x, q.y - me.y);
        if (d < 110 && (!best || d < best.d)) best = { q, d };
      }
      if (best) {
        const inLane = mg.vans.some((v) => laneHit(v, best.q.x, best.q.y));
        if (rng.next() < (inLane ? 0.35 : 0.03)) {
          mx = (best.q.x - me.x) / best.d; my = (best.q.y - me.y) / best.d;
          frame.action = true; frame.pressed.action = true;
        }
      }
    }
  }
  frame.move = { x: mx, y: my };
  return frame;
}
