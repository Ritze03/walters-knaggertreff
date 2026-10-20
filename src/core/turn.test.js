import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOST_SEAT } from '../contracts.js';
import { applyIntent, registerBoard } from './index.js';
import { started, run, edit, forceDice, rollAs, types, deepFreeze, registerFixture, makeBoard, lobby } from './test-fixtures.js';

const at = (s, seat, spaceId, extra = {}) => edit(s, (d) => { Object.assign(d.players[seat], { spaceId }, extra); });
const starAt = (s, id) => edit(s, (d) => { d.starSpaceId = id; });

test('die is always 1..10 and covers the range; doubleDice is two dice', () => {
  const base = started(3);
  const seen = new Set();
  for (let i = 0; i < 1500; i++) {
    const s = edit(base, (d) => { d.rng = (i * 2654435761) >>> 0; });
    const r = run(s, 0, { type: 'roll' });
    const ev = r.events.find((e) => e.type === 'diceRolled');
    assert.equal(ev.dice.length, 1);
    assert.equal(ev.value, ev.dice[0]);
    assert.ok(ev.value >= 1 && ev.value <= 10, `value ${ev.value}`);
    seen.add(ev.value);
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('determinism: same seed + same intents -> identical state and events', () => {
  const play = () => {
    let s = started(3, { seed: 99 });
    const all = [];
    for (let i = 0; i < 6; i++) {
      const r = run(s, s.turn.seat, { type: 'roll' });
      s = r.state; all.push(...r.events);
      if (s.turn?.step === 'star') s = run(s, s.turn.seat, { type: 'buyStar', accept: true }).state;
      if (s.turn?.step === 'path') s = run(s, s.turn.seat, { type: 'choosePath', spaceId: s.turn.options[0] }).state;
      if (s.phase !== 'boardTurn') break;
    }
    return JSON.stringify([s, all]);
  };
  assert.equal(play(), play());
  assert.notEqual(JSON.stringify(started(3, { seed: 1 })), JSON.stringify(started(3, { seed: 2 })));
});

test('applyIntent never mutates its (deep-frozen) input', () => {
  let s = started(3);
  s = at(s, 1, 's5', { coins: 20, items: ['trap', 'steal'] });
  const arr = [
    [0, { type: 'roll' }],
    [0, { type: 'roll' }, (x) => forceDice(x, [3])],
    [0, { type: 'useItem', item: 'trap', spaceId: 's3' }, (x) => at(x, 0, 's0', { items: ['trap'] })],
    [HOST_SEAT, { type: 'seatPresence', seat: 1, connected: false }],
    [HOST_SEAT, { type: 'advance' }],
  ];
  for (const [actor, intent, prep] of arr) {
    const input = deepFreeze(prep ? prep(s) : structuredClone(s));
    const snapshot = JSON.stringify(input);
    applyIntent(input, actor, intent);
    assert.equal(JSON.stringify(input), snapshot);
  }
});

test('permissions: wrong phase, not your turn, wrong step', () => {
  const s = started(3);
  assert.equal(applyIntent(s, 1, { type: 'roll' }).error, 'notYourTurn');
  assert.equal(applyIntent(lobby(2), 0, { type: 'roll' }).error, 'wrongPhase');
  assert.equal(applyIntent(s, 0, { type: 'buyStar', accept: true }).error, 'wrongStep');
  assert.equal(applyIntent(s, 0, { type: 'buyItem', item: null }).error, 'wrongStep');
  assert.equal(applyIntent(s, 0, { type: 'choosePath', spaceId: 's1' }).error, 'wrongStep');
  assert.equal(applyIntent(s, 1, { type: 'useItem', item: 'trap', spaceId: 's3' }).error, 'notYourTurn');
  const mid = edit(s, (d) => { d.turn.step = 'star'; });
  assert.equal(applyIntent(mid, 0, { type: 'roll' }).error, 'wrongStep');
  assert.equal(applyIntent(mid, 0, { type: 'useItem', item: 'trap', spaceId: 's3' }).error, 'wrongStep');
});

test('blue +3, red -3 (never below 0), events in order, turn passes on', () => {
  const s = started(3);
  const b = rollAs(s, 1);
  assert.deepEqual(b.events, [
    { type: 'diceRolled', seat: 0, value: 1, dice: [1] },
    { type: 'moved', seat: 0, path: ['s1'] },
    { type: 'coinsChanged', seat: 0, delta: 3, total: 8, reason: 'space' },
    { type: 'turnStarted', seat: 1 },
  ]);
  assert.equal(b.state.turn.seat, 1);
  assert.equal(b.state.players[0].spaceId, 's1');

  const r = rollAs(s, 3);   // s3 red, 5 coins
  assert.equal(r.state.players[0].coins, 2);
  const low = rollAs(edit(s, (d) => { d.players[0].coins = 1; }), 3);
  assert.deepEqual(low.events.find((e) => e.type === 'coinsChanged'), { type: 'coinsChanged', seat: 0, delta: -1, total: 0, reason: 'space' });
  const zero = rollAs(edit(s, (d) => { d.players[0].coins = 0; }), 3);
  assert.equal(zero.state.players[0].coins, 0);
  assert.ok(!types(zero.events).includes('coinsChanged'));
});

test('movement spans multiple spaces and wraps around the loop', () => {
  const s = at(started(3), 0, 's18');
  const r = rollAs(s, 4);   // s19, s0, s1, s2
  assert.deepEqual(r.events.find((e) => e.type === 'moved').path, ['s19', 's0', 's1', 's2']);
  assert.equal(r.state.players[0].spaceId, 's2');
});

test('Endspurt doubles blue and red', () => {
  const s = edit(started(3), (d) => { d.endspurt = true; });
  assert.equal(rollAs(s, 1).state.players[0].coins, 5 + 6);
  assert.equal(rollAs(edit(s, (d) => { d.players[0].coins = 20; }), 3).state.players[0].coins, 20 - 6);
  assert.equal(rollAs(edit(s, (d) => { d.players[0].coins = 4; }), 3).state.players[0].coins, 0);
});

test('branch: movement stops at the fork, choosePath continues, bad choice rejected', () => {
  const s = at(started(3), 0, 's5');
  const r = rollAs(s, 3);
  assert.deepEqual(r.events.at(-1), { type: 'moved', seat: 0, path: ['s6'] });
  assert.equal(r.state.turn.step, 'path');
  assert.deepEqual(r.state.turn.options, ['s7', 's12']);
  assert.equal(r.state.turn.stepsLeft, 2);
  assert.equal(applyIntent(r.state, 0, { type: 'choosePath', spaceId: 's9' }).error, 'invalid');
  assert.equal(applyIntent(r.state, 1, { type: 'choosePath', spaceId: 's7' }).error, 'notYourTurn');
  const a = run(r.state, 0, { type: 'choosePath', spaceId: 's7' });
  assert.deepEqual(a.events[0], { type: 'moved', seat: 0, path: ['s7', 's8'] });
  assert.equal(a.state.players[0].spaceId, 's8');   // event space 'bonus'
  assert.ok(types(a.events).includes('eventSpace'));
  const b = run(r.state, 0, { type: 'choosePath', spaceId: 's12' });
  assert.deepEqual(b.events[0], { type: 'moved', seat: 0, path: ['s12', 's13'] });
});

test('landing exactly on a fork does not prompt', () => {
  const r = rollAs(at(started(3), 0, 's5'), 1);
  assert.equal(r.state.turn.seat, 1);
  assert.equal(r.state.players[0].spaceId, 's6');
});

test('event space: coins handler, eventSpace payload', () => {
  const ev = rollAs(at(started(3), 0, 's7'), 1);
  const e = ev.events.find((x) => x.type === 'eventSpace');
  assert.equal(e.eventId, 'bonus');
  assert.equal(e.banner, 'Bonus!');
  assert.equal(e.effects[0].type, 'coins');
  const gain = ev.events.find((x) => x.type === 'coinsChanged');
  assert.equal(gain.reason, 'event');
  assert.ok(gain.delta >= 3 && gain.delta <= 5);
  assert.equal(ev.state.players[0].coins, 5 + gain.delta);
});

test('event space: moveTo teleports with no landing effect and no duel at the destination', () => {
  let s = at(started(3), 0, 's12');
  s = at(s, 1, 's1');   // would be a duel if teleport counted as landing
  const r = rollAs(s, 1);   // s13 = warp -> s1
  assert.deepEqual(types(r.events), ['diceRolled', 'moved', 'eventSpace', 'teleported', 'turnStarted']);
  assert.deepEqual(r.events[3], { type: 'teleported', seat: 0, from: 's13', to: 's1' });
  assert.equal(r.events[2].lineId, 'schienenersatz');
  assert.equal(r.events[2].sfx, 'whoosh');
  assert.equal(r.state.players[0].spaceId, 's1');
  assert.equal(r.state.players[0].coins, 5);   // s1 is blue but a teleport has no landing effect
  assert.equal(r.state.phase, 'boardTurn');
});

test('star: offered when passing (affordable), buy moves the star elsewhere and the walk continues', () => {
  let s = starAt(at(started(3), 0, 's0', { coins: 10 }), 's2');
  const r = rollAs(s, 5);
  assert.equal(r.state.turn.step, 'star');
  assert.equal(r.state.turn.stepsLeft, 3);
  assert.deepEqual(r.events.at(-1), { type: 'moved', seat: 0, path: ['s1', 's2'] });
  assert.equal(applyIntent(r.state, 1, { type: 'buyStar', accept: true }).error, 'notYourTurn');
  const b = run(r.state, 0, { type: 'buyStar', accept: true });
  assert.deepEqual(types(b.events), ['coinsChanged', 'starBought', 'moved', 'coinsChanged', 'turnStarted']);
  assert.deepEqual(b.events[0], { type: 'coinsChanged', seat: 0, delta: -10, total: 0, reason: 'star' });
  assert.deepEqual(b.events[1], { type: 'starBought', seat: 0, price: 10, total: 1, newStarSpaceId: 's18' });
  assert.equal(b.state.starSpaceId, 's18');
  assert.equal(b.state.players[0].stars, 1);
  assert.deepEqual(b.events[2].path, ['s3', 's4', 's5']);
  assert.equal(b.state.players[0].spaceId, 's5');
  assert.equal(b.state.players[0].coins, 3);   // s5 blue
});

test('star: decline keeps the star and the movement continues', () => {
  const s = starAt(at(started(3), 0, 's0', { coins: 10 }), 's2');
  const r = rollAs(s, 3);
  assert.equal(r.state.turn.step, 'star');
  const d = run(r.state, 0, { type: 'buyStar', accept: false });
  assert.deepEqual(types(d.events), ['moved', 'coinsChanged', 'turnStarted']);
  assert.equal(d.state.starSpaceId, 's2');
  assert.equal(d.state.players[0].stars, 0);
  assert.equal(d.state.players[0].coins, 10 - 3);   // landed on s3 (red)
  assert.equal(d.state.players[0].spaceId, 's3');
});

test('star: offered when landing on it, landing effect follows the decision', () => {
  const s = starAt(at(started(3), 0, 's0', { coins: 12 }), 's2');
  const r = rollAs(s, 2);
  assert.equal(r.state.turn.step, 'star');
  assert.equal(r.state.turn.stepsLeft, 0);
  const b = run(r.state, 0, { type: 'buyStar', accept: true });
  assert.equal(b.state.players[0].coins, 12 - 10 + 3);   // s2 is blue
  assert.equal(b.state.turn.seat, 1);
});

test('star: not offered when you cannot afford it; buyStar with too few coins is cantAfford', () => {
  const r = rollAs(starAt(at(started(3), 0, 's0', { coins: 9 }), 's2'), 2);
  assert.equal(r.state.turn.seat, 1);   // landed on the star without a prompt
  assert.equal(r.state.players[0].stars, 0);
  const forced = edit(started(3), (d) => { d.turn.step = 'star'; d.players[0].coins = 4; });
  const e = applyIntent(forced, 0, { type: 'buyStar', accept: true });
  assert.equal(e.error, 'cantAfford');
  assert.equal(e.state, forced);
});

test('star relocates to a different spot every time (3 candidate spots)', () => {
  const base = started(3);
  registerBoard(makeBoard({ starSpaceIds: ['s2', 's10', 's18'] }));
  for (let i = 0; i < 40; i++) {
    let s = edit(base, (d) => { d.players[0].coins = 10; d.players[0].spaceId = 's1'; d.rng = i * 7919; d.starSpaceId = ['s2', 's10', 's18'][i % 3]; });
    if (s.starSpaceId !== 's2') s = edit(s, (d) => { d.players[0].spaceId = d.starSpaceId === 's10' ? 's9' : 's17'; });
    const before = s.starSpaceId;
    const r = run(forceDice(s, [1]), 0, { type: 'roll' });
    assert.equal(r.state.turn.step, 'star', `i=${i}`);
    const b = run(r.state, 0, { type: 'buyStar', accept: true });
    assert.notEqual(b.state.starSpaceId, before);
    assert.ok(['s2', 's10', 's18'].includes(b.state.starSpaceId));
  }
});

test('shop: offered on landing, buy takes coins and gives the item; null leaves', () => {
  const s = at(started(3), 0, 's3', { coins: 20 });
  const r = rollAs(s, 1);
  assert.equal(r.state.turn.step, 'shop');
  assert.deepEqual(r.state.turn.offer, [
    { item: 'doubleDice', price: 6 }, { item: 'goldenDoener', price: 7 }, { item: 'steal', price: 8 }, { item: 'trap', price: 6 },
  ]);
  assert.equal(applyIntent(r.state, 0, { type: 'buyItem', item: 'bogus' }).error, 'invalid');
  const b = run(r.state, 0, { type: 'buyItem', item: 'steal' });
  assert.deepEqual(types(b.events), ['coinsChanged', 'itemBought', 'turnStarted']);
  assert.deepEqual(b.events[1], { type: 'itemBought', seat: 0, item: 'steal', price: 8 });
  assert.deepEqual(b.state.players[0].items, ['steal']);
  assert.equal(b.state.players[0].coins, 12);
  const n = run(r.state, 0, { type: 'buyItem', item: null });
  assert.equal(n.state.players[0].coins, 20);
  assert.deepEqual(n.state.players[0].items, []);
  assert.equal(n.state.turn.seat, 1);
});

test('shop: offered when passing too, the walk continues afterwards', () => {
  const r = rollAs(at(started(3), 0, 's2', { coins: 20 }), 3);   // s3 (-3), s4 shop (stop, 2 left)...
  assert.equal(r.state.turn.step, 'shop');
  assert.equal(r.state.turn.stepsLeft, 1);
  const b = run(r.state, 0, { type: 'buyItem', item: null });
  assert.equal(b.state.players[0].spaceId, 's5');
  assert.equal(b.state.players[0].coins, 20 + 3);   // passing s3 (red) costs nothing, landing on s5 (blue) pays
});

test('shop: no prompt when poor or full; itemsFull and cantAfford are enforced', () => {
  assert.equal(rollAs(at(started(3), 0, 's3', { coins: 5 }), 1).state.turn.seat, 1);
  assert.equal(rollAs(at(started(3), 0, 's3', { coins: 50, items: ['trap', 'trap', 'trap'] }), 1).state.turn.seat, 1);
  const full = edit(started(3), (d) => { d.turn.step = 'shop'; d.turn.offer = [{ item: 'trap', price: 6 }]; d.players[0].items = ['trap', 'steal', 'steal']; d.players[0].coins = 50; });
  assert.equal(applyIntent(full, 0, { type: 'buyItem', item: 'trap' }).error, 'itemsFull');
  const poor = edit(full, (d) => { d.players[0].items = []; d.players[0].coins = 5; });
  assert.equal(applyIntent(poor, 0, { type: 'buyItem', item: 'trap' }).error, 'cantAfford');
  const two = edit(full, (d) => { d.players[0].items = ['trap', 'steal']; });
  assert.deepEqual(run(two, 0, { type: 'buyItem', item: 'trap' }).state.players[0].items, ['trap', 'steal', 'trap']);
});

test('event effects: stars, giveItem (ignored when full), skipTurns, other seats', () => {
  let s = at(started(3), 0, 's7');
  registerBoard(makeBoard({
    events: {
      bonus: ({ seat }) => ({ banner: 'Mix', effects: [
        { type: 'giveItem', seat, item: 'trap' }, { type: 'giveItem', seat: 1, item: 'steal' },
        { type: 'skipTurns', seat: 1, count: 1 }, { type: 'stars', seat, delta: 1 }, { type: 'coins', seat: 2, delta: -99 }, { type: 'coins', seat: 99, delta: 5 },
      ] }),
      warp: () => ({ banner: '', effects: [] }),
    },
  }));
  s = edit(s, (d) => { d.players[1].items = ['trap', 'trap', 'trap']; });
  const r = rollAs(s, 1);
  assert.deepEqual(r.state.players[0].items, ['trap']);
  assert.deepEqual(r.state.players[1].items, ['trap', 'trap', 'trap']);   // full -> ignored
  assert.equal(r.state.players[0].stars, 1);
  assert.equal(r.state.players[2].coins, 0);
  // seat 1 is skipped (skip consumed), seat 2 plays
  assert.deepEqual(types(r.events).slice(-2), ['turnSkipped', 'turnStarted']);
  assert.equal(r.state.turn.seat, 2);
  assert.equal(r.state.players[1].skipTurns, 0);
});

test('landing on a start/shop space with no effect, turn passes', () => {
  const s = at(at(at(started(3), 0, 's18'), 1, 's9'), 2, 's9');   // nobody on the start space => no duel
  const r = rollAs(s, 2);   // passes s19, lands on s0 (start: no effect)
  assert.equal(r.state.players[0].spaceId, 's0');
  assert.equal(r.state.players[0].coins, 5);   // s19 (red) was only passed
  assert.equal(r.state.turn.seat, 1);
});
