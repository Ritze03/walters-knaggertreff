import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, HOST_SEAT, MAX_ITEMS } from '../contracts.js';
import { applyIntent, botIntent, registerBoard } from './index.js';
import { started, run, edit, deepFreeze, makeBoard, lobby } from './fixtures.js';

const at = (s, seat, spaceId, extra = {}) => edit(s, (d) => { Object.assign(d.players[seat], { spaceId }, extra); });

test('botIntent: null unless it is that seat\'s decision; pure and repeatable', () => {
  const s = deepFreeze(started(3));
  assert.deepEqual(botIntent(s, 0), { type: 'roll' });
  assert.equal(botIntent(s, 1), null);
  assert.equal(botIntent(s, 2), null);
  assert.deepEqual(botIntent(s, 0), botIntent(s, 0));
  assert.equal(botIntent(lobby(2), 0), null);
  const victory = edit(s, (d) => { d.phase = 'victory'; d.turn = null; });
  assert.equal(botIntent(victory, 0), null);
});

test('botIntent: star yes when affordable, path toward the star, shop only with comfortable money', () => {
  const star = edit(started(3), (d) => { d.turn.step = 'star'; d.players[0].coins = 12; });
  assert.deepEqual(botIntent(star, 0), { type: 'buyStar', accept: true });
  const broke = edit(star, (d) => { d.players[0].coins = 3; });
  assert.deepEqual(botIntent(broke, 0), { type: 'buyStar', accept: false });

  const fork = (starId) => edit(started(3), (d) => { d.turn.step = 'path'; d.turn.options = ['s7', 's12']; d.turn.stepsLeft = 2; d.players[0].spaceId = 's6'; d.starSpaceId = starId; });
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(botIntent(edit(fork('s10'), (d) => { d.rng = i * 31; }), 0), { type: 'choosePath', spaceId: 's7' });
    assert.deepEqual(botIntent(edit(fork('s15'), (d) => { d.rng = i * 31; }), 0), { type: 'choosePath', spaceId: 's12' });
  }

  const offer = [{ item: 'trap', price: 6 }, { item: 'steal', price: 8 }];
  const shop = (coins) => edit(started(3), (d) => { d.turn.step = 'shop'; d.turn.offer = offer; d.players[0].coins = coins; });
  const rich = new Set(), poor = new Set();
  for (let i = 0; i < 60; i++) {
    rich.add(JSON.stringify(botIntent(edit(shop(40), (d) => { d.rng = i * 17; }), 0)));
    poor.add(JSON.stringify(botIntent(edit(shop(12), (d) => { d.rng = i * 17; }), 0)));
  }
  assert.ok([...rich].some((x) => JSON.parse(x).item), 'rich bot buys sometimes');
  assert.deepEqual([...poor], [JSON.stringify({ type: 'buyItem', item: null })]);   // 12 - 6 < 10 (star price)
});

test('botIntent: uses items sometimes and only legally (trap spot, steal target, doubleDice once)', () => {
  const base = edit(started(3), (d) => { d.players[0].items = ['trap', 'steal', 'doubleDice', 'goldenDoener']; d.players[1].coins = 20; d.players[1].spaceId = 's3'; d.players[2].spaceId = 's4'; });
  const kinds = new Set();
  for (let i = 0; i < 200; i++) {
    const s = edit(base, (d) => { d.rng = i * 7717; });
    const intent = botIntent(s, 0);
    kinds.add(intent.type === 'useItem' ? intent.item : 'roll');
    const r = applyIntent(s, 0, intent);
    assert.equal(r.error, null, JSON.stringify(intent));
    if (intent.item === 'steal') assert.equal(intent.targetSeat, 1);   // the richest
  }
  assert.deepEqual([...kinds].sort(), ['doubleDice', 'goldenDoener', 'roll', 'steal', 'trap']);
  const armed = edit(base, (d) => { d.turn.doubleDice = true; d.players[0].items = ['doubleDice']; });
  for (let i = 0; i < 50; i++) assert.deepEqual(botIntent(edit(armed, (d) => { d.rng = i; }), 0), { type: 'roll' });
});

test('botIntent: ready in the intro, and an absent seat\'s turn is playable', () => {
  let s = started(3);
  s = run(s, HOST_SEAT, { type: 'seatPresence', seat: 0, connected: false }).state;   // seat 0 (to roll) is absent
  const i = botIntent(s, 0);
  assert.deepEqual(i, { type: 'roll' });
  assert.equal(applyIntent(s, 0, i).error, null);
  // drive seat 0..2 to the intro with bots only
  let g = started(3);
  while (g.phase === 'boardTurn') g = run(g, g.turn.seat, botIntent(g, g.turn.seat)).state;
  assert.equal(g.phase, 'minigameIntro');
  assert.deepEqual(botIntent(g, 1), { type: 'ready' });
  const g2 = run(g, 1, { type: 'ready' }).state;
  assert.equal(botIntent(g2, 1), null);
  const outsider = edit(g, (d) => { d.minigame.seats = [0, 1]; });
  assert.equal(botIntent(outsider, 2), null);
});

/** drives a whole game the way the host driver would: bots for every decision, random minigame results */
function playBotGame({ players, starTarget, seed, maxIntents = 20000 }) {
  registerBoard(makeBoard());
  let s = lobby(players, { starTarget, seed });
  s = run(s, 0, { type: 'startGame' }).state;
  const rng = createRng(seed ^ 0xabcdef);
  let intents = 0, duels = 0;
  while (s.phase !== 'victory') {
    assert.ok(++intents < maxIntents, `no victory within ${maxIntents} intents (round ${s.round})`);
    deepFreeze(s);   // applyIntent must never mutate
    let actor, intent;
    if (s.phase === 'boardTurn') { actor = s.turn.seat; intent = botIntent(s, actor); }
    else if (s.phase === 'minigameIntro') {
      const seat = s.minigame.seats.find((x) => !s.minigame.ready.includes(x));
      if (seat === undefined) throw new Error('intro without pending ready');
      actor = seat; intent = botIntent(s, seat);
    } else if (s.phase === 'minigame') {
      actor = HOST_SEAT;
      const seats = rng.shuffle(s.minigame.seats);
      let placements;
      if (s.minigame.mode === 'team') placements = rng.next() < 0.2 ? [seats] : [s.minigame.teams[0], s.minigame.teams[1]].sort(() => rng.next() - 0.5);
      else if (rng.next() < 0.2) placements = [seats.slice(0, 2), ...seats.slice(2).map((x) => [x])];   // a tie for the lead
      else placements = seats.map((x) => [x]);
      intent = { type: 'minigameDone', results: { placements } };
      if (s.minigame.purpose === 'duel') duels++;
    } else { actor = HOST_SEAT; intent = { type: 'advance' }; }
    assert.ok(intent, `no intent in phase ${s.phase}`);
    const r = applyIntent(s, actor, intent);
    assert.equal(r.error, null, `${JSON.stringify(intent)} by ${actor} in ${s.phase}/${s.turn?.step}`);
    for (const p of r.state.players) {
      assert.ok(p.coins >= 0 && p.items.length <= MAX_ITEMS && p.stars >= 0);
    }
    s = r.state;
  }
  return { s, intents, duels };
}

test('full bot game: 3 players to 2 stars ends in victory within a bounded number of intents', () => {
  const stats = [];
  for (let seed = 1; seed <= 12; seed++) {
    const { s, intents, duels } = playBotGame({ players: 3, starTarget: 2, seed });
    assert.equal(s.phase, 'victory');
    assert.ok(s.players[s.winner].stars >= 2);
    assert.ok(intents < 5000);
    stats.push({ intents, rounds: s.round, duels });
  }
  if (process.env.CORE_STATS) console.log(JSON.stringify(stats));
});

test('full bot game is deterministic', () => {
  const a = playBotGame({ players: 3, starTarget: 2, seed: 4 });
  const b = playBotGame({ players: 3, starTarget: 2, seed: 4 });
  assert.equal(JSON.stringify(a.s), JSON.stringify(b.s));
});

test('full bot game: 4 players to the default 9 stars terminates', () => {
  const { s } = playBotGame({ players: 4, starTarget: 9, seed: 77, maxIntents: 60000 });
  assert.equal(s.phase, 'victory');
  assert.ok(s.endspurt);
  if (process.env.CORE_STATS) console.log('4p/9 stars rounds', s.round);
});
