// Aura-Farming: the host-side simulation. PURE: no Kaplay, no DOM, no Date/Math.random. Same seed + same inputs => same game.
// State is plain JSON (it is broadcast as mgState). Rules:
//  - glowing aura orbs (+100, sometimes +200, rarely a golden "Sigma" orb worth +1000) keep spawning on the yard; walk over one to take it.
//  - `action` or `jump` (X/Y/E/Shift or A/Space) = bump: a short dash. Every rival touched during the dash is knocked back + stunned and SPILLS part of their aura as orbs (their own
//    spill is locked for them for EX_MS, so the bumper - or anyone nearby - gets first dibs). A fresh victim is bump-proof for BUMP_INV_MS.
//  - aura is never negative and a bump conserves it: aura lost = value of the orbs spilled.
//  - most aura at the end wins; equal aura ties.
import { createRng } from '../../contracts.js';

export const DURATION_MS = 30000;
export const ARENA = { w: 1280, h: 720, x0: 40, y0: 90, x1: 1240, y1: 690 };   // x0..y1 = where players may walk
export const C = {
  R: 22, SPEED: 275, ACCEL: 14,
  DASH_MS: 180, DASH_SPEED: 850, COOLDOWN_MS: 1100, BUMP_KB: 1100, BUMP_STUN_MS: 350, KB_HALF_MS: 90, BUMP_INV_MS: 700,
  ORB_R: 16, PICK_R: 18, GOLD_VALUE: 1000, GOLD_TTL_MS: 9000, GOLD_CHANCE: 0.05,
  SPAWN_MS: 420, ORB_CAP_BASE: 10, ORB_CAP_PER_PLAYER: 2, START_ORBS: 8,
  SPILL_FRAC: 0.3, SPILL_MAX_ORBS: 6, SPILL_SPEED: 380, SPILL_HALF_MS: 220, EX_MS: 900, EV_KEEP_MS: 600,
};

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ZERO = { move: { x: 0, y: 0 }, jump: false, action: false, confirm: false, back: false, pressed: { jump: false, action: false, confirm: false, back: false } };

/** German thousands separator: 1200 -> '1.200' */
export const fmtAura = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** How much aura a bump knocks out of a player holding `aura` (a multiple of 100, at most `aura`). */
export function spillAmount(aura) {
  if (aura <= 0) return 0;
  return Math.min(aura, Math.max(100, Math.round((aura * C.SPILL_FRAC) / 100) * 100));
}

/** @returns ArenaState */
export function hostInit({ seats, seed, rng }) {
  const r = rng ?? createRng(seed);
  const rot = r.next() * Math.PI * 2;
  const cx = (ARENA.x0 + ARENA.x1) / 2, cy = (ARENA.y0 + ARENA.y1) / 2;
  const ps = seats.map((s, i) => {
    const a = rot + (i / seats.length) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    return { s, x: r1(cx + dx * 380), y: r1(cy + dy * 220), vx: 0, vy: 0, kx: 0, ky: 0, fx: r2(-dx), fy: r2(-dy), dash: 0, cd: 0, stun: 0, binv: 0, aura: 0, dh: [] };
  });
  const mg = { t: 0, done: false, dur: DURATION_MS, ps, orbs: [], next: 600, nid: 1, eid: 0, gold: 0, ev: [], rs: 0 };
  for (let i = 0; i < C.START_ORBS; i++) spawnOrb(mg, r);
  mg.rs = r.state();
  return mg;
}

const orbCap = (mg) => C.ORB_CAP_BASE + C.ORB_CAP_PER_PLAYER * mg.ps.length;
function pushEv(mg, e) { mg.ev.push({ i: ++mg.eid, t: mg.t, ...e }); }

function spawnOrb(mg, rng) {
  const gold = rng.next() < C.GOLD_CHANCE || (mg.t > 12000 && mg.gold === 0);
  const big = !gold && rng.next() < 0.25;
  mg.orbs.push({
    id: mg.nid++, v: gold ? C.GOLD_VALUE : big ? 200 : 100, g: gold ? 1 : 0,
    x: r1(rng.int(ARENA.x0 + 30, ARENA.x1 - 30)), y: r1(rng.int(ARENA.y0 + 30, ARENA.y1 - 30)),
    vx: 0, vy: 0, ex: -1, exm: 0, ttl: gold ? C.GOLD_TTL_MS : 0,
  });
  if (gold) mg.gold++;
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
    const f = inputs?.[p.s] ?? ZERO;
    p.dash = Math.max(0, p.dash - dtMs); p.cd = Math.max(0, p.cd - dtMs); p.stun = Math.max(0, p.stun - dtMs); p.binv = Math.max(0, p.binv - dtMs);
    let mx = f.move?.x ?? 0, my = f.move?.y ?? 0;
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    const dl = Math.min(ml, 1);
    if (dl > 0.2 && p.stun === 0) { p.fx = r2(mx / dl); p.fy = r2(my / dl); }
    if ((f.pressed?.action || f.pressed?.jump) && p.cd === 0 && p.stun === 0 && p.dash === 0) { p.dash = C.DASH_MS; p.cd = C.COOLDOWN_MS; p.dh = []; }
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

  // --- bumps: a dashing player hits every rival it touches (once per dash) and makes them spill aura ---
  for (const p of mg.ps) {
    if (p.dash <= 0) continue;
    for (const q of mg.ps) {
      if (q === p || p.dh.includes(q.s)) continue;
      const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
      if (d > 2 * C.R + 10) continue;
      p.dh.push(q.s);
      if (q.binv > 0) { pushEv(mg, { k: 'b', s: p.s, o: q.s, l: 0, x: r1(q.x), y: r1(q.y) }); continue; }
      const nx = d > 0.001 ? dx / d : p.fx, ny = d > 0.001 ? dy / d : p.fy;
      q.kx += nx * C.BUMP_KB; q.ky += ny * C.BUMP_KB;
      q.stun = Math.max(q.stun, C.BUMP_STUN_MS);
      q.binv = C.BUMP_INV_MS;
      const lost = spillAmount(q.aura);
      if (lost > 0) {
        q.aura -= lost;
        const g = R();
        const units = lost / 100, n = Math.min(units, C.SPILL_MAX_ORBS);   // split `units` hundreds over n orbs as evenly as possible
        for (let i = 0; i < n; i++) {
          const share = Math.floor(units / n) + (i < units % n ? 1 : 0);
          const a = (i / n) * Math.PI * 2 + g.next() * 1.2;
          const sp = C.SPILL_SPEED * (0.6 + g.next() * 0.6);
          mg.orbs.push({ id: mg.nid++, v: share * 100, g: 0, x: r1(q.x), y: r1(q.y), vx: r1(Math.cos(a) * sp), vy: r1(Math.sin(a) * sp), ex: q.s, exm: C.EX_MS, ttl: 0 });
        }
      }
      pushEv(mg, { k: 'b', s: p.s, o: q.s, l: lost, x: r1(q.x), y: r1(q.y) });
    }
  }

  // --- players push each other apart a little ---
  for (let i = 0; i < mg.ps.length; i++) for (let j = i + 1; j < mg.ps.length; j++) {
    const a = mg.ps[i], b = mg.ps[j];
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d >= 2 * C.R || d < 0.001) continue;
    const push = (2 * C.R - d) / 2, nx = dx / d, ny = dy / d;
    a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
  }

  // --- orbs: spilled ones fly out, golden ones expire, new ones spawn ---
  const odecay = Math.pow(0.5, dtMs / C.SPILL_HALF_MS);
  for (const o of mg.orbs) {
    if (o.vx !== 0 || o.vy !== 0) {
      o.x = r1(clamp(o.x + o.vx * sec, ARENA.x0 + 12, ARENA.x1 - 12)); o.y = r1(clamp(o.y + o.vy * sec, ARENA.y0 + 12, ARENA.y1 - 12));
      o.vx = r1(o.vx * odecay); o.vy = r1(o.vy * odecay);
      if (Math.abs(o.vx) < 4 && Math.abs(o.vy) < 4) { o.vx = 0; o.vy = 0; }
    }
    if (o.exm > 0) { o.exm = Math.max(0, o.exm - dtMs); if (o.exm === 0) o.ex = -1; }
    if (o.g) o.ttl -= dtMs;
  }
  mg.orbs = mg.orbs.filter((o) => !(o.g && o.ttl <= 0));

  mg.next -= dtMs;
  while (mg.next <= 0) {
    if (mg.orbs.length < orbCap(mg)) spawnOrb(mg, R());
    mg.next += C.SPAWN_MS;
  }

  // --- pickups: the nearest eligible player in reach takes the orb ---
  const taken = new Set();
  for (const o of mg.orbs) {
    let best = null, bd = Infinity;
    for (const p of mg.ps) {
      if (p.s === o.ex) continue;
      const d = Math.hypot(p.x - o.x, p.y - o.y);
      if (d < C.R + C.PICK_R && d < bd) { best = p; bd = d; }
    }
    if (!best) continue;
    best.aura += o.v;
    taken.add(o.id);
    pushEv(mg, { k: 'p', s: best.s, v: o.v, g: o.g, x: r1(o.x), y: r1(o.y) });
  }
  if (taken.size) mg.orbs = mg.orbs.filter((o) => !taken.has(o.id));

  // --- tidy numbers (keeps the broadcast small and the sim reproducible) ---
  for (const p of mg.ps) for (const key of ['x', 'y', 'vx', 'vy', 'kx', 'ky']) p[key] = r1(p[key]);
  if (rng) mg.rs = rng.state();
  if (mg.t >= mg.dur) mg.done = true;
  return mg;
}

/** Ranking, best first (most aura). Works on any state (also a hard-capped, not-yet-done one). Equal aura ties. */
export function hostResult(mg) {
  const sorted = mg.ps.slice().sort((a, b) => b.aura - a.aura || a.s - b.s);
  const placements = [], labels = {};
  let prev = null;
  for (const p of sorted) {
    if (prev && prev.aura === p.aura) placements[placements.length - 1].push(p.s); else placements.push([p.s]);
    prev = p;
    labels[p.s] = `${fmtAura(p.aura)} Aura`;
  }
  return { placements, labels };
}

/** A sensible bot for `seat`: heads for the best nearby orb (value vs. distance, golden ones are very attractive), and bumps rivals that are
 *  close and carrying a lot. Imperfect: slow wobble in the heading, random hesitation. Pure given (mg, rng). Returns an InputFrame. */
export function botFrame(mg, seat, rng) {
  const me = mg.ps.find((p) => p.s === seat);
  const frame = { move: { x: 0, y: 0 }, jump: false, action: false, confirm: false, back: false, pressed: { jump: false, action: false, confirm: false, back: false } };
  if (!me) return frame;

  // rival worth a bump: close, rich (the richer and closer the better)
  let prey = null;
  for (const q of mg.ps) {
    if (q.s === seat || q.binv > 0 || q.aura < 200) continue;
    const d = Math.hypot(q.x - me.x, q.y - me.y);
    if (d < 200 && (!prey || q.aura / (d + 60) > prey.q.aura / (prey.d + 60))) prey = { q, d };
  }
  // best orb: score = distance - 0.35 * value (gold reads as ~350 px closer); a tiny per-seat offset keeps ties stable
  let orb = null, os = Infinity;
  for (const o of mg.orbs) {
    if (o.ex === seat) continue;
    const sc = Math.hypot(o.x - me.x, o.y - me.y) - 0.35 * o.v + ((o.id * 7 + seat * 13) % 40);
    if (sc < os) { os = sc; orb = o; }
  }
  let tx = (ARENA.x0 + ARENA.x1) / 2, ty = (ARENA.y0 + ARENA.y1) / 2;
  if (prey && (!orb || prey.q.aura >= 500 || prey.d < 120)) { tx = prey.q.x; ty = prey.q.y; } else if (orb) { tx = orb.x; ty = orb.y; }
  const dist = Math.hypot(tx - me.x, ty - me.y);
  const ang = Math.atan2(ty - me.y, tx - me.x) + 0.3 * Math.sin(mg.t / 650 + seat * 2.1);   // wobble: never perfectly straight
  const go = dist < 14 ? 0 : 1;
  frame.move = { x: r2(Math.cos(ang) * go), y: r2(Math.sin(ang) * go) };

  if (prey && me.cd === 0 && me.stun === 0 && me.dash === 0 && prey.d < 95 && rng.next() < 0.18 + Math.min(0.3, prey.q.aura / 4000)) {
    frame.move = { x: r2((prey.q.x - me.x) / (prey.d || 1)), y: r2((prey.q.y - me.y) / (prey.d || 1)) };
    frame.action = true; frame.pressed.action = true;
  }
  return frame;
}
