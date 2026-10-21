// Döner mit alles: the pure part. Ingredients, deterministic order generation from the shared rng, serving check and scoring. No Kaplay, no DOM.

/** the six ingredients, in display order. `max` = how many of it a wrap can hold (Fleisch can be doubled, the rest is on/off). */
export const ING = [
  { key: 'fleisch', name: 'Fleisch', emoji: '🥩', max: 2 },
  { key: 'salat', name: 'Salat', emoji: '🥬', max: 1 },
  { key: 'tomate', name: 'Tomate', emoji: '🍅', max: 1 },
  { key: 'zwiebel', name: 'Zwiebel', emoji: '🧅', max: 1 },
  { key: 'sosse', name: 'Soße', emoji: '🥣', max: 1 },
  { key: 'scharf', name: 'Scharf', emoji: '🌶️', max: 1 },
];
export const KEYS = ING.map((i) => i.key);
export const DURATION_MS = 35000;
export const ORDER_COUNT = 40;
export const WRONG_LOCK_MS = 1500;   // a wrong serve costs this much (the wrap is thrown away)
export const OK_LOCK_MS = 380;       // the next customer walks up

const FILLINGS = ['salat', 'tomate', 'zwiebel', 'sosse'];   // what "alles" means (plus Fleisch); Scharf is always extra
const NAME = { salat: 'Salat', tomate: 'Tomate', zwiebel: 'Zwiebel', sosse: 'Soße' };

export const emptyWrap = () => Object.fromEntries(KEYS.map((k) => [k, 0]));

/** toggles an ingredient on a wrap (mutates). Fleisch cycles 0 -> 1 -> 2 -> 0, the rest is on/off. */
export function addIngredient(wrap, key) {
  const max = ING.find((i) => i.key === key).max;
  wrap[key] = (wrap[key] + 1) % (max + 1);
  return wrap;
}

/** true when the wrap is exactly what was ordered */
export const matches = (wrap, order) => KEYS.every((k) => wrap[k] === order.items[k]);

/** the most annoying difference: {key, over:true} (something that should not be there / too much) or {key, over:false} (missing), null if equal */
export function firstMistake(wrap, order) {
  for (const k of KEYS) if (wrap[k] > order.items[k]) return { key: k, over: true };
  for (const k of KEYS) if (wrap[k] < order.items[k]) return { key: k, over: false };
  return null;
}

/** speed bonus for one served order (0..40), always an integer so equal runs tie for real */
export const speedBonus = (orderMs) => Math.max(0, Math.round(40 - (orderMs / 1000) * 5));
/** served count dominates (bonus of all orders stays < 1000) */
export const scoreOf = (served, bonus) => served * 1000 + Math.min(999, bonus);

function hslHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const list = (arr) => (arr.length === 1 ? arr[0] : `${arr.slice(0, -1).join(', ')} und ${arr[arr.length - 1]}`);

/**
 * One order: {color, kind, text, items}. Every client builds the same ones from the same rng.
 * Early orders are short ("nur Soße"), later ones add "ohne ...", scharf and extra Fleisch.
 */
export function makeOrder(rng, i) {
  const diff = Math.min(1, i / 10);
  const kind = rng.next() < 0.5 ? 'Döner' : 'Dürüm';
  const color = hslHex(rng.int(0, 359), 0.62, 0.64);
  const items = emptyWrap();
  items.fleisch = 1;
  const pAlles = 0.34 * (0.5 + diff * 0.5), pOhne = pAlles + 0.3 + diff * 0.1;
  const r = i < 2 ? 0.99 : rng.next();   // the first two orders are always the short "nur ..." kind
  let text;
  if (r < pAlles) {                       // mit alles
    FILLINGS.forEach((f) => { items[f] = 1; });
    text = `${kind} mit alles`;
  } else if (r < pOhne) {                 // mit alles, ohne ...
    FILLINGS.forEach((f) => { items[f] = 1; });
    const without = rng.shuffle(FILLINGS).slice(0, rng.next() < 0.6 ? 1 : 2);
    without.forEach((f) => { items[f] = 0; });
    text = `${kind} mit alles, ohne ${list(without.map((f) => NAME[f]))}`;
  } else {                                // nur ...
    const only = rng.shuffle(FILLINGS).slice(0, i < 2 ? rng.int(1, 2) : rng.int(1, 3));
    only.forEach((f) => { items[f] = 1; });
    text = `${kind}, nur ${list(only.map((f) => NAME[f]))}`;
  }
  const mods = [];
  if (i >= 1 && rng.next() < 0.22 + 0.25 * diff) { items.scharf = 1; mods.push('scharf'); }
  if (i >= 2 && rng.next() < 0.14 + 0.16 * diff) { items.fleisch = 2; mods.push('extra Fleisch'); }
  else if (i >= 5 && rng.next() < 0.07) { items.fleisch = 0; mods.push('ohne Fleisch'); }
  if (mods.length) text += `, ${mods.join(', ')}`;
  return { color, kind, text, items };
}

export const makeOrders = (rng, n = ORDER_COUNT) => Array.from({ length: n }, (_, i) => makeOrder(rng, i));
