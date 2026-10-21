// "Pfandautomat": the pure rules. The item schedule comes from the shared seed (every client sees the same belt), positions are a
// closed-form function of the clock, so the client, the bot and the node tests all judge a press the same way.
export const DURATION_MS = 32000;
export const RAMP_MS = 30000;     // belt and rhythm reach full speed after this
export const FIRST_T = 2000;      // first item reaches the slot window this long after go()
export const SLOT_X = 480;        // centre of the window (logical px)
export const HALF = { normal: 100, crate: 52 };   // half window width in px (was 50/26); a crate is huge but has to sit dead centre ("ganz rein")
export const PERFECT_PX = 28;
export const GOOD_CENTS = 25;
export const CRATE_CENTS = 100;
export const GOOD = ['glass', 'pet', 'can'];
export const JUNK = ['canNo', 'jar', 'doener', 'sock'];
export const speedAt = (T) => 240 + 210 * Math.min(1, T / RAMP_MS);   // px/s of the belt for an item that reaches the slot at T (was 300..600)
export const isGood = (it) => GOOD.includes(it.kind);
export const halfOf = (it) => (it.kind === 'crate' ? HALF.crate : HALF.normal);
export const centsOf = (it) => (it.kind === 'crate' ? CRATE_CENTS : isGood(it) ? GOOD_CENTS : 0);
/** x of an item's centre at clock t (ms). */
export const posAt = (it, t) => SLOT_X + ((t - it.T) / 1000) * it.v;
/** '3,75 €' */
export const euro = (cents) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

/** Items [{id, kind, T, v}] in arrival order. Rhythm: the gap shrinks from ~1.15 s to ~0.75 s (was 0.9 to 0.5), with the odd syncopated pair. */
export function makeSchedule(rng) {
  const items = [];
  let T = FIRST_T, prev = null;
  const limit = DURATION_MS - 1600;
  while (T <= limit) {
    const i = items.length;
    let kind;
    const r = rng.next();
    if (i === 0) kind = rng.pick(GOOD);
    else if (r < 0.09 && i >= 3 && prev !== 'crate') kind = 'crate';
    else if (r < 0.31) kind = rng.pick(JUNK);   // ~22% junk (was ~31%)
    else kind = rng.pick(GOOD);
    items.push({ id: i, kind, T: Math.round(T), v: Math.round(speedAt(T)) });
    const base = 1150 - 400 * Math.min(1, T / RAMP_MS);
    let gap = base * (0.85 + 0.3 * rng.next());
    const pair = rng.next() < 0.18;
    if (kind === 'crate' || prev === 'crate') gap *= 1.25;
    else if (pair) gap *= 0.78;
    prev = kind;
    T += gap;
  }
  return items;
}

/**
 * What does a press at clock t do? `open` = the still unresolved items.
 * -> {kind:'feed', item} (good item in the window) | {kind:'wrong', item} (junk in the window) |
 *    {kind:'jam', reason:'early'|'late'|'crate'|'empty', item?} (nothing in the window: too early / too late / crate not centred / nothing there)
 */
export function judgePress(open, t) {
  let best = null, bd = Infinity;
  for (const it of open) {
    const d = Math.abs(posAt(it, t) - SLOT_X);
    if (d <= halfOf(it) && d < bd) { best = it; bd = d; }
  }
  if (best) return { kind: isGood(best) || best.kind === 'crate' ? 'feed' : 'wrong', item: best, perfect: bd <= PERFECT_PX };
  let near = null, nd = Infinity;
  for (const it of open) {
    const dx = posAt(it, t) - SLOT_X, d = Math.abs(dx);
    if (d < (it.kind === 'crate' ? 170 : 260) && d < nd) { near = it; nd = d; }
  }
  if (!near) return { kind: 'jam', reason: 'empty' };
  if (near.kind === 'crate') return { kind: 'jam', reason: 'crate', item: near };
  return { kind: 'jam', reason: posAt(near, t) < SLOT_X ? 'early' : 'late', item: near };
}
