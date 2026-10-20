import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBoard, createRng, HOST_SEAT, PLAYER_COLORS, MAX_ITEMS } from '../../contracts.js';
import { createGame, applyIntent, botIntent, registerBoard } from '../../core/index.js';
import spaeti from './spaeti.js';

const profile = (i) => ({ playerId: `p${i}`, name: `Spieler${i}`, color: PLAYER_COLORS[i], hat: 'none' });
const count = (type) => spaeti.spaces.filter((s) => s.type === type).length;
const byId = new Map(spaeti.spaces.map((s) => [s.id, s]));

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
}

/** minimal GameState per contracts section 4 (only what the handlers may read) */
function fakeState(n, over = {}) {
  return {
    phase: 'boardTurn', round: 3, rules: { starPrice: 10 }, settings: { starTarget: 5, boardId: 'spaeti' },
    seats: Array.from({ length: n }, (_, i) => ({ index: i, profile: profile(i), connected: true })),
    players: Array.from({ length: n }, () => ({ coins: 8, stars: 0, items: [], spaceId: 's00', mgWins: 0, skipTurns: 0 })),
    traps: {}, starSpaceId: 's04', endspurt: false, ...over,
  };
}

test('layout: validateBoard is clean and the numbers match the design', () => {
  assert.deepEqual(validateBoard(spaeti), []);
  assert.equal(spaeti.id, 'spaeti');
  assert.ok(spaeti.spaces.length >= 36 && spaeti.spaces.length <= 44, `${spaeti.spaces.length} spaces`);
  assert.equal(count('start'), 1);
  assert.equal(count('shop'), 2);
  assert.ok(count('event') >= 5 && count('event') <= 7);
  const red = count('red') / spaeti.spaces.length;
  assert.ok(red > 0.15 && red < 0.25, `red share ${red}`);
  assert.ok(spaeti.starSpaceIds.length >= 4 && spaeti.starSpaceIds.length <= 6);
  assert.equal(spaeti.spaces.filter((s) => s.next.length > 1).length, 2, 'two forks');
  for (const s of spaeti.spaces) { assert.ok(s.x >= 0 && s.x <= spaeti.world.w && s.y >= 0 && s.y <= spaeti.world.h, `${s.id} inside world`); }
});

test('event handlers: valid results, pure, deterministic', () => {
  for (const [eventId, handler] of Object.entries(spaeti.events)) {
    for (const seed of [1, 2, 3, 42, 777, 90210]) {
      for (const seat of [0, 1, 2]) {
        for (const variant of ['plain', 'rich', 'full', 'broke', 'hinterhof']) {
          const state = fakeState(3);
          if (variant === 'rich') state.players[seat].coins = 30;
          if (variant === 'full') state.players[seat].items = ['trap', 'trap', 'trap'].slice(0, MAX_ITEMS);
          if (variant === 'broke') state.players[seat].coins = 0;
          if (variant === 'hinterhof') { state.players[seat].spaceId = 'h2'; state.players[(seat + 1) % 3].spaceId = 'h4'; }
          deepFreeze(state);
          const before = JSON.stringify(state);
          const a = handler({ state, seat, rng: createRng(seed), board: spaeti });
          const b = handler({ state, seat, rng: createRng(seed), board: spaeti });
          assert.deepEqual(a, b, `${eventId} deterministic`);
          assert.equal(JSON.stringify(state), before, `${eventId} must not mutate state`);
          assert.equal(typeof a.banner, 'string');
          assert.ok(a.banner.length > 5);
          assert.ok(Array.isArray(a.effects));
          for (const e of a.effects) {
            assert.ok(['coins', 'stars', 'moveTo', 'giveItem', 'skipTurns'].includes(e.type), `${eventId}: effect ${e.type}`);
            assert.ok(Number.isInteger(e.seat) && e.seat >= 0 && e.seat < 3);
            if (e.type === 'moveTo') assert.ok(byId.has(e.spaceId));
            if (e.type === 'coins') assert.ok(Number.isInteger(e.delta));
          }
          if (variant === 'full') assert.ok(!a.effects.some((e) => e.type === 'giveItem'), `${eventId}: no giveItem when full`);
        }
      }
    }
  }
});

test('müllabfuhr sends everyone in the Hinterhof (and only them) back to start', () => {
  const state = fakeState(4);
  state.players[0].spaceId = 'h2';
  state.players[1].spaceId = 'h4';
  state.players[2].spaceId = 's06';
  state.players[3].spaceId = 'h1';
  const r = spaeti.events.muellabfuhr({ state, seat: 0, rng: createRng(1), board: spaeti });
  assert.deepEqual(r.effects.map((e) => e.seat).sort(), [0, 1, 3]);
  assert.ok(r.effects.every((e) => e.type === 'moveTo' && e.spaceId === 's00'));
});

test('ordnungsamt fines 5, but not a broke player', () => {
  const s = fakeState(2);
  assert.deepEqual(spaeti.events.ordnungsamt({ state: s, seat: 1, rng: createRng(1), board: spaeti }).effects, [{ type: 'coins', seat: 1, delta: -5 }]);
  s.players[1].coins = 0;
  assert.deepEqual(spaeti.events.ordnungsamt({ state: s, seat: 1, rng: createRng(1), board: spaeti }).effects, []);
});

// ---- bot-driven full games on the real board ---------------------------------------------------------------------

function simulate(seed, nPlayers, stars) {
  registerBoard(spaeti);
  let s = createGame({ gameId: 'sim', hostPlayerId: 'p0', hostProfile: profile(0), seed, starTarget: stars, boardId: 'spaeti' });
  const step = (actor, intent) => {
    const r = applyIntent(s, actor, intent);
    assert.equal(r.error, null, `${JSON.stringify(intent)} -> ${r.error}`);
    s = r.state;
    return r.events;
  };
  for (let i = 1; i < nPlayers; i++) step(HOST_SEAT, { type: 'seatJoin', playerId: `p${i}`, profile: profile(i), isBot: true });
  step(0, { type: 'startGame' });
  const rng = createRng(seed ^ 0xabcdef);
  const seen = new Set();
  let events = 0;
  for (let guard = 0; guard < 20000 && s.phase !== 'victory'; guard++) {
    if (s.phase === 'boardTurn') {
      const intent = botIntent(s, s.turn.seat);
      assert.ok(intent, 'bot has something to do on its turn');
      for (const e of step(s.turn.seat, intent)) { events++; seen.add(e.type); if (e.type === 'eventSpace') seen.add(`event:${e.eventId}`); }
    } else if (s.phase === 'minigameIntro') step(HOST_SEAT, { type: 'advance' });
    else if (s.phase === 'minigame') step(HOST_SEAT, { type: 'minigameDone', results: { placements: rng.shuffle(s.minigame.seats).map((x) => [x]) } });
    else if (s.phase === 'minigameResults') step(HOST_SEAT, { type: 'advance' });
    else assert.fail(`unexpected phase ${s.phase}`);
  }
  assert.equal(s.phase, 'victory', `game ${seed} must terminate`);
  return { rounds: s.round, seen, events };
}

test('bot-driven games on Späti-Kiez terminate (4 players, 3 stars)', () => {
  const rounds = [];
  const seen = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const r = simulate(seed, 4, 3);
    rounds.push(r.rounds);
    r.seen.forEach((x) => seen.add(x));
  }
  const avg = rounds.reduce((a, b) => a + b, 0) / rounds.length;
  console.log(`# balance: Spaeti-Kiez, 4 players, 3 stars: avg ${avg.toFixed(1)} rounds (min ${Math.min(...rounds)}, max ${Math.max(...rounds)}) over ${rounds.length} games`);
  for (const id of Object.keys(spaeti.events)) assert.ok(seen.has(`event:${id}`), `event ${id} was triggered at least once in 30 games`);
  assert.ok(avg > 2 && avg < 60);
});

test('2 and 6 player games terminate too', () => {
  for (const n of [2, 6]) assert.ok(simulate(5 + n, n, 3).rounds > 0);
});
