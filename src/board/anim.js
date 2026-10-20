// Tiny promise-based tween/timer engine driven by ONE root.onUpdate, so destroying `root` stops everything.
// `speed` > 1 fast-forwards, `instant` makes every wait/tween finish immediately (used when playback lags behind the state stream).

export function createAnim(k, root) {
  const tasks = new Set();
  const anim = { speed: 1, instant: false, dead: false };

  root.onUpdate(() => {
    if (anim.dead) return;
    const dt = Math.min(k.dt(), 0.25) * anim.speed;
    for (const t of [...tasks]) {
      t.t += dt;
      const p = Math.min(1, t.t / t.dur);
      t.fn?.(t.ease(p), p);
      if (p >= 1) { tasks.delete(t); t.done(); }
    }
  });

  /** runs fn(easedProgress, rawProgress) for `dur` seconds; always ends with fn(ease(1)) */
  anim.tween = (dur, fn, ease = (x) => x) => new Promise((resolve) => {
    if (anim.dead) return;
    if (anim.instant || dur <= 0) { fn?.(ease(1), 1); resolve(); return; }
    tasks.add({ t: 0, dur, fn, ease, done: resolve });
  });
  anim.wait = (sec) => anim.tween(sec, null);
  /** finishes everything that is running right now */
  anim.flush = () => { for (const t of [...tasks]) { t.fn?.(t.ease(1), 1); tasks.delete(t); t.done(); } };
  anim.kill = () => { anim.dead = true; tasks.clear(); };
  anim.ease = k.easings;
  return anim;
}
