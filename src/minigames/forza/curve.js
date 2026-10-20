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

const R = (rng, a, b) => a + rng.next() * (b - a);
const DROP_LABELS = ['unpack', 'verify', 'shader'];
export const FINAL_STYLES = ['crawl', 'fast', 'stutter', 'stall'];
const WIN_LO = 98.5, WIN_HI = 100.5, MIN_CATCH_MS = 320;   // the final approach must spend this long inside the window (the contract is >= 250 ms)
const OVER_FROM = 100.5;

/** Keyframe path builder: points {t ms, v %, label, kind}, joined linearly. */
function builder(v0, label0) {
  const pts = [{ t: 0, v: v0, label: label0, kind: 'start' }];
  const end = () => pts[pts.length - 1];
  return {
    pts, end,
    to(kind, label, dur, v) { pts.push({ t: end().t + Math.max(30, dur), v, label, kind }); },
    /** `parts` keyframes with uneven step sizes = jittery speed. `accel` makes the steps grow (speeds up). */
    jit(rng, kind, label, dur, v1, parts, accel = false) {
      const { t: t0, v: v0_ } = end();
      const w = Array.from({ length: parts }, (_, i) => (0.25 + rng.next() * 1.5) * (accel ? 1 + i : 1));
      const sum = w.reduce((a, c) => a + c, 0);
      let acc = 0;
      for (let i = 0; i < parts; i++) {
        acc += w[i] / sum;
        pts.push({ t: t0 + ((i + 1) / parts) * Math.max(30, dur), v: v0_ + acc * (v1 - v0_), label, kind });
      }
    },
  };
}

function interp(pts, t) {
  if (t <= 0) return pts[0].v;
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i].t) { const p = pts[i - 1], q = pts[i]; return p.v + ((t - p.t) / (q.t - p.t)) * (q.v - p.v); }
  }
  return pts[pts.length - 1].v;
}
/** ms spent inside [98.5, 100.5] */
function catchMs(pts) {
  let n = 0;
  const tEnd = pts[pts.length - 1].t;
  for (let t = 0; t <= tEnd; t += 2) { const v = interp(pts, t); if (v >= WIN_LO && v <= WIN_HI) n += 2; }
  return n;
}
function firstCross(pts, level) {
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i];
    if (q.v >= level && p.v < level) return p.t + ((level - p.v) / (q.v - p.v)) * (q.t - p.t);
  }
  return pts[pts.length - 1].t;
}

/** The pre-phase: a random run of climbs (fill / burst), stalls, stutters and fake-out drop-backs, ending at `ap`. */
function buildPre(rng, ap, nLevels, withPeak) {
  const b = builder(0, 'load');
  const cap = (x) => Math.min(99.2, x);
  const climb = (to, label, minRate = 8, maxRate = 24) => {
    const dv = to - b.end().v;
    if (Math.abs(dv) < 0.01) return;
    const burst = dv > 8 && rng.next() < 0.4 && minRate < 10;
    const rate = burst ? R(rng, 30, 70) : R(rng, minRate, maxRate);   // %/s
    b.jit(rng, burst ? 'burst' : 'fill', burst ? 'rush' : label, Math.min(3500, Math.max(300, (dv / rate) * 1000)), to, rng.int(2, 5), burst);
  };
  const drop = () => {
    const n = rng.next() < 0.25 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const v = b.end().v, lab = rng.pick(DROP_LABELS);
      b.to('drop', lab, R(rng, 40, 160), Math.max(5, v * R(rng, 0.35, 0.9)));
      if (rng.next() < 0.5) b.to('hold', lab, R(rng, 250, 800), b.end().v + R(rng, 0, 1.5));
    }
  };
  const stall = () => { const v = b.end().v; b.to('stall', v > 96 ? 'stall' : 'hang', R(rng, 400, 1600), cap(v + R(rng, 0, 0.15))); };
  const stutter = () => {
    const v = b.end().v, amp = v > 96 ? R(rng, 0.1, 0.3) : R(rng, 0.3, 1.6), n = rng.int(3, 6);
    for (let i = 0; i < n; i++) b.to('stutter', 'stutter', R(rng, 70, 190), cap(v + (i % 2 ? -1 : 1) * amp * R(rng, 0.5, 1)));
    b.to('stutter', 'stutter', 100, v);
  };
  const deco = () => { const r = rng.next(); (r < 0.4 ? stall : r < 0.7 ? stutter : drop)(); };

  const levels = Array.from({ length: nLevels }, () => R(rng, 10, ap - 3)).sort((x, y) => x - y);
  for (const lv of levels) { climb(lv, 'load'); if (rng.next() < 0.65) deco(); }
  if (withPeak) {   // a fake finish: up to 96-99.2 %, hang or stutter there, then fall back
    climb(R(rng, Math.max(ap + 0.6, 96), 99.2), 'load', 10, 25);
    if (rng.next() < 0.7) stall(); else stutter();
    b.to('drop', rng.pick(DROP_LABELS), R(rng, 40, 140), R(rng, 20, ap - 10));
    if (rng.next() < 0.5) b.to('hold', 'verify', R(rng, 250, 700), b.end().v + R(rng, 0, 1.5));
    climb(ap, rng.pick(DROP_LABELS), 8, 20);
  } else climb(ap, 'load');
  if (Math.abs(b.end().v - ap) > 1e-9) b.to('fill', 'load', 200, ap);
  return b;
}

/** The final approach from `ap` through 100 up to the cap; local time starts at 0. */
function buildFinal(rng, style, ap, crawlRate = R(rng, 2.2, 4.5)) {
  const lab = rng.pick(['crawl', 'crawl', 'verify', 'shader']);
  const b = builder(ap, lab);
  if (style === 'crawl' || style === 'linear') {
    const rate = crawlRate;
    b.jit(rng, 'crawl', lab, ((OVER_FROM - ap) / rate) * 1000, OVER_FROM, style === 'linear' ? 1 : rng.int(3, 6));
  } else if (style === 'fast') {   // surge to 98.0, then a quick 4.5-6.5 %/s pass
    b.jit(rng, 'burst', 'rush', ((98.0 - ap) / R(rng, 25, 45)) * 1000, 98.0, 2, true);
    b.jit(rng, 'pass', lab, ((OVER_FROM - 98.0) / R(rng, 4.5, 6.5)) * 1000, OVER_FROM, 2);
  } else if (style === 'stutter') {   // jitter back and forth around 99.x - 100.x
    const c0 = R(rng, 98.8, 99.3);
    b.to('fill', lab, ((c0 - ap) / R(rng, 3, 6)) * 1000, c0);
    const n = rng.int(5, 9), c1 = R(rng, 99.6, 100.1);
    for (let i = 0; i < n; i++) {
      const c = c0 + ((c1 - c0) * (i + 1)) / n;
      b.to('stutter', 'stutter', R(rng, 90, 230), Math.min(100.4, Math.max(98.6, c + (i % 2 ? -1 : 1) * R(rng, 0.2, 0.7))));
    }
    b.to('pass', lab, ((OVER_FROM - b.end().v) / R(rng, 2.5, 5)) * 1000, OVER_FROM);
  } else {   // 'stall': hang just under 100, then crawl on
    const h = R(rng, 98.2, 99.4);
    b.to('fill', lab, ((h - ap) / R(rng, 8, 15)) * 1000, h);
    b.to('stall', 'stall', R(rng, 500, 1600), h + R(rng, 0, 0.1));
    b.jit(rng, 'pass', lab, ((OVER_FROM - b.end().v) / R(rng, 2.5, 5)) * 1000, OVER_FROM, 2);
  }
  b.jit(rng, 'over', 'over', ((CAP - OVER_FROM) / R(rng, 7, 14)) * 1000, CAP, 3);
  return b;
}

/**
 * One download, unpredictable per attempt. Keyframes (t ms, percent) joined linearly:
 * a random run of fill/burst/stall/stutter/drop-back segments (+ label phases) climbs to an approach point, then one of four final
 * approaches (slow crawl / fast pass / stutter around 99-100 / hang then crawl) runs through 100 % up to CAP.
 * The first 100 % lands anywhere in ~2.6-8.6 s; the final approach always spends >= 320 ms inside 98.5-100.5.
 * @returns {{ valueAt(t:number):number, labelAt(t:number):string, t100:number, tCap:number, style:string, kinds:string[], catchMs:number }}
 */
export function makeCurve(rng) {
  const T = R(rng, 2600, 8600);   // target time of the first 100 %
  const styles = T < 4800 ? ['crawl', 'fast'] : FINAL_STYLES;
  const style = rng.pick(styles);
  const apRange = { crawl: [80, 95], fast: [88, 96], stutter: [96, 98], stall: [97.5, 98] }[style];
  let ap = R(rng, apRange[0], apRange[1]);
  const crawlRate = R(rng, 2.2, 4.5);
  if (style === 'crawl') ap = Math.max(ap, OVER_FROM - crawlRate * ((T - 1000) / 1000));   // the crawl must fit the time budget
  let fin = buildFinal(rng, style, ap, crawlRate);
  let used = style;
  if (catchMs(fin.pts) < MIN_CATCH_MS) { fin = buildFinal(rng, 'linear', ap, crawlRate); used = 'crawl'; }
  const finT100 = firstCross(fin.pts, 100);
  const afterT = fin.end().t - finT100;   // stutters / stalls that still run past the first 100 %
  const tTarget = Math.max(Math.min(T, 9800 - afterT), finT100 + 1000);
  const pre = buildPre(rng, ap, rng.int(1, 2) + (tTarget > 5500 ? 1 : 0), ap <= 98 && rng.next() < 0.5);
  const scale = (tTarget - finT100) / pre.end().t;
  const preEnd = tTarget - finT100;
  const pts = pre.pts.map((p) => ({ ...p, t: p.t * scale }));
  for (const p of fin.pts.slice(1)) pts.push({ ...p, t: preEnd + p.t });
  const kinds = pts.map((p) => p.kind).filter((x, i, a) => x !== 'start' && x !== a[i - 1]);

  const seg = (t) => {
    for (let i = 1; i < pts.length; i++) if (t <= pts[i].t) return i;
    return pts.length - 1;
  };
  const tCap = pts[pts.length - 1].t;
  return {
    t100: firstCross(pts, 100), tCap, style: used, kinds, catchMs: catchMs(fin.pts),
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
