import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, MINIGAMES, MINIGAME_IDS, HOST_SEAT } from '../contracts.js';
import { applyIntent, pickMinigame, isTeamGameAllowed, registerBoard } from './index.js';
import { started, run, edit, rollAs, types, makeBoard } from './test-fixtures.js';

const seatsOf = (n) => Array.from({ length: n }, (_, i) => i);
const pick = (n, o = {}) => pickMinigame({ seats: seatsOf(n), purpose: 'round', forceId: null, recent: [], rng: createRng(7), ...o });

test('isTeamGameAllowed: even and >= 4 only', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(isTeamGameAllowed), [false, false, false, true, false, true]);
});

test('pickMinigame: team games only with an even count >= 4; limits respected', () => {
  for (let n = 2; n <= 6; n++) {
    const rng = createRng(n);
    const kinds = new Set();
    for (let i = 0; i < 300; i++) {
      const m = pickMinigame({ seats: seatsOf(n), purpose: 'round', forceId: null, recent: [], rng });
      kinds.add(m.kind);
      assert.ok(MINIGAME_IDS.includes(m.id));
      assert.equal(m.kind, MINIGAMES[m.id].kind);
      assert.ok(n >= MINIGAMES[m.id].min && n <= MINIGAMES[m.id].max);
      assert.deepEqual(m.seats, seatsOf(n));
      assert.equal(m.purpose, 'round');
      assert.deepEqual([m.ready, m.results, m.coinDelta], [[], null, null]);
      assert.ok(Number.isInteger(m.seed) && m.seed >= 0 && m.seed < 2 ** 32);
      if (m.kind === 'team') {
        assert.equal(m.mode, 'team');
        assert.equal(m.teams.length, 2);
        assert.equal(m.teams[0].length, n / 2);
        assert.equal(m.teams[1].length, n / 2);
        assert.deepEqual([...m.teams[0], ...m.teams[1]].sort(), seatsOf(n));
      } else {
        assert.equal(m.mode, 'ffa');
        assert.equal(m.teams, null);
      }
    }
    assert.equal(kinds.has('team'), isTeamGameAllowed(n), `n=${n}`);
    assert.ok(kinds.has('solo') && kinds.has('arena'));
  }
});

test('pickMinigame: duel => solo kind, exactly 2 seats, mode duel', () => {
  const rng = createRng(3);
  for (let i = 0; i < 100; i++) {
    const m = pickMinigame({ seats: [4, 1], purpose: 'duel', forceId: null, recent: [], rng });
    assert.equal(m.kind, 'solo');
    assert.equal(m.mode, 'duel');
    assert.deepEqual(m.seats, [1, 4]);
  }
  assert.throws(() => pick(3, { purpose: 'duel' }));
  // an arena id cannot be forced into a duel
  assert.equal(pickMinigame({ seats: [0, 1], purpose: 'duel', forceId: 'ordnungsamt', recent: [], rng }).kind, 'solo');
});

test('pickMinigame: forceId honoured only when legal (?mg)', () => {
  assert.equal(pick(3, { forceId: 'ordnungsamt' }).id, 'ordnungsamt');
  assert.equal(pick(5, { forceId: 'forza' }).id, 'forza');
  assert.equal(pick(4, { forceId: 'tauziehen' }).id, 'tauziehen');
  assert.ok(pick(3, { forceId: 'tauziehen' }).kind !== 'team');   // team needs even >= 4
  assert.ok(pick(5, { forceId: 'sitzplatz' }).kind !== 'team');
  assert.ok(pick(2, { forceId: 'sitzplatz' }).kind !== 'team');
  assert.notEqual(pick(3, { forceId: 'bogus' }).id, 'bogus');
  assert.equal(pickMinigame({ seats: [0, 1], purpose: 'duel', forceId: 'forza', recent: [], rng: createRng(1) }).id, 'forza');
});

test('pickMinigame: avoids recent picks, relaxes the oldest when everything is recent', () => {
  const all3 = MINIGAME_IDS.filter((id) => MINIGAMES[id].kind !== 'team');
  const rest = all3.filter((id) => id !== 'aura');
  for (let i = 0; i < 50; i++) assert.equal(pick(3, { recent: rest, rng: createRng(i) }).id, 'aura');
  // everything recent: still returns something, and not the most recent one
  const order = [...all3];
  for (let i = 0; i < 50; i++) assert.notEqual(pick(3, { recent: order, rng: createRng(i) }).id, order.at(-1));
});

test('pickMinigame is deterministic for the same rng and consumes it', () => {
  assert.deepEqual(pick(4, { rng: createRng(11) }), pick(4, { rng: createRng(11) }));
  const rng = createRng(11);
  const a = pick(4, { rng }), b = pick(4, { rng });
  assert.notDeepEqual(a, b);
});

// ---------------------------------------------------------------------------------------------------------------------

/** every player rolls 1,2,3.. so nobody shares a space; ends in the round-minigame intro */
function toRoundMinigame(s) {
  const n = s.turnOrder.length;
  for (let i = 0; i < n; i++) s = rollAs(s, i + 1).state;
  return s;
}
const finishMinigame = (s, placements) => run(run(s, HOST_SEAT, { type: 'advance' }).state, HOST_SEAT, { type: 'minigameDone', results: { placements } });

test('round end: after the last player the round minigame intro starts with connected seats', () => {
  const s = started(3);
  const r1 = rollAs(s, 1), r2 = rollAs(r1.state, 2);
  assert.equal(r2.state.phase, 'boardTurn');
  const r3 = rollAs(r2.state, 3);
  assert.equal(r3.state.phase, 'minigameIntro');
  assert.equal(r3.state.turn, null);
  assert.deepEqual(types(r3.events).slice(-2), ['coinsChanged', 'minigameStart']);
  const mg = r3.state.minigame;
  assert.equal(mg.purpose, 'round');
  assert.deepEqual(mg.seats, [0, 1, 2]);
  assert.deepEqual(r3.state.mgHistory, [mg.id]);
  assert.deepEqual(r3.events.at(-1).minigame, mg);
});

test('ready: participants only, idempotent, everybody ready -> minigame; advance starts it anyway', () => {
  const s = toRoundMinigame(started(3));
  const a = run(s, 0, { type: 'ready' });
  assert.deepEqual(a.state.minigame.ready, [0]);
  const again = applyIntent(a.state, 0, { type: 'ready' });
  assert.equal(again.error, null);
  assert.equal(again.state, a.state);   // no-op: same object, no rev bump
  assert.deepEqual(again.events, []);
  const b = run(run(a.state, 2, { type: 'ready' }).state, 1, { type: 'ready' });
  assert.equal(b.state.phase, 'minigame');
  assert.equal(run(s, HOST_SEAT, { type: 'advance' }).state.phase, 'minigame');
  assert.equal(applyIntent(b.state, 0, { type: 'ready' }).error, 'wrongPhase');
  const outsider = edit(s, (d) => { d.minigame.seats = [0, 1]; });
  assert.equal(applyIntent(outsider, 2, { type: 'ready' }).error, 'forbidden');
});

test('round minigame awards 10 / 5 / 2 by placement', () => {
  const s = toRoundMinigame(started(3));
  const before = s.players.map((p) => p.coins);
  const r = finishMinigame(s, [[2], [0], [1]]);
  assert.equal(r.state.phase, 'minigameResults');
  assert.deepEqual(r.events[0], { type: 'minigameResults', results: { placements: [[2], [0], [1]] }, coinDelta: { 0: 5, 1: 2, 2: 10 } });
  assert.deepEqual(r.state.players.map((p, i) => p.coins - before[i]), [5, 2, 10]);
  assert.deepEqual(r.events.slice(1).map((e) => [e.seat, e.delta, e.reason]), [[0, 5, 'minigame'], [1, 2, 'minigame'], [2, 10, 'minigame']]);
  assert.deepEqual(r.state.players.map((p) => p.mgWins), [0, 0, 1]);
  assert.deepEqual(r.state.minigame.results, { placements: [[2], [0], [1]] });
  assert.deepEqual(r.state.minigame.coinDelta, { 0: 5, 1: 2, 2: 10 });
});

test('ties share the better reward (standard competition ranks)', () => {
  const s = toRoundMinigame(started(4));
  const delta = (placements) => finishMinigame(s, placements).events[0].coinDelta;
  assert.deepEqual(delta([[0, 1], [2], [3]]), { 0: 10, 1: 10, 2: 2, 3: 0 });
  assert.deepEqual(delta([[3], [0, 1, 2]]), { 0: 5, 1: 5, 2: 5, 3: 10 });
  assert.deepEqual(delta([[0, 1, 2, 3]]), { 0: 10, 1: 10, 2: 10, 3: 10 });
  assert.deepEqual(delta([[2], [3], [0, 1]]), { 0: 2, 1: 2, 2: 10, 3: 5 });
});

test('team result: every member of a group gets the group rank reward', () => {
  let s = toRoundMinigame(started(4));
  s = edit(s, (d) => { Object.assign(d.minigame, { id: 'tauziehen', kind: 'team', mode: 'team', teams: [[0, 2], [1, 3]] }); });
  const d = finishMinigame(s, [[1, 3], [0, 2]]).events[0].coinDelta;
  assert.deepEqual(d, { 0: 5, 1: 10, 2: 5, 3: 10 });
});

test('minigameDone: wrong phase, malformed results; missing/extra seats are normalised', () => {
  const s = toRoundMinigame(started(3));
  assert.equal(applyIntent(s, HOST_SEAT, { type: 'minigameDone', results: { placements: [[0], [1], [2]] } }).error, 'wrongPhase');
  const m = run(s, HOST_SEAT, { type: 'advance' }).state;
  assert.equal(applyIntent(m, HOST_SEAT, { type: 'minigameDone', results: {} }).error, 'invalid');
  assert.equal(applyIntent(m, HOST_SEAT, { type: 'minigameDone', results: { placements: [0, 1] } }).error, 'invalid');
  const r = run(m, HOST_SEAT, { type: 'minigameDone', results: { placements: [[1], [1, 9]], labels: { 1: '12,4 s' } } });
  assert.deepEqual(r.events[0].results, { placements: [[1], [0, 2]], labels: { 1: '12,4 s' } });
  assert.deepEqual(r.events[0].coinDelta, { 0: 5, 1: 10, 2: 5 });
});

test('advance after results: next round starts with a fresh turn order position', () => {
  const s = toRoundMinigame(started(3));
  const r = finishMinigame(s, [[0], [1], [2]]);
  const a = run(r.state, HOST_SEAT, { type: 'advance' });
  assert.equal(a.state.phase, 'boardTurn');
  assert.equal(a.state.round, 2);
  assert.equal(a.state.minigame, null);
  assert.equal(a.state.turnIndex, 0);
  assert.equal(a.state.turn.seat, a.state.turnOrder[0]);
  assert.deepEqual(types(a.events), ['roundStarted', 'turnStarted']);
  assert.deepEqual(a.events[0], { type: 'roundStarted', round: 2 });
  // advance elsewhere is a no-op
  const noop = applyIntent(a.state, HOST_SEAT, { type: 'advance' });
  assert.equal(noop.state, a.state);
});

test('forceMinigame (?mg) is used for round minigames and duels', () => {
  const g = started(3, { forceMinigame: 'ordnungsamt' });
  assert.equal(toRoundMinigame(g).minigame.id, 'ordnungsamt');
  const f = started(3, { forceMinigame: 'forza' });
  assert.equal(toRoundMinigame(f).minigame.id, 'forza');
  const duel = rollAs(edit(f, (d) => { d.players[1].spaceId = 's5'; }), 5);
  assert.equal(duel.state.minigame.id, 'forza');
  assert.equal(duel.state.minigame.purpose, 'duel');
});

test('absent seats are excluded from minigames; fewer than 2 connected skips the minigame', () => {
  let s = started(3);
  s = run(s, HOST_SEAT, { type: 'seatPresence', seat: 1, connected: false }).state;
  s = toRoundMinigame(s);
  assert.deepEqual(s.minigame.seats, [0, 2]);
  const r = finishMinigame(s, [[2], [0]]);
  assert.deepEqual(r.events[0].coinDelta, { 0: 5, 2: 10 });   // absent seat 1 gets nothing
  // an absent participant does not hold up the intro
  const p = run(s, 0, { type: 'ready' }).state;
  assert.equal(p.phase, 'minigameIntro');
  assert.equal(run(p, 2, { type: 'ready' }).state.phase, 'minigame');
  const lone = run(run(started(3), HOST_SEAT, { type: 'seatPresence', seat: 1, connected: false }).state, HOST_SEAT, { type: 'seatPresence', seat: 2, connected: false }).state;
  const out = toRoundMinigame(edit(lone, (d) => { d.turnOrder = [0, 1, 2]; }));
  assert.equal(out.phase, 'boardTurn');
  assert.equal(out.round, 2);
});

test('absent participant going offline during the intro may complete it', () => {
  const s = run(toRoundMinigame(started(3)), 0, { type: 'ready' }).state;
  const s2 = run(s, 1, { type: 'ready' }).state;
  const r = run(s2, HOST_SEAT, { type: 'seatPresence', seat: 2, connected: false });
  assert.equal(r.state.phase, 'minigame');
});

test('mgHistory is capped and tracks picks', () => {
  let s = started(3);
  for (let round = 0; round < 10; round++) {
    s = toRoundMinigame(s);
    s = finishMinigame(s, [[0], [1], [2]]).state;
    s = run(s, HOST_SEAT, { type: 'advance' }).state;
    s = edit(s, (d) => { d.players.forEach((p, i) => { p.spaceId = 's0'; }); });
  }
  assert.equal(s.mgHistory.length, 6);
  assert.equal(s.round, 11);
});

test('skipTurns: a skipped seat is announced and loses exactly one turn', () => {
  let s = started(3);
  s = edit(s, (d) => { d.players[1].skipTurns = 1; });
  const r = rollAs(s, 1);
  assert.deepEqual(types(r.events).slice(-2), ['turnSkipped', 'turnStarted']);
  assert.equal(r.state.turn.seat, 2);
  assert.equal(r.state.players[1].skipTurns, 0);
  const all = edit(started(3), (d) => { d.players[1].skipTurns = 1; d.players[2].skipTurns = 1; });
  const e = rollAs(all, 1);
  assert.deepEqual(types(e.events).slice(-4), ['coinsChanged', 'turnSkipped', 'turnSkipped', 'minigameStart']);
  assert.equal(e.state.phase, 'minigameIntro');   // nobody left to play: straight to the round minigame
});

// ---------------------------------------------------------------------------------------------------------------------
// stars: Endspurt + victory

const starTurn = (s, seat, stars) => edit(s, (d) => {
  d.turn.seat = seat; d.turn.step = 'star'; d.players[seat].coins = 30; d.players[seat].stars = stars; d.players[seat].spaceId = 's2';
  d.starSpaceId = 's2'; d.turnIndex = d.turnOrder.indexOf(seat);
  d.players.forEach((p, i) => { if (i !== seat) p.spaceId = 's9'; });   // nobody else on the star space => no duel
});
const buy = (s) => run(s, s.turn.seat, { type: 'buyStar', accept: true });

test('Endspurt starts exactly once, at starTarget - 2 stars', () => {
  let s = started(3, { starTarget: 9 });
  let r = buy(starTurn(s, 0, 5));   // 6 stars: not yet
  assert.ok(!types(r.events).includes('endspurtStarted'));
  assert.equal(r.state.endspurt, false);
  r = buy(starTurn(r.state, 1, 6));   // 7 stars = N-2
  assert.deepEqual(types(r.events).slice(0, 3), ['coinsChanged', 'starBought', 'endspurtStarted']);
  assert.equal(r.state.endspurt, true);
  r = buy(starTurn(r.state, 2, 7));   // 8 stars: no second event
  assert.ok(!types(r.events).includes('endspurtStarted'));
  assert.equal(r.state.phase, 'minigameIntro');   // seat 2 was the last to move => round minigame
});

test('Endspurt edge cases: N=2 starts at the first star, N=1 goes straight to victory', () => {
  const r2 = buy(starTurn(started(3, { starTarget: 2 }), 0, 0));
  assert.ok(types(r2.events).includes('endspurtStarted'));
  assert.equal(r2.state.phase, 'boardTurn');
  const r1 = buy(starTurn(started(3, { starTarget: 1 }), 0, 0));
  assert.ok(!types(r1.events).includes('endspurtStarted'));
  assert.equal(r1.state.phase, 'victory');
  const r3 = buy(starTurn(started(3, { starTarget: 3 }), 0, 0));
  assert.ok(types(r3.events).includes('endspurtStarted'));   // max(1, 3-2) = 1
});

test('victory at starTarget stars: immediate, phase victory, winner set, no further moves', () => {
  const s = started(3, { starTarget: 4 });
  const r = buy(starTurn(s, 1, 3));
  assert.deepEqual(types(r.events), ['coinsChanged', 'starBought', 'victory']);
  assert.deepEqual(r.events.at(-1), { type: 'victory', seat: 1 });
  assert.equal(r.state.phase, 'victory');
  assert.equal(r.state.winner, 1);
  assert.equal(r.state.turn, null);
  assert.equal(applyIntent(r.state, 1, { type: 'roll' }).error, 'wrongPhase');
});

test('victory through an event effect also ends the game (and Endspurt does not fire on the winning star)', () => {
  const base = edit(started(3, { starTarget: 2 }), (d) => { d.players[0].stars = 1; d.players[0].spaceId = 's7'; d.endspurt = true; });
  registerBoard(makeBoard({ events: { bonus: ({ seat }) => ({ banner: 'Stern!', effects: [{ type: 'stars', seat, delta: 1 }] }), warp: () => ({ banner: '', effects: [] }) } }));
  const r = rollAs(base, 1);   // s8
  assert.deepEqual(types(r.events), ['diceRolled', 'moved', 'eventSpace', 'victory']);
  assert.equal(r.state.phase, 'victory');
  assert.equal(r.state.winner, 0);
});
