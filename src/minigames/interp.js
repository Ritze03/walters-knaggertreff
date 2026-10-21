// Snapshot interpolation for REMOTE players in owner-authoritative minigames. PURE (the caller passes the clock).
// Host snapshots of another player arrive at ~20 Hz with network jitter; drawing them `delayMs` in the past and lerping between the two that straddle
// the render time gives smooth motion regardless of host lag spikes. When the buffer runs dry the last state is extrapolated with its velocity
// (vx/vy/vz in units per SECOND, applied to x/y/z) for at most `maxExtrapMs`, then held. A jump bigger than `snapDist` (respawn, teleport, round restart)
// empties the buffer so the avatar snaps instead of sliding across the arena.
//
//   const tr = createTrack({ delayMs: 100, snapDist: 160, maxExtrapMs: 120 });
//   on snapshot:  tr.push(performance.now(), { x, y, vx, vy, ... })     // numeric fields are lerped, everything else comes from the later snapshot
//   per frame:    const s = tr.sample(performance.now())                // null until the first push

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const KEEP_MS = 1000;   // history older than this (before the render time) is dropped

/** @param {{ delayMs?:number, snapDist?:number, maxExtrapMs?:number, keys?:string[] }} [o]  keys = lerp only these fields (default: every numeric one; the rest is taken from the later snapshot) */
export function createTrack({ delayMs = 100, snapDist = Infinity, maxExtrapMs = 120, keys = null } = {}) {
  /** @type {{ t:number, s:object }[]} */
  let buf = [];
  const dist = (a, b) => Math.hypot((b.x ?? 0) - (a.x ?? 0), (b.y ?? 0) - (a.y ?? 0), (b.z ?? 0) - (a.z ?? 0));

  function lerp(a, b, f) {
    const out = { ...b };
    for (const k of keys ?? Object.keys(b)) if (isNum(a[k]) && isNum(b[k])) out[k] = a[k] + (b[k] - a[k]) * f;
    return out;
  }
  function extrap(s, ms) {
    const out = { ...s }, sec = ms / 1000;
    if (isNum(s.vx) && isNum(s.x)) out.x = s.x + s.vx * sec;
    if (isNum(s.vy) && isNum(s.y)) out.y = s.y + s.vy * sec;
    if (isNum(s.vz) && isNum(s.z)) out.z = s.z + s.vz * sec;
    return out;
  }

  return {
    /** add the state received at wall time `nowMs`. Out-of-order (not newer) pushes are ignored. */
    push(nowMs, state) {
      if (!state || typeof state !== 'object') return;
      const last = buf[buf.length - 1];
      if (last && nowMs <= last.t) return;
      if (last && dist(last.s, state) > snapDist) buf = [];   // snap: nothing to interpolate from
      buf.push({ t: nowMs, s: { ...state } });
      const cut = nowMs - delayMs - KEEP_MS;
      while (buf.length > 2 && buf[1].t < cut) buf.shift();
    },
    /** the state to draw at wall time `nowMs` (renders delayMs in the past); null while empty. Always a fresh object. */
    sample(nowMs) {
      if (!buf.length) return null;
      const rt = nowMs - delayMs;
      if (rt <= buf[0].t) return { ...buf[0].s };
      const last = buf[buf.length - 1];
      if (rt >= last.t) return extrap(last.s, Math.min(rt - last.t, maxExtrapMs));
      let i = 1;
      while (buf[i].t < rt) i++;
      const a = buf[i - 1], b = buf[i];
      return lerp(a.s, b.s, (rt - a.t) / (b.t - a.t));
    },
    reset() { buf = []; },
    get length() { return buf.length; },
  };
}
