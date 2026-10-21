// Pfand-Tauziehen: the host-side simulation. PURE: no Kaplay, no DOM, no Date/Math.random. Same seed + same inputs => same game.
// Two teams pull a rope with a Pfand crate on it. The crate sits at `pos` (-100 .. 100): -100 = team 0's line, +100 = team 1's line.
//  - A press is the `jump` edge (Leertaste / A) or the `action` edge (E, Shift / X). Clients only send "pressed" flags, the host counts them.
//  - Alternating the two buttons is worth ALT_W (1.0), hitting the same one again only SAME_W (0.5): button-spam on one key is half as good.
//  - Every press adds that much pull to the player's `pw`, which decays (half life PW_HALF_MS). A team pulls with the sum of its members' pw.
//  - Stamina (`st` 0..1): every press costs STAM_COST, it regenerates; tired (st < TIRED) pulls weaker. Sustained 8 Hz mashing gets tired after ~8 s.
//  - Presses closer than MIN_GAP_MS to the player's previous one are ignored (a macro / autoclicker cannot out-pull a human by much).
//  - Crate over a line = that team wins at once. Otherwise at the timer end the team whose side the crate is on wins; a dead heat is decided by
//    total pull; still equal = draw (everybody shares the rank).

export const DURATION_MS = 20000;
export const LINE = 100;
export const TEAM_NAMES = ['Team Leergut', 'Team Mehrweg'];
export const TEAM_COLORS = ['#e63946', '#3a86ff'];
export const C = {
  ALT_W: 1, SAME_W: 0.5, PW_HALF_MS: 260, GAIN: 3.4, V_EASE: 9,
  STAM_COST: 0.05, STAM_REGEN: 0.3, TIRED: 0.25, TIRED_MIN: 0.55, MIN_GAP_MS: 55,
};

const r2 = (n) => Math.round(n * 100) / 100;
const r4 = (n) => Math.round(n * 10000) / 10000;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** @returns the state. `teams` = [[seats],[seats]] (falls back to an even split of `seats` when missing) */
export function hostInit({ seats, teams }) {
  let tm = teams && teams.length === 2 ? teams : null;
  if (!tm) { const h = Math.ceil(seats.length / 2); tm = [seats.slice(0, h), seats.slice(h)]; }
  const ps = [];
  tm.forEach((members, t) => members.forEach((s) => ps.push({ s, tm: t, pw: 0, st: 1, last: 0, gap: 1000, n: 0 })));
  ps.sort((a, b) => a.s - b.s);
  return { t: 0, done: false, dur: DURATION_MS, pos: 0, v: 0, win: -1, tp: [0, 0], c: [0, 0], ps };
}

/** Advances by dtMs. `inputs`: seat -> InputFrame (missing seat = no input). Mutates and returns mg. */
export function hostStep(mg, inputs, dtMs) {
  if (mg.done) return mg;
  const sec = dtMs / 1000;
  mg.t += dtMs;
  const decay = Math.pow(0.5, dtMs / C.PW_HALF_MS);
  const tp = [0, 0];
  for (const p of mg.ps) {
    p.gap = Math.min(p.gap + dtMs, 5000);
    p.pw *= decay;
    p.st = Math.min(1, p.st + C.STAM_REGEN * sec);
    const f = inputs?.[p.s];
    for (const [b, id] of [['jump', 1], ['action', 2]]) {
      if (!f?.pressed?.[b] || p.gap < C.MIN_GAP_MS) continue;
      const w = p.last === 0 || p.last !== id ? C.ALT_W : C.SAME_W;
      const tired = p.st >= C.TIRED ? 1 : C.TIRED_MIN + (1 - C.TIRED_MIN) * (p.st / C.TIRED);
      p.pw += w * tired;
      p.st = Math.max(0, p.st - C.STAM_COST);
      p.last = id; p.gap = 0; p.n++;
    }
    tp[p.tm] += p.pw;
  }
  // the rope: team 1 pulls toward +, team 0 toward -
  const target = (tp[1] - tp[0]) * C.GAIN;
  mg.v += (target - mg.v) * Math.min(1, sec * C.V_EASE);
  mg.pos = clamp(mg.pos + mg.v * sec, -LINE, LINE);
  mg.c[0] += tp[0] * sec; mg.c[1] += tp[1] * sec;
  mg.tp = [r2(tp[0]), r2(tp[1])];
  for (const p of mg.ps) { p.pw = r4(p.pw); p.st = r4(p.st); }
  mg.v = r4(mg.v); mg.pos = r4(mg.pos); mg.c = [r4(mg.c[0]), r4(mg.c[1])];
  if (mg.pos <= -LINE) { mg.win = 0; mg.done = true; }
  else if (mg.pos >= LINE) { mg.win = 1; mg.done = true; }
  else if (mg.t >= mg.dur) { mg.win = winnerAtTimer(mg); mg.done = true; }
  return mg;
}

/** team that is ahead right now: crate side, then total pull; -1 = dead heat */
function winnerAtTimer(mg) {
  if (Math.abs(mg.pos) >= 0.5) return mg.pos < 0 ? 0 : 1;
  if (Math.abs(mg.c[0] - mg.c[1]) >= 0.5) return mg.c[0] > mg.c[1] ? 0 : 1;
  return -1;
}

/** Ranking, best first: [[winning team's seats],[losing team's seats]] or one group on a draw. Works on a not-yet-done state too. */
export function hostResult(mg) {
  const win = mg.done ? mg.win : winnerAtTimer(mg);
  const seatsOf = (t) => mg.ps.filter((p) => p.tm === t).map((p) => p.s).sort((a, b) => a - b);
  const labels = {};
  for (const p of mg.ps) {
    const z = `${p.n} Züge`;
    labels[p.s] = win < 0 ? `Unentschieden · ${z}` : p.tm === win ? `Gewonnen · ${z}` : `Verloren · ${z}`;
  }
  if (win < 0) return { placements: [mg.ps.map((p) => p.s).sort((a, b) => a - b)], labels };
  return { placements: [seatsOf(win), seatsOf(1 - win)], labels };
}

/**
 * A human-ish masher: 6-10 Hz with noise, the pace drifts every second or so, mostly alternates the two buttons, takes the odd breather.
 * Pure given `rng` (createRng-like, .next()). `tick(dtMs)` returns 'jump' | 'action' | null: press that button for ONE frame (pulse).
 */
export function makeBot(rng) {
  let rate = 6 + rng.next() * 4, drift = 0, wait = 150 + rng.next() * 200, last = rng.next() < 0.5 ? 'jump' : 'action', rest = 0;
  return {
    tick(dtMs) {
      drift -= dtMs;
      if (drift <= 0) {
        drift = 700 + rng.next() * 1200;
        rate = clamp(rate + (rng.next() - 0.5) * 3, 5.5, 10.5);
        if (rng.next() < 0.1) rest = 300 + rng.next() * 500;   // blows its nose
      }
      if (rest > 0) { rest -= dtMs; return null; }
      wait -= dtMs;
      if (wait > 0) return null;
      wait += (1000 / rate) * (0.7 + rng.next() * 0.6);
      if (rng.next() < 0.8) last = last === 'jump' ? 'action' : 'jump';
      return last;
    },
  };
}
