// Forza: the fake download curve + scoring. Pure (no Kaplay, no DOM), so it is unit-testable and identical on every client.
import { createRng } from '../../contracts.js';

export const ATTEMPTS = 3;
export const DURATION_MS = 40000;   // 3 attempts of <= ~9 s each plus the pauses between them
export const CAP = 106;          // the bar runs on past 100 % until here, then the file is "beschädigt" automatically
export const PERFECT_MIN = 99.5; // perfect = stopped within [99.5, 100.0]

/** Points for one stop at `v` percent. Max 1000. Undershoot loses 80 per %, overshoot is a corrupt file: at most 500 and 100 less per %. */
export function scoreAttempt(v) {
  if (!Number.isFinite(v)) return 0;
  const r = Math.round(v * 10) / 10;   // what the player sees (one decimal)
  const pts = r <= 100 ? 1000 - 80 * (100 - r) : 500 - 100 * (r - 100);
  return Math.max(0, Math.round(pts));
}
export const isOvershoot = (v) => Math.round(v * 10) / 10 > 100;
export const isPerfect = (v) => { const r = Math.round(v * 10) / 10; return r >= PERFECT_MIN && r <= 100; };

/** Appends `parts` keyframes from (t0,v0) to (t1,v1) with uneven step sizes = jittery speed. `accel` makes the steps grow (speeds up). */
function jitter(pts, rng, t0, v0, t1, v1, parts, label, accel = false) {
  const w = Array.from({ length: parts }, (_, i) => (0.25 + rng.next() * 1.5) * (accel ? 1 + i : 1));
  const sum = w.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < parts; i++) {
    acc += w[i] / sum;
    pts.push({ t: t0 + ((i + 1) / parts) * (t1 - t0), v: v0 + acc * (v1 - v0), label });
  }
}

/**
 * One download. Keyframes (t ms, percent) joined linearly:
 * load (fast, jittery) -> short hang -> rush (speeds up) -> stalls at 99 % -> jumps back, "Entpacke…" -> slow crawl through 100 % up to CAP.
 * @returns {{ valueAt(t:number):number, labelAt(t:number):string, t100:number, tCap:number }}
 */
export function makeCurve(rng) {
  const pts = [{ t: 0, v: 0, label: 'load' }];
  const last = () => pts[pts.length - 1];
  const a = 38 + rng.next() * 14;
  jitter(pts, rng, 0, 0, 1100 + rng.next() * 500, a, rng.int(4, 6), 'load');
  pts.push({ t: last().t + 350 + rng.next() * 400, v: a + 0.4, label: 'hang' });
  jitter(pts, rng, last().t, last().v, last().t + 700 + rng.next() * 300, 99, rng.int(3, 4), 'rush', true);
  pts.push({ t: last().t + 1300 + rng.next() * 900, v: 99.3, label: 'stall' });
  const back = 58 + rng.next() * 14;
  pts.push({ t: last().t + 80, v: back, label: 'unpack' });
  const to = 90 + rng.next() * 3;
  jitter(pts, rng, last().t, back, last().t + 900 + rng.next() * 500, to, rng.int(4, 6), 'unpack');
  const t100 = last().t + ((100 - to) / (4.2 + rng.next() * 2.4)) * 1000;   // 4-7 %/s: the last stretch is a crawl
  jitter(pts, rng, last().t, to, t100, 100, rng.int(3, 5), 'crawl');
  const tCap = t100 + ((CAP - 100) / (4.5 + rng.next() * 2)) * 1000;
  jitter(pts, rng, t100, 100, tCap, CAP, 3, 'over');

  const seg = (t) => {
    for (let i = 1; i < pts.length; i++) if (t <= pts[i].t) return i;
    return pts.length - 1;
  };
  return {
    t100, tCap,
    valueAt(t) {
      if (t <= 0) return 0;
      if (t >= tCap) return CAP;
      const i = seg(t), p = pts[i - 1], q = pts[i];
      return p.v + ((t - p.t) / (q.t - p.t)) * (q.v - p.v);
    },
    labelAt(t) { return pts[seg(Math.max(0, t))].label; },
  };
}

/** The three attempts of one game, from the shared seed (every client builds the same ones). */
export const makeCurves = (seed) => { const rng = createRng(seed); return Array.from({ length: ATTEMPTS }, () => makeCurve(rng)); };
