// Test helpers + a small fixture board for src/core/*.test.js (core never imports real boards). Not shipped logic.
import assert from 'node:assert/strict';
import { createRng, HOST_SEAT, PLAYER_COLORS } from '../contracts.js';
import { createGame, applyIntent, registerBoard } from './index.js';

/**
 * 20 spaces: s0 start, loop s0..s19, fork at s6 -> [s7 (branch A), s12 (branch B)] merging in s16.
 * stars at s2 / s18, shops s4 / s17, events s8 (bonus: coins) and s13 (warp: moveTo s1).
 *
 *  s0 start  s1 blue  s2 blue  s3 red  s4 shop  s5 blue  s6 blue(fork)
 *  A: s7 blue  s8 event  s9 red  s10 blue  s11 blue          B: s12 blue  s13 event  s14 red  s15 blue
 *  s16 blue  s17 shop  s18 blue  s19 red  -> s0
 */
const T = { s0: 'start', s1: 'blue', s2: 'blue', s3: 'red', s4: 'shop', s5: 'blue', s6: 'blue', s7: 'blue', s8: 'event', s9: 'red',
  s10: 'blue', s11: 'blue', s12: 'blue', s13: 'event', s14: 'red', s15: 'blue', s16: 'blue', s17: 'shop', s18: 'blue', s19: 'red' };
const NEXT = { s0: ['s1'], s1: ['s2'], s2: ['s3'], s3: ['s4'], s4: ['s5'], s5: ['s6'], s6: ['s7', 's12'], s7: ['s8'], s8: ['s9'], s9: ['s10'],
  s10: ['s11'], s11: ['s16'], s12: ['s13'], s13: ['s14'], s14: ['s15'], s15: ['s16'], s16: ['s17'], s17: ['s18'], s18: ['s19'], s19: ['s0'] };

export function makeBoard(over = {}) {
  const spaces = Object.keys(T).map((id, i) => ({
    id, type: T[id], x: 100 + (i % 10) * 80, y: 100 + Math.floor(i / 10) * 120, next: NEXT[id],
    ...(T[id] === 'event' ? { eventId: id === 's8' ? 'bonus' : 'warp' } : {}),
  }));
  return {
    id: 'spaeti', name: 'Testboard', blurb: 'fixture', world: { w: 1000, h: 400 }, theme: { bg: '#000', accent: '#fff' },
    startSpaceId: 's0', spaces, starSpaceIds: ['s2', 's18'],
    events: {
      bonus: ({ seat, rng }) => ({ banner: 'Bonus!', effects: [{ type: 'coins', seat, delta: rng.int(3, 5) }] }),
      warp: ({ seat }) => ({ banner: 'Warp!', lineId: 'schienenersatz', sfx: 'whoosh', effects: [{ type: 'moveTo', seat, spaceId: 's1' }] }),
    },
    ...over,
  };
}

export const registerFixture = (over) => registerBoard(makeBoard(over));

export const profile = (i) => ({ playerId: `p${i}`, name: `Spieler${i}`, color: PLAYER_COLORS[i], hat: 'none' });

/** applies and asserts success */
export function run(state, actor, intent) {
  const r = applyIntent(state, actor, intent);
  assert.equal(r.error, null, `${JSON.stringify(intent)} -> ${r.error}`);
  return r;
}
export const runAll = (state, steps) => steps.reduce((s, [actor, intent]) => run(s, actor, intent).state, state);

export function lobby(n = 3, o = {}) {
  registerFixture();
  let s = createGame({ gameId: 'testgame', hostPlayerId: 'p0', hostProfile: profile(0), seed: 1234, ...o });
  for (let i = 1; i < n; i++) s = run(s, HOST_SEAT, { type: 'seatJoin', playerId: `p${i}`, profile: profile(i), isBot: false }).state;
  return s;
}

/** started game; turn order normalised to seat order (0,1,2..) with seat 0 to roll, star far away at s18, so tests are predictable */
export function started(n = 3, o = {}) {
  let s = run(lobby(n, o), 0, { type: 'startGame' }).state;
  return edit(s, (d) => { d.turnOrder = d.seats.map((x) => x.index); d.turnIndex = 0; d.turn.seat = 0; d.starSpaceId = 's18'; });
}

/** deep copy + mutate, for arranging test situations */
export function edit(state, fn) { const d = structuredClone(state); fn(d); return d; }

export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
}

/** state whose NEXT rng draws are int(1,10) === values[0], values[1], ... (only the first draws are controlled) */
export function forceDice(state, values, from = 1) {
  for (let u = from; u < from + 1e6; u++) {
    const r = createRng(u);
    if (values.every((v) => r.int(1, 10) === v)) return edit(state, (d) => { d.rng = u; });
  }
  throw new Error('no rng state found');
}

/** roll `value` as the current turn seat */
export const rollAs = (state, value) => run(forceDice(state, [value]), state.turn.seat, { type: 'roll' });

export const types = (events) => events.map((e) => e.type);
