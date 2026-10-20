import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyIntent } from './index.js';
import { started, run, edit, forceDice, rollAs, types } from './fixtures.js';

const give = (s, seat, items, extra = {}) => edit(s, (d) => { Object.assign(d.players[seat], { items }, extra); });
/** duels only happen from round 2 on. Seat 0 also gets 9 coins: with the 10-coin start purse it would be offered shop items (cheapest 10) when walking past s4 */
const round2 = (s) => edit(s, (d) => { d.round = 2; d.players[0].coins = 9; });
const poor0 = (s) => edit(s, (d) => { d.players[0].coins = 9; });
const at = (s, seat, spaceId, extra = {}) => edit(s, (d) => { Object.assign(d.players[seat], { spaceId }, extra); });

test('useItem: must own the item, only before rolling, only on your turn', () => {
  const s = started(3);
  assert.equal(applyIntent(s, 0, { type: 'useItem', item: 'doubleDice' }).error, 'invalid');
  const g = give(s, 1, ['doubleDice']);
  assert.equal(applyIntent(g, 1, { type: 'useItem', item: 'doubleDice' }).error, 'notYourTurn');
  const mid = edit(give(s, 0, ['doubleDice']), (d) => { d.turn.step = 'path'; });
  assert.equal(applyIntent(mid, 0, { type: 'useItem', item: 'doubleDice' }).error, 'wrongStep');
});

test('doubleDice: next roll is two dice, summed, consumed; cannot be armed twice', () => {
  let s = give(started(3), 0, ['doubleDice', 'doubleDice'], { coins: 9 });   // < shop price: no shop prompt at s4
  const u = run(s, 0, { type: 'useItem', item: 'doubleDice' });
  assert.deepEqual(u.events, [{ type: 'itemUsed', seat: 0, item: 'doubleDice' }]);
  assert.equal(u.state.turn.doubleDice, true);
  assert.deepEqual(u.state.players[0].items, ['doubleDice']);
  assert.equal(applyIntent(u.state, 0, { type: 'useItem', item: 'doubleDice' }).error, 'invalid');
  const r = run(forceDice(u.state, [2, 3]), 0, { type: 'roll' });
  assert.deepEqual(r.events[0], { type: 'diceRolled', seat: 0, value: 5, dice: [2, 3] });
  assert.equal(r.state.players[0].spaceId, 's5');
  // the next turn of the same player is a normal single die again
  const again = rollAs(edit(r.state, (d) => { d.turn.seat = 0; d.turnIndex = 0; }), 2);
  assert.equal(again.events[0].dice.length, 1);
});

test('goldenDoener: one extra roll in the same turn', () => {
  const s = give(started(3), 0, ['goldenDoener']);
  const u = run(s, 0, { type: 'useItem', item: 'goldenDoener' });
  assert.equal(u.state.turn.extraRolls, 1);
  const r1 = rollAs(u.state, 1);
  assert.equal(r1.state.turn.seat, 0);
  assert.equal(r1.state.turn.step, 'roll');
  assert.equal(r1.state.turn.extraRolls, 0);
  assert.ok(!types(r1.events).includes('turnStarted'));
  const r2 = rollAs(r1.state, 2);
  assert.equal(r2.state.players[0].spaceId, 's3');
  assert.equal(r2.state.turn.seat, 1);
});

test('steal: takes coins from the target, validates the target', () => {
  const s = give(started(3), 0, ['steal'], {});
  const t = edit(s, (d) => { d.players[1].coins = 15; d.players[2].coins = 0; });
  const r = run(t, 0, { type: 'useItem', item: 'steal', targetSeat: 1 });
  assert.deepEqual(r.events, [
    { type: 'itemUsed', seat: 0, item: 'steal', targetSeat: 1 },
    { type: 'coinsChanged', seat: 1, delta: -10, total: 5, reason: 'steal' },
    { type: 'coinsChanged', seat: 0, delta: 10, total: 20, reason: 'steal' },
  ]);
  assert.deepEqual(r.state.players[0].items, []);
  assert.equal(r.state.turn.step, 'roll');   // still to roll
  assert.equal(applyIntent(t, 0, { type: 'useItem', item: 'steal', targetSeat: 0 }).error, 'invalid');
  assert.equal(applyIntent(t, 0, { type: 'useItem', item: 'steal', targetSeat: 2 }).error, 'invalid');   // nothing to take
  assert.equal(applyIntent(t, 0, { type: 'useItem', item: 'steal', targetSeat: 9 }).error, 'invalid');
  assert.equal(applyIntent(t, 0, { type: 'useItem', item: 'steal' }).error, 'invalid');
  const poor = edit(t, (d) => { d.players[1].coins = 3; });
  const p = run(poor, 0, { type: 'useItem', item: 'steal', targetSeat: 1 });
  assert.equal(p.state.players[1].coins, 0);
  assert.equal(p.state.players[0].coins, 13);
});

test('trap: placed on a legal space; start, shop and already-trapped spaces are refused', () => {
  const s = give(started(3), 0, ['trap', 'trap']);
  const r = run(s, 0, { type: 'useItem', item: 'trap', spaceId: 's5' });
  assert.deepEqual(r.events, [{ type: 'itemUsed', seat: 0, item: 'trap', spaceId: 's5' }]);
  assert.deepEqual(r.state.traps, { s5: 0 });
  assert.deepEqual(r.state.players[0].items, ['trap']);
  assert.equal(applyIntent(r.state, 0, { type: 'useItem', item: 'trap', spaceId: 's5' }).error, 'invalid');
  assert.equal(applyIntent(s, 0, { type: 'useItem', item: 'trap', spaceId: 's0' }).error, 'invalid');
  assert.equal(applyIntent(s, 0, { type: 'useItem', item: 'trap', spaceId: 's4' }).error, 'invalid');
  assert.equal(applyIntent(s, 0, { type: 'useItem', item: 'trap', spaceId: 'zz' }).error, 'invalid');
  assert.equal(applyIntent(s, 0, { type: 'useItem', item: 'trap' }).error, 'invalid');
});

test('trap: victim loses coins to the owner, one-shot, owner is immune on own trap', () => {
  let s = give(started(3), 0, [], {});
  s = edit(s, (d) => { d.traps = { s1: 0 }; d.turn.seat = 1; d.turnIndex = 1; d.players[1].coins = 12; d.players[0].coins = 5; });
  const r = rollAs(s, 1);
  const ev = r.events.filter((e) => ['trapTriggered', 'coinsChanged'].includes(e.type));
  assert.deepEqual(ev, [
    { type: 'trapTriggered', spaceId: 's1', ownerSeat: 0, victimSeat: 1 },
    { type: 'coinsChanged', seat: 1, delta: -8, total: 4, reason: 'trap' },
    { type: 'coinsChanged', seat: 0, delta: 8, total: 13, reason: 'trap' },
    { type: 'coinsChanged', seat: 1, delta: 3, total: 7, reason: 'space' },
  ]);
  assert.deepEqual(r.state.traps, {});   // one-shot
  // the next victim is not charged
  const again = edit(r.state, (d) => { d.players[2].spaceId = 's0'; d.turn.seat = 2; d.turnIndex = 2; });
  const r2 = rollAs(again, 1);
  assert.ok(!types(r2.events).includes('trapTriggered'));

  // own trap: nothing happens, trap stays (seat 1 is on s1 with seat 0, so avoid a duel: seat 0 isn't there)
  const own = edit(s, (d) => { d.traps = { s1: 1 }; });
  const r3 = rollAs(own, 1);
  assert.ok(!types(r3.events).includes('trapTriggered'));
  assert.deepEqual(r3.state.traps, { s1: 1 });
});

test('trap: victim cannot lose more than they have', () => {
  let s = edit(started(3), (d) => { d.traps = { s1: 0 }; d.turn.seat = 1; d.turnIndex = 1; d.players[1].coins = 2; });
  const r = rollAs(s, 1);
  const t = r.events.filter((e) => e.reason === 'trap');
  assert.deepEqual(t.map((e) => e.delta), [-2, 2]);
  assert.equal(r.state.players[0].coins, 12);
});

test('trap triggers only on landing, not when passing', () => {
  const s = edit(started(3), (d) => { d.traps = { s3: 1 }; });
  const r = rollAs(s, 5);
  assert.ok(!types(r.events).includes('trapTriggered'));
  assert.deepEqual(r.state.traps, { s3: 1 });
});

test('duel: landing on an occupied space starts a solo 1v1 and the turn resumes afterwards', () => {
  let s = at(round2(started(3)), 1, 's5');
  const r = rollAs(s, 5);
  assert.deepEqual(types(r.events), ['diceRolled', 'moved', 'coinsChanged', 'duelStart', 'minigameStart']);
  assert.deepEqual(r.events[3], { type: 'duelStart', seats: [0, 1] });
  const mg = r.state.minigame;
  assert.equal(r.state.phase, 'minigameIntro');
  assert.deepEqual([mg.purpose, mg.mode, mg.kind, mg.seats, mg.teams], ['duel', 'duel', 'solo', [0, 1], null]);
  assert.deepEqual(r.events[4].minigame, mg);
  assert.equal(r.state.turn.seat, 0);   // preserved

  const ready = run(run(r.state, 0, { type: 'ready' }).state, 1, { type: 'ready' }).state;
  assert.equal(ready.phase, 'minigame');
  const done = run(ready, -1, { type: 'minigameDone', results: { placements: [[1], [0]] } });
  assert.equal(done.state.phase, 'minigameResults');
  assert.deepEqual(done.events[0], { type: 'minigameResults', results: { placements: [[1], [0]] }, coinDelta: { 0: -10, 1: 10 } });
  assert.deepEqual(done.events.slice(1).map((e) => [e.seat, e.delta, e.reason]), [[0, -10, 'duel'], [1, 10, 'duel']]);
  assert.equal(done.state.players[0].coins, 9 + 3 - 10);
  assert.equal(done.state.players[1].coins, 10 + 10);
  assert.equal(done.state.minigame.coinDelta[1], 10);

  const adv = run(done.state, -1, { type: 'advance' });
  assert.equal(adv.state.phase, 'boardTurn');
  assert.equal(adv.state.minigame, null);
  assert.equal(adv.state.turn.seat, 1);   // next player's turn
  assert.deepEqual(types(adv.events), ['turnStarted']);
  assert.equal(adv.state.round, 2);
});

test('duel: loser pays at most what they own; a tie pays nothing; goldenDoener roll is kept after the duel', () => {
  let s = at(round2(started(3)), 1, 's5', { coins: 3 });
  s = edit(s, (d) => { d.turn.extraRolls = 1; });
  const r = rollAs(s, 5);
  const done = run(run(r.state, -1, { type: 'advance' }).state, -1, { type: 'minigameDone', results: { placements: [[1], [0]] } });
  assert.deepEqual(done.events[0].coinDelta, { 0: -10, 1: 10 });   // seat 0 owns 12 (9 + 3 from the blue space), the stake is 10
  const poorLoser = edit(r.state, (d) => { d.phase = 'minigame'; d.players[0].coins = 2; });
  const p = run(poorLoser, -1, { type: 'minigameDone', results: { placements: [[1], [0]] } });
  assert.deepEqual(p.events[0].coinDelta, { 0: -2, 1: 2 });
  const tie = run(edit(r.state, (d) => { d.phase = 'minigame'; }), -1, { type: 'minigameDone', results: { placements: [[0, 1]] } });
  assert.deepEqual(tie.events[0].coinDelta, { 0: 0, 1: 0 });
  assert.equal(tie.events.length, 1);
  const resumed = run(tie.state, -1, { type: 'advance' });
  assert.equal(resumed.state.turn.seat, 0);   // extra roll
  assert.equal(resumed.state.turn.step, 'roll');
  assert.equal(resumed.state.turn.extraRolls, 0);
});

test('duel: with several players on the space exactly one is picked, deterministically', () => {
  let s = at(at(round2(started(4)), 1, 's5'), 2, 's5');
  s = at(s, 3, 's5');
  const picks = new Set();
  for (let i = 0; i < 30; i++) {
    const t = forceDice(s, [5], 1 + i * 100003);
    const a = run(t, 0, { type: 'roll' }), b = run(t, 0, { type: 'roll' });
    const d1 = a.events.find((e) => e.type === 'duelStart');
    assert.deepEqual(d1, b.events.find((e) => e.type === 'duelStart'));
    assert.equal(d1.seats[0], 0);
    assert.ok([1, 2, 3].includes(d1.seats[1]));
    picks.add(d1.seats[1]);
    assert.deepEqual(a.state.minigame.seats, [0, d1.seats[1]]);
  }
  assert.ok(picks.size > 1);
});

test('duel: an absent opponent (or an absent mover) means no duel', () => {
  let s = at(round2(started(3)), 1, 's5');
  s = run(s, -1, { type: 'seatPresence', seat: 1, connected: false }).state;
  const r = rollAs(s, 5);
  assert.equal(r.state.phase, 'boardTurn');
  assert.ok(!types(r.events).includes('duelStart'));
  let m = at(round2(started(3)), 1, 's5');
  m = run(m, -1, { type: 'seatPresence', seat: 0, connected: false }).state;
  assert.equal(rollAs(m, 5).state.phase, 'boardTurn');
});

test('duel: never in round 1, even when landing on an occupied space', () => {
  const s = poor0(at(started(3), 1, 's5'));
  assert.equal(s.round, 1);
  const r = rollAs(s, 5);
  assert.ok(!types(r.events).includes('duelStart'));
  assert.equal(r.state.phase, 'boardTurn');
  assert.equal(r.state.turn.seat, 1);   // straight on to the next player
  // the very same landing in round 2 is a duel
  assert.ok(types(rollAs(round2(s), 5).events).includes('duelStart'));
});

test('duel: never on the start space (a fresh round-2 pile-up at s0 is no duel)', () => {
  // seat 0 stands on s19, seat 1 waits on the start space s0: landing there with a 1 must not duel
  let s = at(at(round2(started(3)), 0, 's19'), 1, 's0');
  const r = rollAs(s, 1);
  assert.deepEqual(r.state.players[0].spaceId, 's0');
  assert.ok(!types(r.events).includes('duelStart'));
  assert.equal(r.state.phase, 'boardTurn');
});

test('duel: only on landing, not when passing a player', () => {
  const s = at(round2(started(3)), 1, 's3');
  const r = rollAs(s, 5);   // s0 -> s5, passes s3
  assert.ok(!types(r.events).includes('duelStart'));
});

test('duel: the thresholds live in state.rules (duelFromRound / duelNotOn)', () => {
  const s = poor0(at(started(3), 1, 's5'));
  const early = edit(s, (d) => { d.rules.duelFromRound = 1; });
  assert.ok(types(rollAs(early, 5).events).includes('duelStart'));
  const onBlue = edit(round2(s), (d) => { d.rules.duelNotOn = ['blue']; });
  assert.ok(!types(rollAs(onBlue, 5).events).includes('duelStart'));
});

// ---- at most one duel per round (rules.maxDuelsPerRound)

/** seat 0 (on s0) rolls 5 onto seat 1 at s5 => duel; seat 1 is then to roll 1 onto seat 2 at s6 => would be a second duel in the same round */
function twoDuelSetup(over = {}) {
  let s = at(at(round2(started(4)), 1, 's5'), 2, 's6');
  s = edit(s, (d) => { Object.assign(d.rules, over); });
  const duel = rollAs(s, 5);
  assert.ok(types(duel.events).includes('duelStart'));
  assert.equal(duel.state.duelsThisRound, 1);
  const done = run(run(run(duel.state, -1, { type: 'advance' }).state, -1, { type: 'minigameDone', results: { placements: [[0], [1]] } }).state, -1, { type: 'advance' });
  assert.equal(done.state.turn.seat, 1);
  return done.state;
}

test('duel cap: the second landing on an occupied space in the same round is no duel', () => {
  const r = rollAs(twoDuelSetup(), 1);   // seat 1: s5 -> s6, where seat 2 stands
  assert.equal(r.state.players[1].spaceId, 's6');
  assert.ok(!types(r.events).includes('duelStart'));
  assert.ok(!types(r.events).includes('minigameStart'));
  assert.equal(r.state.phase, 'boardTurn');
  assert.equal(r.state.turn.seat, 2);   // straight on to the next player
  assert.equal(r.state.duelsThisRound, 1);
});

test('duel cap: the counter resets with the next round, so every round may have one duel', () => {
  let s = rollAs(twoDuelSetup(), 1).state;   // seat 1 -> s6 (no duel), seat 2 to roll
  s = run(rollAs(s, 1).state, 2, { type: 'choosePath', spaceId: 's7' }).state;   // seat 2 leaves the fork s6 -> s7
  s = rollAs(s, 2).state;   // seat 3 s0 -> s2, the round minigame starts
  assert.equal(s.phase, 'minigameIntro');
  assert.equal(s.minigame.purpose, 'round');
  s = run(run(run(s, -1, { type: 'advance' }).state, -1, { type: 'minigameDone', results: { placements: [[0], [1], [2], [3]] } }).state, -1, { type: 'advance' }).state;
  assert.equal(s.round, 3);
  assert.equal(s.duelsThisRound, 0);
  const p = edit(s, (d) => { d.turn.seat = 0; d.turnIndex = d.turnOrder.indexOf(0); Object.assign(d.players[0], { spaceId: 's5', coins: 9 }); d.players[1].spaceId = 's6'; });
  assert.ok(types(rollAs(p, 1).events).includes('duelStart'));
});

test('duel cap: rules.maxDuelsPerRound is tunable; saves without the new fields fall back to the defaults', () => {
  assert.ok(types(rollAs(twoDuelSetup({ maxDuelsPerRound: 2 }), 1).events).includes('duelStart'));
  const fresh = edit(at(round2(started(3)), 1, 's5'), (d) => { delete d.duelsThisRound; delete d.rules.maxDuelsPerRound; });
  const r = rollAs(fresh, 5);
  assert.ok(types(r.events).includes('duelStart'));   // missing counter counts as 0
  assert.equal(r.state.duelsThisRound, 1);
  const capped = edit(twoDuelSetup(), (d) => { delete d.rules.maxDuelsPerRound; });   // missing cap = default 1
  assert.ok(!types(rollAs(capped, 1).events).includes('duelStart'));
});
