// Sitzplatz-Krieg im ICE: the host-side simulation (team game). PURE: no Kaplay, no DOM, no Date/Math.random. Same seed + same inputs => same game.
// Rules:
//  - 2 teams (team 0 = Rot, team 1 = Blau; `mg.teams` = [[seats],[seats]]). A carriage has SEAT_COUNT seats, all unclaimed at the start.
//  - Running over a seat paints it in your team colour (also flips the other team's seat). A freshly painted seat is immune for FLIP_CD_MS.
//  - `action` = "Jacke werfen": claims every seat within JACKET_R of you and locks them (RESERVIERT) for LOCK_MS. Cooldown JACKET_CD_MS.
//  - The Schaffner patrols the aisle; touching him flings you away and stuns you.
//  - At DURATION_MS the team with more seats wins; equal seats is a draw.
// OWNER-AUTHORITATIVE MOVEMENT (contracts section 10): every human client simulates its OWN body with stepBody() (tables are static obstacles, so the owner pushes itself out of them)
//  and reports it (mgOwn -> hostAdopt). The host trusts the report for the body (x y vx vy kx ky fx fy cd stun + the jacket serial jn) and keeps resolving everything else: the jacket
//  claim + lock (triggered by a new `jn`, at the position of the report that carried it), seat painting, the Schaffner (fling + stun delivered to the victim as an impulse, owner.js pushImp),
//  team colours, events. Seats without a fresh report (host-run test bots, disconnected/stale owners) are driven by their input frame exactly as before.
import { createRng } from '../../contracts.js';
import { adoptFields, isOwned, pushImp } from '../owner.js';

export const DURATION_MS = 35000;
export const ARENA = { w: 1280, h: 720, x0: 60, y0: 100, x1: 1220, y1: 640 };
export const AISLE = { y0: 292, y1: 448, cy: 370 };
export const SEAT = { w: 64, h: 56 };
export const BAYS = 5, BAY_W = 216, BAY_X0 = 100;
export const ROWS = [140, 260, 480, 600];     // seat row centre y: outer top, inner top, inner bottom, outer bottom
export const TABLE_ROWS = [200, 540];          // table centre y (top / bottom half)
export const TABLE = { w: 24, h: 44 };
export const TEAM_NAMES = ['Team Rot', 'Team Blau'];
export const TEAM_COLORS = ['#e5383b', '#1d7be0'];
export const C = {
  R: 20, SPEED: 285, ACCEL: 14, KB_HALF_MS: 110,
  TOUCH: 6, FLIP_CD_MS: 450,
  JACKET_R: 150, JACKET_CD_MS: 5500, LOCK_MS: 3200,
  SCH_R: 30, SCH_SPEED: 150, SCH_KB: 1000, SCH_STUN_MS: 550, SCH_IMMUNE_MS: 1400, EV_KEEP_MS: 700,
};

/** Seat centres, fixed for every game: index = bay * 8 + row * 2 + side. */
export const SEATS = (() => {
  const out = [];
  for (let b = 0; b < BAYS; b++) {
    const bx = BAY_X0 + b * BAY_W;
    for (let r = 0; r < ROWS.length; r++) for (let side = 0; side < 2; side++) out.push({ x: bx + 52 + side * 72, y: ROWS[r], bay: b, row: r });
  }
  return out;
})();
export const SEAT_COUNT = SEATS.length;
export const TABLES = (() => {
  const out = [];
  for (let b = 0; b < BAYS; b++) for (const y of TABLE_ROWS) out.push({ x: BAY_X0 + b * BAY_W + 88, y });
  return out;
})();

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ZERO = { move: { x: 0, y: 0 }, jump: false, action: false, confirm: false, back: false, pressed: { jump: false, action: false, confirm: false, back: false } };

/** @returns ArenaState */
export function hostInit({ seats, seed, rng, teams }) {
  const r = rng ?? createRng(seed);
  const tm = teams && teams.length === 2 ? teams.map((t) => t.slice()) : [seats.filter((_, i) => i % 2 === 0), seats.filter((_, i) => i % 2 === 1)];
  const ps = [];
  tm.forEach((members, ti) => {
    members.forEach((s, i) => {
      const x = ti === 0 ? 130 : 1150;
      const y = AISLE.cy + (i - (members.length - 1) / 2) * 60;
      ps.push({ s, tm: ti, x, y, vx: 0, vy: 0, kx: 0, ky: 0, fx: ti === 0 ? 1 : -1, fy: 0, cd: 0, stun: 0, bi: 0, jn: 0, jp: 0, jx: 0, jy: 0, ia: 0 });
    });
  });
  ps.sort((a, b) => a.s - b.s);
  return {
    t: 0, done: false, dur: DURATION_MS, teams: tm, ps,
    o: Array(SEAT_COUNT).fill(-1), lk: Array(SEAT_COUNT).fill(0), fc: Array(SEAT_COUNT).fill(0),
    sc: { x: r1(300 + r.next() * 600), y: AISLE.cy, d: r.next() < 0.5 ? -1 : 1, pz: 0, np: 4500 },
    eid: 0, ev: [], rs: r.state(), imp: [], iid: 0,
  };
}

function pushEv(mg, e) { mg.ev.push({ i: ++mg.eid, t: mg.t, ...e }); }

/** per-team seat counts [rot, blau] */
export function counts(mg) {
  const c = [0, 0];
  for (const o of mg.o) if (o >= 0) c[o]++;
  return c;
}

/** pushes the body `p` (a disc of radius C.R) out of the table rectangle centred at cx,cy (half sizes hw,hh) */
export function pushOutOfRect(p, cx, cy, hw, hh) {
  const nx = clamp(p.x, cx - hw, cx + hw), ny = clamp(p.y, cy - hh, cy + hh);
  const dx = p.x - nx, dy = p.y - ny, d = Math.hypot(dx, dy);
  if (d >= C.R) return;
  if (d < 0.001) {   // centre inside the box: leave through the nearest side
    const left = p.x - (cx - hw), right = cx + hw - p.x, up = p.y - (cy - hh), down = cy + hh - p.y;
    const m = Math.min(left, right, up, down);
    if (m === left) p.x = cx - hw - C.R; else if (m === right) p.x = cx + hw + C.R; else if (m === up) p.y = cy - hh - C.R; else p.y = cy + hh + C.R;
    return;
  }
  p.x += (dx / d) * (C.R - d); p.y += (dy / d) * (C.R - d);
}

/** tables are static obstacles: push the body out of every one of them */
export function pushOutTables(p) {
  for (const t of TABLES) pushOutOfRect(p, t.x, t.y, TABLE.w / 2, TABLE.h / 2);
}

/**
 * One tick of a player's body (pure; the host and the owner's client run the very same math). Timers count down, then, unless `env.passive`:
 * facing from the stick, velocity easing; then knockback decay and dead-reckoned position, clamped to the arena; tables push the body out (unless `env.tables === false`:
 * the host does its own table pass later in its tick); finally the jacket throw start (cooldown set).
 * `env.passive` = the host stepping an OWNED seat: the owner already did the input-driven part and reported the result, so only timers, decay and dead reckoning run.
 * `f` is an InputFrame (move + pressed). @returns true when a jacket was thrown this tick (the owner increments its serial `jn` then; the host claims seats).
 */
export function stepBody(p, f, dtMs, env = {}) {
  const sec = dtMs / 1000;
  p.cd = Math.max(0, p.cd - dtMs); p.stun = Math.max(0, p.stun - dtMs);
  if (!env.passive) {
    let mx = f.move?.x ?? 0, my = f.move?.y ?? 0;
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    const dl = Math.min(ml, 1);
    if (dl > 0.2 && p.stun === 0) { p.fx = r2(mx / dl); p.fy = r2(my / dl); }
    const k = Math.min(1, sec * C.ACCEL), ctl = p.stun > 0 ? 0 : 1;
    p.vx += (mx * C.SPEED * ctl - p.vx) * k;
    p.vy += (my * C.SPEED * ctl - p.vy) * k;
  }
  const decay = Math.pow(0.5, dtMs / C.KB_HALF_MS);
  p.kx *= decay; p.ky *= decay;
  p.x = clamp(p.x + (p.vx + p.kx) * sec, ARENA.x0, ARENA.x1);
  p.y = clamp(p.y + (p.vy + p.ky) * sec, ARENA.y0, ARENA.y1);
  if (env.tables !== false) pushOutTables(p);
  if (!env.passive && f.pressed?.action && p.cd === 0 && p.stun === 0) { p.cd = C.JACKET_CD_MS; return true; }
  return false;
}

/** jacket drop at (x, y): claims + locks every unlocked seat close by */
function claimJacket(mg, p, x, y) {
  let n = 0;
  for (let i = 0; i < SEAT_COUNT; i++) {
    const s = SEATS[i];
    if (Math.hypot(s.x - x, s.y - y) > C.JACKET_R || mg.lk[i] > 0) continue;
    mg.o[i] = p.tm; mg.lk[i] = C.LOCK_MS; mg.fc[i] = 0; n++;
  }
  pushEv(mg, { k: 'j', s: p.s, x: r1(x), y: r1(y), n });
}

/** Advances the game by dtMs. `inputs`: seat -> InputFrame (missing seat = no input). Mutates and returns mg. */
export function hostStep(mg, inputs, dtMs) {
  if (mg.done) return mg;
  const sec = dtMs / 1000;
  mg.t += dtMs;
  mg.ev = mg.ev.filter((e) => mg.t - e.t <= C.EV_KEEP_MS);
  for (let i = 0; i < SEAT_COUNT; i++) {
    if (mg.lk[i] > 0) mg.lk[i] = Math.max(0, mg.lk[i] - dtMs);
    if (mg.fc[i] > 0) mg.fc[i] = Math.max(0, mg.fc[i] - dtMs);
  }

  // --- players: an owned seat keeps only timers + dead reckoning (its body comes from hostAdopt) and claims its jacket when the owner reported a new serial;
  //     the others follow their input frame (a pressed action throws the jacket) ---
  for (const p of mg.ps) {
    p.bi = Math.max(0, p.bi - dtMs);   // Schaffner immunity: host-only (the owner's body has no bi)
    if (stepBody(p, inputs?.[p.s] ?? ZERO, dtMs, { passive: isOwned(p, mg.t), tables: false })) claimJacket(mg, p, p.x, p.y);
    while (p.jp > 0) { p.jp--; claimJacket(mg, p, p.jx, p.jy); }   // one claim per reported serial, at the position of the report that carried it
  }

  // --- players push each other apart a little; tables are obstacles ---
  for (let i = 0; i < mg.ps.length; i++) for (let j = i + 1; j < mg.ps.length; j++) {
    const a = mg.ps[i], b = mg.ps[j];
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d >= 2 * C.R || d < 0.001) continue;
    const push = (2 * C.R - d) / 2, nx = dx / d, ny = dy / d;
    if (!isOwned(a, mg.t)) { a.x -= nx * push; a.y -= ny * push; }   // an owned seat does its half itself, client-side
    if (!isOwned(b, mg.t)) { b.x += nx * push; b.y += ny * push; }
  }
  for (const p of mg.ps) pushOutTables(p);

  // --- Schaffner ---
  let rng = null;
  const R = () => (rng ??= createRng(mg.rs));
  const sc = mg.sc;
  if (sc.pz > 0) sc.pz = Math.max(0, sc.pz - dtMs);
  else {
    sc.x += sc.d * C.SCH_SPEED * sec;
    if (sc.x < ARENA.x0 + 20) { sc.x = ARENA.x0 + 20; sc.d = 1; }
    if (sc.x > ARENA.x1 - 20) { sc.x = ARENA.x1 - 20; sc.d = -1; }
    if (mg.t >= sc.np) {
      sc.pz = 1100; sc.np = mg.t + 3500 + R().next() * 3000;
      if (R().next() < 0.4) sc.d = -sc.d;
      pushEv(mg, { k: 'z', x: r1(sc.x), y: r1(sc.y) });
    }
  }
  sc.y = r1(AISLE.cy + Math.sin(mg.t / 650) * 48);
  sc.x = r1(sc.x);
  for (const p of mg.ps) {
    if (p.bi > 0) continue;
    const dx = p.x - sc.x, dy = p.y - sc.y, d = Math.hypot(dx, dy);
    if (d >= C.SCH_R + C.R) continue;
    const nx = d > 0.001 ? dx / d : 0, ny = d > 0.001 ? dy / d : 1;
    pushImp(mg, p, p.s, { kx: nx * C.SCH_KB, ky: ny * C.SCH_KB, st: C.SCH_STUN_MS });   // the victim's owner applies it locally and acks; the host copy gets the same hit
    p.bi = C.SCH_IMMUNE_MS;
    pushEv(mg, { k: 'b', s: p.s, x: r1(p.x), y: r1(p.y) });
  }

  // --- painting seats ---
  for (const p of mg.ps) {
    if (p.stun > 0) continue;
    for (let i = 0; i < SEAT_COUNT; i++) {
      const s = SEATS[i];
      if (Math.abs(p.x - s.x) > SEAT.w / 2 + C.TOUCH || Math.abs(p.y - s.y) > SEAT.h / 2 + C.TOUCH) continue;
      if (mg.o[i] === p.tm || mg.lk[i] > 0 || mg.fc[i] > 0) continue;
      mg.o[i] = p.tm; mg.fc[i] = C.FLIP_CD_MS;
    }
  }

  for (const p of mg.ps) for (const key of ['x', 'y', 'vx', 'vy', 'kx', 'ky']) p[key] = r1(p[key]);
  if (rng) mg.rs = rng.state();
  if (mg.t >= mg.dur) mg.done = true;
  return mg;
}

// The fields an owner reports. kin = kinematic: ignored until the owner has acked the latest impulse (a report from before a hit must not overwrite the knockback).
// jn = the jacket serial: the owner counts its jacket throws, a new value tells the host "claim the seats around my reported position now". Team (tm), bi, jp/jx/jy, ia are host-owned.
const OWNED = {
  x: { lo: ARENA.x0, hi: ARENA.x1, kin: true }, y: { lo: ARENA.y0, hi: ARENA.y1, kin: true },
  vx: { lo: -400, hi: 400, kin: true }, vy: { lo: -400, hi: 400, kin: true },           // walking speed is 285
  kx: { lo: -2500, hi: 2500, kin: true }, ky: { lo: -2500, hi: 2500, kin: true },       // two stacked Schaffner flings are ~2000
  fx: { lo: -1, hi: 1, dp: 2, kin: true }, fy: { lo: -1, hi: 1, dp: 2, kin: true },
  cd: { lo: 0, hi: C.JACKET_CD_MS, kin: true }, stun: { lo: 0, hi: C.SCH_STUN_MS * 2, kin: true },
  jn: { lo: 0, hi: 1e6, serial: true },
};

/** Host: adopt one owner report (runner calls it once per fresh mgOwn report, before the sim batch). Whitelist + clamp only. A reported position inside a table is pushed out
 *  (tables are static, an honest owner never reports one; this keeps seat painting and the jacket claim exact). A new `jn` queues one jacket claim (p.jp) at the reported position. */
export function hostAdopt(mg, seat, report) {
  const p = mg.ps.find((q) => q.s === seat);
  const res = adoptFields(p, report, OWNED, mg.t);
  if (!res) return res;
  if (!res.gated) pushOutTables(p);
  if (res.changed.includes('jn')) {
    // a gated report (it predates a Schaffner hit) did not move p; the throw still happened where the report says
    const fin = (v) => typeof v === 'number' && Number.isFinite(v);
    const at = res.gated && fin(report.x) && fin(report.y) ? { x: clamp(report.x, ARENA.x0, ARENA.x1), y: clamp(report.y, ARENA.y0, ARENA.y1) } : p;
    p.jp = (p.jp ?? 0) + 1; p.jx = at.x; p.jy = at.y;
  }
  return res;
}

/** Ranking: one group per team, best first; equal seat counts => everybody in one group (draw). */
export function hostResult(mg) {
  const c = counts(mg);
  const labels = {};
  for (const p of mg.ps) labels[p.s] = `${TEAM_NAMES[p.tm]}: ${c[p.tm]} von ${SEAT_COUNT} Plätzen`;
  if (c[0] === c[1]) return { placements: [mg.ps.map((p) => p.s)], labels };
  const win = c[0] > c[1] ? 0 : 1;
  return { placements: [mg.teams[win].slice(), mg.teams[1 - win].slice()], labels };
}

/** A sensible, imperfect bot for `seat`. `mem` is the bot's own scratch object ({target, until}); pure given (mg, rng, mem).
 *  Runs for a nearby seat not in its colour (noisy pick), drops a jacket when several foreign seats are close, dodges the Schaffner. */
export function botFrame(mg, seat, rng, mem = {}) {
  const me = mg.ps.find((p) => p.s === seat);
  const frame = { move: { x: 0, y: 0 }, jump: false, action: false, confirm: false, back: false, pressed: { jump: false, action: false, confirm: false, back: false } };
  if (!me) return frame;
  const foreign = (i) => mg.o[i] !== me.tm && mg.lk[i] === 0;
  if (mem.target == null || mg.t >= (mem.until ?? 0) || !foreign(mem.target)) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < SEAT_COUNT; i++) {
      if (!foreign(i)) continue;
      const d = Math.hypot(SEATS[i].x - me.x, SEATS[i].y - me.y) + rng.next() * 140 + (mg.o[i] === -1 ? 0 : -25);
      if (d < bd) { bd = d; best = i; }
    }
    mem.target = best >= 0 ? best : null;
    mem.until = mg.t + 500 + rng.next() * 900;
  }
  let mx = 0, my = 0;
  if (mem.target != null) {
    const s = SEATS[mem.target];
    const dx = s.x - me.x, dy = s.y - me.y, d = Math.hypot(dx, dy) || 1;
    mx = dx / d; my = dy / d;
  }
  const sd = Math.hypot(me.x - mg.sc.x, me.y - mg.sc.y) || 1;
  if (sd < 120 && me.bi === 0) { mx += ((me.x - mg.sc.x) / sd) * 1.6; my += ((me.y - mg.sc.y) / sd) * 1.6; }
  mx += (rng.next() - 0.5) * 0.35; my += (rng.next() - 0.5) * 0.35;
  frame.move = { x: r2(mx), y: r2(my) };
  if (me.cd === 0 && me.stun === 0 && rng.next() < 0.08) {
    let n = 0;
    for (let i = 0; i < SEAT_COUNT; i++) if (foreign(i) && Math.hypot(SEATS[i].x - me.x, SEATS[i].y - me.y) <= C.JACKET_R) n++;
    if (n >= 4) { frame.action = true; frame.pressed.action = true; }
  }
  return frame;
}
