// Owner-authoritative movement, shared helpers (contracts section 10). PURE: no Kaplay, no DOM, no clocks.
// The owner client simulates its own body and reports it (`mgOwn`); the host adopts the report (`adoptFields`) and keeps resolving every interaction,
// delivering hits to the victim as impulses (`pushImp` on the host, `takeImps` on the victim). Friends' game: the host trusts the report, it only
// whitelists, clamps and rejects garbage so a bad packet cannot corrupt the sim.
import { TIMING } from '../contracts.js';

const IMP_KEEP_MS = 2000;   // impulses stay in mg.imp this long (sim ms), enough for several lost snapshots

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const roundTo = (v, dp) => { const m = 10 ** dp; return Math.round(v * m) / m; };

/**
 * Apply an owner's report to the host copy `p` of that player.
 * spec: { field: { lo, hi, dp?, kin?, serial? } }. Only fields named in spec are ever read from `rep`; each must be a finite number (NaN/Infinity/strings are skipped),
 *   is clamped to lo..hi and rounded to `dp` decimals (default 1; serial counters are integers).
 *   kin:true    = kinematic (x, y, vx, vy, kx, ky, ...): ignored while the owner has not yet acknowledged the latest impulse (rep.ack < p.ia), because such a report predates the hit.
 *   serial:true = a discrete-action counter (dash count `dn`, jacket count `jn`): adopted as an integer; reported in `changed` when it differs from what p holds (missing = 0).
 * Always sets p.ot = mgT (the seat is "owned" from now on, see isOwned) as long as `rep` is an object.
 * @returns {{ changed:string[], gated:boolean }|null} changed = serial fields whose value changed (a game resets e.g. `p.dh` when `dn` is in it); gated = kinematics were ignored; null = no report.
 */
export function adoptFields(p, rep, spec, mgT) {
  if (!p || !rep || typeof rep !== 'object') return null;
  const ack = fin(rep.ack) ? rep.ack : 0;
  const gated = ack < (p.ia ?? 0);
  const changed = [];
  for (const [key, f] of Object.entries(spec)) {
    if (f.kin && gated) continue;
    const v = rep[key];
    if (!fin(v)) continue;
    const c = Math.max(f.lo, Math.min(f.hi, v));
    const out = f.serial ? Math.round(c) : roundTo(c, f.dp ?? 1);
    if (f.serial && out !== (p[key] ?? 0)) changed.push(key);
    p[key] = out;
  }
  p.ot = mgT;
  return { changed, gated };
}

/** is this player currently driven by its owner's reports? (host sim time `mgT`, the same clock as p.ot) */
export const isOwned = (p, mgT) => p.ot !== undefined && mgT - p.ot <= TIMING.OWN_STALE_MS;

/**
 * Host: deliver a hit to the owner of `q` (seat `seat`). Appends `{i, s, kx, ky, st, dc, t}` to mg.imp (i = ++mg.iid, t = mg.t for pruning), drops entries older than ~2 s,
 * sets q.ia = i (the owner's kinematics are ignored until it acks i) and applies the very same hit to the host copy.
 *   kx, ky = knockback velocity ADDED to the victim's kx/ky; st = stun ms (victim stun = max); dc = truthy: cancel the victim's dash.
 * @returns the appended entry
 */
export function pushImp(mg, q, seat, { kx = 0, ky = 0, st = 0, dc = false } = {}) {
  mg.imp ??= [];
  mg.iid ??= 0;
  const e = { i: ++mg.iid, s: seat, kx: roundTo(kx, 1), ky: roundTo(ky, 1), st: Math.round(st), dc: dc ? 1 : 0, t: Math.round(mg.t ?? 0) };
  mg.imp.push(e);
  while (mg.imp.length && (mg.t ?? 0) - mg.imp[0].t > IMP_KEEP_MS) mg.imp.shift();
  q.ia = e.i;
  q.kx = (q.kx ?? 0) + e.kx; q.ky = (q.ky ?? 0) + e.ky;
  q.stun = Math.max(q.stun ?? 0, e.st);
  if (e.dc) q.dash = 0;
  return e;
}

/**
 * Victim side: the impulses in snapshot `snap` addressed to `seat` that were not applied yet. Apply each as kx/ky += , stun = max, dash = 0 if dc, then report ack = last.
 * lastImp null/undefined = first snapshot after (re)mount: nothing is replayed, `last` becomes the highest id in the snapshot (snap.iid).
 * @returns {{ list:object[], last:number }} list sorted by id
 */
export function takeImps(snap, seat, lastImp) {
  const all = Array.isArray(snap?.imp) ? snap.imp : [];
  if (lastImp === null || lastImp === undefined) {
    let m = fin(snap?.iid) ? snap.iid : 0;
    for (const e of all) if (fin(e?.i) && e.i > m) m = e.i;
    return { list: [], last: m };
  }
  const list = all.filter((e) => e && e.s === seat && fin(e.i) && e.i > lastImp).sort((a, b) => a.i - b.i);
  return { list, last: list.length ? list[list.length - 1].i : lastImp };
}

/**
 * Fixed-step accumulator for a client-side local sim. `step(dtMs, fn)` runs fn(stepMs) for every full step in the elapsed time (frame time clamped to 250 ms),
 * at most `maxCatchup` times per call; if that cap is hit the remaining backlog is dropped (the sim slows down instead of spiralling). Returns the steps run.
 */
export function fixedStepper(hz, maxCatchup = 8) {
  const stepMs = 1000 / hz;
  let acc = 0;
  return {
    stepMs,
    step(dtMs, fn) {
      acc += Math.max(0, Math.min(dtMs, 250));
      let n = 0;
      while (acc >= stepMs - 1e-9 && n < maxCatchup) { fn(stepMs); acc -= stepMs; n++; }
      if (acc >= stepMs) acc = 0;
      return n;
    },
    reset() { acc = 0; },
  };
}
