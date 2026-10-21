// Bahnsteig-Chaos: the host-side simulation. PURE: no three, no Kaplay, no DOM, no Date/Math.random. Same seed + same inputs => same game.
// World: x to the right, z towards the camera (move.y of the input maps to z), y up. The platform is a GW x GH grid of tiles of size T centred on (0, 0).
// Rules:
//  - tiles: tw[i] = 0 solid | >0 wobbling (ms until it falls) | -1 fallen. A "pattern" (announced with a Bahn announcement) sets tiles wobbling.
//  - standing over no tile (or a fallen one) for COYOTE_MS means you fall: out, with the time. Falling is final.
//  - `action` (or `jump`) = shove: a short dash, every rival touched gets a big knockback + a short stun. Cooldown COOLDOWN_MS.
//  - an ICE rushes by on a track beside the platform: warning first, then its suction drags everyone towards its track.
//  - ranking: survivors tie for first; out: later is better, equal times tie. The game ends when <= 1 player is left (after a short outro) or at DURATION_MS.
import { createRng } from '../../contracts.js';

export const DURATION_MS = 40000;
export const T = 2, GW = 9, GH = 7;                       // tile size and grid
export const HALF_W = (GW * T) / 2, HALF_H = (GH * T) / 2; // platform half extents
export const C = {
  R: 0.45, SPEED: 5.2, ACCEL: 14,
  DASH_MS: 200, DASH_SPEED: 13, COOLDOWN_MS: 900, SHOVE_KB: 15, SHOVE_STUN_MS: 350, KB_HALF_MS: 110, TOUCH: 1.25,
  COYOTE_MS: 140, GRAVITY: 30, FLOOR_Y: -2.2, CREDIT_MS: 2500,
  ICE_SPEED: 48, ICE_WARN_MS: 2400, ICE_LEN: 36, GUST: 5.6, EV_KEEP_MS: 700, OUTRO_MS: 1500,
  FIRST_PATTERN_MS: 3200,
};
export const PATTERNS = ['rand', 'row', 'col', 'rim', 'center', 'checker'];
/** z of the two outer track centres (the ICE runs on one of them) */
export const TRACK_Z = HALF_H + 3.2;

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ZERO = { move: { x: 0, y: 0 }, jump: false, action: false, confirm: false, back: false, pressed: { jump: false, action: false, confirm: false, back: false } };

/** tile index under a world point, -1 outside the grid */
export function tileAt(x, z) {
  const c = Math.floor((x + HALF_W) / T), r = Math.floor((z + HALF_H) / T);
  return c < 0 || c >= GW || r < 0 || r >= GH ? -1 : r * GW + c;
}
export const tileCol = (i) => i % GW;
export const tileRow = (i) => Math.floor(i / GW);
/** world centre of tile i */
export const tileCenter = (i) => ({ x: -HALF_W + (tileCol(i) + 0.5) * T, z: -HALF_H + (tileRow(i) + 0.5) * T });
/** true while something walkable is under (x, z) */
export const solidAt = (tw, x, z) => { const i = tileAt(x, z); return i >= 0 && tw[i] !== -1; };

/** @returns ArenaState */
export function hostInit({ seats, seed, rng }) {
  const r = rng ?? createRng(seed);
  const rot = r.next() * Math.PI * 2;
  const ps = seats.map((s, i) => {
    const a = rot + (i / seats.length) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    return {
      s, x: r2(dx * 4.6), z: r2(dz * 3.2), y: 0, vx: 0, vz: 0, vy: 0, kx: 0, kz: 0, fx: r2(-dx), fz: r2(-dz),
      dash: 0, cd: 0, stun: 0, air: 0, out: null, ko: 0, ls: -1, lt: 0, dh: [],
    };
  });
  return {
    t: 0, done: false, dur: DURATION_MS, ps, tw: new Array(GW * GH).fill(0), wb: 2000, pat: '', next: C.FIRST_PATTERN_MS,
    ice: null, iceNext: 9000 + Math.floor(r.next() * 3000), endAt: 0, eid: 0, ev: [], rs: r.state(),
  };
}

const alive = (mg) => mg.ps.filter((p) => p.out === null);
const solidTiles = (mg) => { const o = []; for (let i = 0; i < mg.tw.length; i++) if (mg.tw[i] === 0) o.push(i); return o; };
const ringOf = (i) => Math.min(tileCol(i), GW - 1 - tileCol(i), tileRow(i), GH - 1 - tileRow(i));

function pushEv(mg, e) { mg.ev.push({ i: ++mg.eid, t: mg.t, ...e }); }

/** picks the tiles of pattern `id` among the solid ones (may be empty) */
function patternTiles(mg, id, rng) {
  const solid = solidTiles(mg), u = Math.min(1, mg.t / mg.dur);
  if (id === 'rand') {
    const want = 4 + Math.floor(u * 5), pool = solid.slice(), out = new Set();
    const live = alive(mg);
    while (out.size < want && pool.length) {
      let i;
      if (live.length && rng.next() < 0.1 + 0.4 * u) { const p = rng.pick(live); i = tileAt(p.x, p.z); if (i < 0 || mg.tw[i] !== 0) i = rng.pick(pool); }   // aimed at somebody
      else i = rng.pick(pool);
      out.add(i); pool.splice(pool.indexOf(i), 1);
    }
    return [...out];
  }
  if (id === 'row' || id === 'col') {
    const key = id === 'row' ? tileRow : tileCol;
    const groups = new Map();
    for (const i of solid) { const g = key(i); (groups.get(g) ?? groups.set(g, []).get(g)).push(i); }
    const ids = [...groups.keys()].sort((a, b) => a - b);
    return ids.length ? groups.get(rng.pick(ids)) : [];
  }
  if (id === 'rim') {
    if (!solid.length) return [];
    const lo = Math.min(...solid.map(ringOf));
    return solid.filter((i) => ringOf(i) === lo);
  }
  if (id === 'center') {
    const cc = (GW - 1) / 2, cr = (GH - 1) / 2;
    return solid.filter((i) => Math.abs(tileCol(i) - cc) <= 1 && Math.abs(tileRow(i) - cr) <= 1);
  }
  if (id === 'checker') {
    const par = rng.int(0, 1);
    return solid.filter((i) => (tileCol(i) + tileRow(i)) % 2 === par);
  }
  return [];
}

function startPattern(mg, rng) {
  const solid = solidTiles(mg).length;
  const u = Math.min(1, mg.t / mg.dur);
  let pool = PATTERNS.filter((p) => p !== mg.pat);
  if (solid < 26) pool = pool.filter((p) => p !== 'rim' && p !== 'checker');
  if (solid < 14) pool = pool.filter((p) => p === 'rand' || p === 'center');
  if (mg.t < 7000) pool = pool.filter((p) => p !== 'checker');
  if (mg.t < 6000) pool = pool.filter((p) => p === 'rand' || p === 'row' || p === 'col');
  if (!pool.length) pool = ['rand'];
  let id = rng.pick(pool), tiles = patternTiles(mg, id, rng);
  if (!tiles.length) { id = 'rand'; tiles = patternTiles(mg, id, rng); }
  mg.wb = Math.round(lerp(1900, 1050, u));
  for (const i of tiles) mg.tw[i] = mg.wb;
  mg.pat = id;
  pushEv(mg, { k: 'a', p: id, n: tiles.length });
}

/** Advances the game by dtMs. `inputs`: seat -> InputFrame (missing seat = no input). Mutates and returns mg. */
export function hostStep(mg, inputs, dtMs) {
  if (mg.done) return mg;
  const sec = dtMs / 1000;
  mg.t += dtMs;
  mg.ev = mg.ev.filter((e) => mg.t - e.t <= C.EV_KEEP_MS);
  let rng = null;
  const R = () => (rng ??= createRng(mg.rs));
  const u = Math.min(1, mg.t / mg.dur);

  // --- tiles: wobble timers run out => the tile falls ---
  for (let i = 0; i < mg.tw.length; i++) if (mg.tw[i] > 0) { mg.tw[i] -= dtMs; if (mg.tw[i] <= 0) mg.tw[i] = -1; else mg.tw[i] = Math.round(mg.tw[i]); }

  // --- patterns ---
  if (!mg.endAt) {
    mg.next -= dtMs;
    if (mg.next <= 0 && mg.t < mg.dur - 2500) {
      const g = R();
      startPattern(mg, g);
      mg.next = Math.round(lerp(3400, 2300, u) * (0.85 + g.next() * 0.3));
    }
  }

  // --- the ICE ---
  if (!mg.ice && !mg.endAt) {
    mg.iceNext -= dtMs;
    if (mg.iceNext <= 0 && mg.t < mg.dur - 5000) {
      const g = R();
      const side = g.next() < 0.5 ? -1 : 1, dir = g.next() < 0.5 ? -1 : 1;
      mg.ice = { side, dir, x: -dir * (HALF_W + C.ICE_LEN), w: 0, tl: C.ICE_WARN_MS };
      pushEv(mg, { k: 'i', side, dir });
    }
  }
  let gust = 0;
  if (mg.ice) {
    const ice = mg.ice;
    if (ice.w === 0) { ice.tl -= dtMs; if (ice.tl <= 0) { ice.w = 1; pushEv(mg, { k: 'g', side: ice.side, dir: ice.dir }); } }
    else {
      ice.x = r1(ice.x + ice.dir * C.ICE_SPEED * sec);
      gust = Math.max(0, 1 - Math.abs(ice.x) / (HALF_W + 16));
      if (Math.abs(ice.x) > HALF_W + C.ICE_LEN + 4 && ice.x * ice.dir > 0) { mg.ice = null; mg.iceNext = Math.round(lerp(9000, 6500, u) + R().next() * 3000); }
    }
  }

  // --- players: input, movement ---
  const frozenWin = mg.endAt > 0;   // the winner hovers safely during the outro
  for (const p of mg.ps) {
    if (p.out !== null) continue;
    const f = inputs?.[p.s] ?? ZERO;
    p.dash = Math.max(0, p.dash - dtMs); p.cd = Math.max(0, p.cd - dtMs); p.stun = Math.max(0, p.stun - dtMs);
    let mx = f.move?.x ?? 0, mz = f.move?.y ?? 0;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const dl = Math.min(ml, 1);
    if (dl > 0.2 && p.stun === 0) { p.fx = r2(mx / dl); p.fz = r2(mz / dl); }
    if ((f.pressed?.action || f.pressed?.jump) && p.cd === 0 && p.stun === 0 && p.dash === 0 && p.air === 0) {
      p.dash = C.DASH_MS; p.cd = C.COOLDOWN_MS; p.dh = [];
      pushEv(mg, { k: 'd', s: p.s });
    }
    if (p.dash > 0) { p.vx = p.fx * C.DASH_SPEED; p.vz = p.fz * C.DASH_SPEED; }
    else {
      const k = Math.min(1, sec * C.ACCEL), ctl = p.stun > 0 ? 0 : 1;
      p.vx += (mx * C.SPEED * ctl - p.vx) * k;
      p.vz += (mz * C.SPEED * ctl - p.vz) * k;
    }
    const decay = Math.pow(0.5, dtMs / C.KB_HALF_MS);
    p.kx *= decay; p.kz *= decay;
    p.x += (p.vx + p.kx) * sec;
    p.z += (p.vz + p.kz) * sec;
    if (gust > 0 && mg.ice) {
      const near = clamp((mg.ice.side * p.z + HALF_H) / (2 * HALF_H), 0, 1);   // 0 far side .. 1 next to the ICE's track
      p.z += mg.ice.side * C.GUST * gust * (0.55 + 0.45 * near) * sec;
    }
    p.x = clamp(p.x, -HALF_W - 6, HALF_W + 6); p.z = clamp(p.z, -HALF_H - 6, HALF_H + 6);
  }

  // --- shoves: a dashing player pushes every rival it touches (once per dash) ---
  for (const p of mg.ps) {
    if (p.out !== null || p.dash <= 0) continue;
    for (const q of mg.ps) {
      if (q === p || q.out !== null || p.dh.includes(q.s)) continue;
      const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      if (d > C.TOUCH) continue;
      const nx = d > 0.001 ? dx / d : p.fx, nz = d > 0.001 ? dz / d : p.fz;
      q.kx += nx * C.SHOVE_KB; q.kz += nz * C.SHOVE_KB;
      q.stun = Math.max(q.stun, C.SHOVE_STUN_MS);
      q.dash = 0;
      q.ls = p.s; q.lt = mg.t;
      p.dh.push(q.s);
      pushEv(mg, { k: 's', s: p.s, o: q.s, x: r2(q.x), z: r2(q.z) });
    }
  }

  // --- players push each other apart a little (so crowds feel like crowds) ---
  for (let i = 0; i < mg.ps.length; i++) for (let j = i + 1; j < mg.ps.length; j++) {
    const a = mg.ps[i], b = mg.ps[j];
    if (a.out !== null || b.out !== null) continue;
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    if (d >= 2 * C.R || d < 0.001) continue;
    const push = (2 * C.R - d) / 2, nx = dx / d, nz = dz / d;
    a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
  }

  // --- ground check, falling ---
  for (const p of mg.ps) {
    if (p.out !== null) {   // already falling (decoration): gravity until the track bed, drift on
      if (p.y > C.FLOOR_Y) { p.vy -= C.GRAVITY * sec; p.y = Math.max(C.FLOOR_Y, p.y + p.vy * sec); }
      p.x += (p.vx + p.kx) * sec * 0.5; p.z += (p.vz + p.kz) * sec * 0.5;
      p.kx *= 0.9; p.kz *= 0.9;
      continue;
    }
    if (frozenWin || solidAt(mg.tw, p.x, p.z)) { p.air = 0; continue; }
    p.air += dtMs;
    if (p.air >= C.COYOTE_MS) {
      p.out = mg.t; p.vy = 0; p.dash = 0;
      const by = p.ls >= 0 && mg.t - p.lt <= C.CREDIT_MS ? p.ls : -1;
      if (by >= 0) mg.ps.find((q) => q.s === by).ko++;
      pushEv(mg, { k: 'o', s: p.s, by, x: r2(p.x), z: r2(p.z) });
    }
  }

  // --- end of game ---
  const live = alive(mg);
  if (mg.ps.length > 1 && live.length <= 1 && !mg.endAt) mg.endAt = mg.t + C.OUTRO_MS;
  if (mg.ps.length === 1 && mg.t >= mg.dur) mg.done = true;
  if (mg.endAt && mg.t >= mg.endAt) mg.done = true;
  if (mg.t >= mg.dur) mg.done = true;

  // --- tidy numbers (keeps the broadcast small and the sim reproducible) ---
  for (const p of mg.ps) for (const key of ['x', 'z', 'y', 'vx', 'vz', 'kx', 'kz']) p[key] = r2(p[key]);
  if (rng) mg.rs = rng.state();
  return mg;
}

const fmtSec = (ms) => (ms / 1000).toFixed(1).replace('.', ',');

/** Ranking, best first. Works on any state (also a hard-capped, not-yet-done one). Survivors tie. */
export function hostResult(mg) {
  const keyOf = (p) => (p.out === null ? [1, 0] : [0, p.out]);
  const cmp = (a, b) => { for (let i = 0; i < 2; i++) if (a[i] !== b[i]) return b[i] - a[i]; return 0; };
  const sorted = mg.ps.map((p) => ({ p, key: keyOf(p) })).sort((a, b) => cmp(a.key, b.key) || a.p.s - b.p.s);
  const placements = [], labels = {};
  let prevKey = null;
  for (const e of sorted) {
    if (prevKey && cmp(prevKey, e.key) === 0) placements[placements.length - 1].push(e.p.s); else placements.push([e.p.s]);
    prevKey = e.key;
    const extra = e.p.ko ? ` · ${e.p.ko}× rausgeschubst` : '';
    labels[e.p.s] = (e.p.out === null ? 'noch auf dem Bahnsteig' : `abgefahren nach ${fmtSec(e.p.out)} s`) + extra;
  }
  return { placements, labels };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// bot

/** deterministic noise in [0,1) from small integers (so the bot needs no rng for its "mood") */
function hash01(a, b, c) {
  let h = Math.imul(a + 1, 0x9E3779B1) ^ Math.imul(b + 7, 0x85EBCA6B) ^ Math.imul(c + 13, 0xC2B2AE35);
  h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12;
  return ((h >>> 0) % 10000) / 10000;
}

/** A sensible, imperfect bot for `seat`: picks a stable tile near the middle of the remaining platform that it can walk to without crossing holes or
 *  wobbling tiles, reacts a little late to wobbles, avoids the ICE's side while it is about, and shoves rivals that stand at an edge. Pure given (mg, rng).
 *  Returns an InputFrame (pressed.action = the shove press this frame). */
export function botFrame(mg, seat, rng) {
  const me = mg.ps.find((p) => p.s === seat);
  const frame = { move: { x: 0, y: 0 }, jump: false, action: false, confirm: false, back: false, pressed: { jump: false, action: false, confirm: false, back: false } };
  if (!me || me.out !== null) return frame;
  const react = 150 + Math.floor(hash01(seat, 1, 1) * 450);   // ms until this bot notices a wobble
  const unsafe = (x, z) => {
    const i = tileAt(x, z);
    if (i < 0 || mg.tw[i] === -1) return 1;
    if (mg.tw[i] > 0 && mg.tw[i] <= mg.wb - react) return 1;   // noticed
    return 0;
  };
  const stableCount = (i) => {   // solid neighbours (8) of tile i
    let n = 0;
    const c = tileCol(i), r = tileRow(i);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const cc = c + dc, rr = r + dr;
      if (cc >= 0 && cc < GW && rr >= 0 && rr < GH && mg.tw[rr * GW + cc] === 0) n++;
    }
    return n;
  };
  const block = Math.floor(mg.t / 700);
  const here = tileAt(me.x, me.z);
  const hereBad = unsafe(me.x, me.z) > 0;
  let best = null;
  for (let i = 0; i < mg.tw.length; i++) {
    if (mg.tw[i] !== 0) continue;
    const c = tileCenter(i);
    const d = Math.hypot(c.x - me.x, c.z - me.z);
    let cost = d * 1.0 - stableCount(i) * 0.45 + hash01(seat, block, i) * 1.6;
    if (i === here && !hereBad) cost -= 1.6;   // hysteresis: stay where it is fine
    // path hazards: sample the straight line
    const steps = Math.max(1, Math.ceil(d / 0.5));
    for (let s = 1; s < steps; s++) { const f = s / steps; if (unsafe(me.x + (c.x - me.x) * f, me.z + (c.z - me.z) * f)) cost += 3.5; }
    // rivals standing on the target
    for (const q of mg.ps) if (q.s !== seat && q.out === null && Math.hypot(q.x - c.x, q.z - c.z) < 0.9) cost += 1.4;
    // the ICE sucks you towards its track: stay on the far side
    if (mg.ice) cost += 0.5 * (mg.ice.side * c.z + HALF_H) / T;
    if (!best || cost < best.cost) best = { cost, i, c, d };
  }
  let mx = 0, mz = 0;
  if (best && best.d > 0.35) { mx = (best.c.x - me.x) / best.d; mz = (best.c.z - me.z) / best.d; }
  else if (!best) { mx = -me.x; mz = -me.z; }

  // some of the time a bot gets nasty: it walks up to the nearest rival (over safe tiles only) to give them a shove
  if (!hereBad && hash01(seat, Math.floor(mg.t / 3500), 99) < 0.3) {
    let prey = null;
    for (const q of mg.ps) {
      if (q.s === seat || q.out !== null) continue;
      const d = Math.hypot(q.x - me.x, q.z - me.z);
      if (!prey || d < prey.d) prey = { q, d };
    }
    if (prey && prey.d > 1.5) {
      let clear = true;
      const steps = Math.ceil(prey.d / 0.5);
      for (let s = 1; s < steps && clear; s++) { const f = s / steps; if (unsafe(me.x + (prey.q.x - me.x) * f, me.z + (prey.q.z - me.z) * f)) clear = false; }
      if (clear) { mx = (prey.q.x - me.x) / prey.d; mz = (prey.q.z - me.z) / prey.d; }
    }
  }

  // shove: a rival close by that stands where a shove would drop them (edge / hole / wobbling tile behind them), and where I stay safe myself
  if (me.cd === 0 && me.stun === 0 && me.dash === 0 && !hereBad) {
    let tgt = null;
    for (const q of mg.ps) {
      if (q.s === seat || q.out !== null) continue;
      const d = Math.hypot(q.x - me.x, q.z - me.z);
      if (d < 1.9 && (!tgt || d < tgt.d)) tgt = { q, d };
    }
    if (tgt) {
      const dx = (tgt.q.x - me.x) / tgt.d, dz = (tgt.q.z - me.z) / tgt.d;
      const exposed = unsafe(tgt.q.x + dx * 2.4, tgt.q.z + dz * 2.4) || unsafe(tgt.q.x + dx * 1.2, tgt.q.z + dz * 1.2);
      const selfSafe = !unsafe(me.x + dx * 2.2, me.z + dz * 2.2);
      if (selfSafe && rng.next() < (exposed ? 0.22 : 0.03)) {
        mx = dx; mz = dz;
        frame.action = true; frame.pressed.action = true;
      }
    }
  }
  frame.move = { x: r2(mx), y: r2(mz) };
  return frame;
}
