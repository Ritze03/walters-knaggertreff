// Flappy Taube bot: aims at the centre of the next gap with a per-gap aiming error that grows with the gap number, so it crashes at varying points.
import { PX, GROUND, halfWidth } from './sim.js';

export function createBot(rng) {
  const errs = new Map();
  const err = (o) => { if (!errs.has(o.i)) errs.set(o.i, (rng.next() * 2 - 1) * (14 + o.i * 4.2)); return errs.get(o.i); };
  let cool = 0, thr = 24;
  /** returns true to flap now. st = run state, dt in seconds */
  return function decide(st, dt) {
    cool -= dt;
    const px = st.dist + PX, obs = st.course.obs;
    let j = st.nextObs;
    // switch to the next gap shortly before this one is fully passed
    if (j < obs.length && px > obs[j].x + halfWidth(obs[j]) - 30 && j + 1 < obs.length) j++;
    const o = obs[j];
    const target = o ? Math.min(GROUND - 60, o.c + err(o) + 12) : GROUND / 2;
    if (cool > 0) return false;
    if (st.y + st.vy * 0.09 > target + thr) {
      cool = 0.12;
      thr = 14 + rng.next() * 26;
      return true;
    }
    return false;
  };
}
