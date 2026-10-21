// Bot for "U-Bahn-Surfers": reads the run state (the same data a player sees on screen; oncoming trains are judged by time-to-collision, egap), thinks every 0.12-0.3 s, and sometimes errs.
// Pure (no Kaplay / three): the node test drives it through sim.js. `act()` returns { dx, jump, slide } and pulses: after an action the next
// call returns nothing, so the edge detection of the input layer sees a fresh press every time.
import { lookahead } from './sim.js';

export function createBot(rng) {
  let thinkIn = 0.3, cool = 0, jumpIn = -1, slideIn = -1;
  const plan = [];   // queued lane changes (+1 / -1), at most one per pulse
  let pulsed = false;
  const skill = 0.62 + rng.next() * 0.3;   // this bot's personal reaction time (smaller = better); fixed per run

  function laneScore(la, from, target) {
    // path blocked? every lane between `from` and `target` must have no body-high obstacle right beside us
    let s = 0;
    const l = la[target];
    s += Math.min(l.egap, 60);   // egap = time-to-collision in metres at our own speed: an oncoming train counts as nearer than a parked one
    if (l.type && !l.jump && !l.slide) s -= l.egap < 9 ? 80 : 0;
    s += l.bottles * 2.5;
    s -= Math.abs(target - from) * 4;
    return s + (rng.next() - 0.5) * 10;
  }

  return {
    /** @param st sim run state, @param dt frame time, @param lag seconds between this call and the input reaching the sim */
    act(st, dt, lag = 0.05) {
      if (pulsed) { pulsed = false; return null; }
      cool -= dt; thinkIn -= dt;
      const out = {};
      if (jumpIn >= 0) { jumpIn -= dt; if (jumpIn < 0) out.jump = true; }
      if (slideIn >= 0) { slideIn -= dt; if (slideIn < 0) out.slide = true; }
      if (!out.jump && !out.slide && plan.length && cool <= 0) { out.dx = plan.shift(); cool = 0.07; }
      if (thinkIn <= 0) {
        thinkIn = 0.12 + rng.next() * 0.18;
        const la = lookahead(st, 70);
        const react = (skill + (rng.next() - 0.5) * 0.35) * 0.55 + lag;   // seconds of warning the bot wants
        const horizon = st.speed * react + 3;
        // the lane we will be in after the queued moves
        let target = st.lane;
        for (const m of plan) target += m;
        const t = la[target];
        if (!plan.length && !t.clear && t.egap < horizon && rng.next() > 0.07) {
          if (t.jump && st.y < 0.01 && rng.next() < 0.62) jumpIn = Math.max(0, (t.gap - st.speed * 0.27) / st.speed - lag);
          else if (t.slide && rng.next() < 0.85) slideIn = Math.max(0, (t.gap - st.speed * 0.2) / st.speed - lag);
          else if (!t.jump && !t.slide || rng.next() < 0.5) {
            // dodge: pick the best lane within reach (a mistake now and then)
            let best = target, bs = -Infinity;
            for (const c of [0, 1, 2]) {
              if (c === target) continue;
              const sc = laneScore(la, target, c);
              if (sc > bs) { bs = sc; best = c; }
            }
            if (rng.next() < 0.1) best = Math.max(0, Math.min(2, target + (rng.next() < 0.5 ? -1 : 1)));
            const d = best - target > 0 ? 1 : -1;
            for (let i = 0; i < Math.abs(best - target); i++) plan.push(d);
          }
        } else if (!plan.length && t.clear || (t.egap > horizon && !plan.length)) {
          // nothing urgent: drift towards a lane with more bottles if it is free
          let best = target, bs = t.bottles + (t.clear ? 1 : 0);
          for (const c of [target - 1, target + 1]) {
            if (c < 0 || c > 2) continue;
            const l = la[c];
            const free = l.clear || l.egap > st.speed * 1.6;
            if (free && l.bottles > bs + 1 && rng.next() < 0.7) { best = c; bs = l.bottles; }
          }
          if (best !== target) plan.push(best > target ? 1 : -1);
        }
      }
      if (out.dx || out.jump || out.slide) { pulsed = true; return out; }
      return null;
    },
  };
}
