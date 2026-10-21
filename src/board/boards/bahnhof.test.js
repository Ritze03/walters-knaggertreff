import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBoard, createRng, HOST_SEAT, PLAYER_COLORS, MAX_ITEMS } from '../../contracts.js';
import { createGame, applyIntent, botIntent, registerBoard } from '../../core/index.js';
import bahnhof, { TRACK_IDS } from './bahnhof.js';

const profile = (i) => ({ playerId: `p${i}`, name: `Spieler${i}`, color: PLAYER_COLORS[i], hat: 'none' });
const count = (type) => bahnhof.spaces.filter((s) => s.type === type).length;
const byId = new Map(bahnhof.spaces.map((s) => [s.id, s]));

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
}

/** minimal GameState per contracts section 4 (only what the handlers may read) */
function fakeState(n, over = {}) {
  return {
    phase: 'boardTurn', round: 3, rules: { starPrice: 10 }, settings: { starTarget: 5, boardId: 'bahnhof' },
    seats: Array.from({ length: n }, (_, i) => ({ index: i, profile: profile(i), connected: true })),
    players: Array.from({ length: n }, () => ({ coins: 8, stars: 0, items: [], spaceId: 'b00', mgWins: 0, skipTurns: 0 })),
    traps: {}, starSpaceId: 'b04', endspurt: false, ...over,
  };
}

test('layout: validateBoard is clean and the numbers match the design', () => {
  assert.deepEqual(validateBoard(bahnhof), []);
  assert.equal(bahnhof.id, 'bahnhof');
  assert.ok(bahnhof.spaces.length >= 36 && bahnhof.spaces.length <= 44, `${bahnhof.spaces.length} spaces`);
  assert.equal(count('start'), 1);
  assert.equal(count('shop'), 2);
  assert.ok(count('event') >= 5 && count('event') <= 7);
  const red = count('red') / bahnhof.spaces.length;
  assert.ok(red > 0.15 && red < 0.25, `red share ${red}`);
  assert.ok(bahnhof.starSpaceIds.length >= 4 && bahnhof.starSpaceIds.length <= 6);
  assert.equal(bahnhof.spaces.filter((s) => s.next.length > 1).length, 2, 'two forks');
  for (const s of bahnhof.spaces) { assert.ok(s.x >= 0 && s.x <= bahnhof.world.w && s.y >= 0 && s.y <= bahnhof.world.h, `${s.id} inside world`); }
});

test('event handlers: valid results, pure, deterministic', () => {
  for (const [eventId, handler] of Object.entries(bahnhof.events)) {
    for (const seed of [1, 2, 3, 42, 777, 90210]) {
      for (const seat of [0, 1, 2]) {
        for (const variant of ['plain', 'rich', 'full', 'broke', 'gleisfeld']) {
          const state = fakeState(3);
          if (variant === 'rich') state.players[seat].coins = 30;
          if (variant === 'full') state.players[seat].items = ['trap', 'trap', 'trap'].slice(0, MAX_ITEMS);
          if (variant === 'broke') state.players[seat].coins = 0;
          if (variant === 'gleisfeld') { state.players[seat].spaceId = 'g2'; state.players[(seat + 1) % 3].spaceId = 'g4'; }
          deepFreeze(state);
          const before = JSON.stringify(state);
          const a = handler({ state, seat, rng: createRng(seed), board: bahnhof });
          const b = handler({ state, seat, rng: createRng(seed), board: bahnhof });
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

test('zugfaelltaus sends everyone on the tracks (and only them) back to the start', () => {
  const state = fakeState(4);
  state.players[0].spaceId = 'g2';
  state.players[1].spaceId = 'g4';
  state.players[2].spaceId = 'b06';
  state.players[3].spaceId = 'g1';
  const r = bahnhof.events.zugfaelltaus({ state, seat: 0, rng: createRng(1), board: bahnhof });
  assert.deepEqual(r.effects.map((e) => e.seat).sort(), [0, 1, 3]);
  assert.ok(r.effects.every((e) => e.type === 'moveTo' && e.spaceId === 'b00'));
  assert.equal(r.lineId, 'zugFaelltAus');
  // landing on the platform Anzeigetafel punishes the Gleisfeld crowd, not the lander
  const s2 = fakeState(3);
  s2.players[0].spaceId = 'b22'; s2.players[1].spaceId = 'g3';
  assert.deepEqual(bahnhof.events.zugfaelltaus({ state: s2, seat: 0, rng: createRng(1), board: bahnhof }).effects, [{ type: 'moveTo', seat: 1, spaceId: 'b00' }]);
  // nobody on the tracks: no effects
  assert.deepEqual(bahnhof.events.zugfaelltaus({ state: fakeState(3), seat: 0, rng: createRng(1), board: bahnhof }).effects, []);
});

test('the tracks are the Gleisfeld detour, all sitting on one branch of the first fork', () => {
  const g1 = byId.get('g1');
  assert.ok(byId.get('b05').next.includes('g1'));
  for (const id of TRACK_IDS) assert.ok(byId.has(id) && id.startsWith('g'));
  assert.ok(bahnhof.starSpaceIds.some((id) => TRACK_IDS.includes(id)), 'a star spot lures players onto the tracks');
  assert.ok(bahnhof.spaces.some((s) => s.eventId === 'zugfaelltaus' && TRACK_IDS.includes(s.id)));
  assert.equal(g1.type, 'blue');
});

test('schienenersatz teleports the lander to a random valid space', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const state = fakeState(3);
    state.players[1].spaceId = 'b12';
    const r = bahnhof.events.schienenersatz({ state, seat: 1, rng: createRng(seed), board: bahnhof });
    assert.equal(r.effects.length, 1);
    const [e] = r.effects;
    assert.equal(e.type, 'moveTo');
    assert.equal(e.seat, 1);
    const target = byId.get(e.spaceId);
    assert.ok(target && target.type !== 'start' && target.type !== 'shop' && !TRACK_IDS.includes(target.id) && target.id !== 'b12');
    assert.equal(r.lineId, 'schienenersatz');
    seen.add(e.spaceId);
  }
  assert.ok(seen.size >= 10, `the bus goes all over the place (${seen.size} different stops)`);
});

test('gleiswechsel swaps places with another player, or fizzles when alone', () => {
  const state = fakeState(3);
  state.players[0].spaceId = 't3'; state.players[1].spaceId = 'b10'; state.players[2].spaceId = 'b10';
  const r = bahnhof.events.gleiswechsel({ state, seat: 0, rng: createRng(5), board: bahnhof });
  assert.equal(r.effects.length, 2);
  const [a, b] = r.effects;
  assert.deepEqual([a.seat, a.spaceId], [0, 'b10']);
  assert.ok([1, 2].includes(b.seat));
  assert.equal(b.spaceId, 't3');
  const alone = fakeState(1);
  alone.players[0].spaceId = 't3';
  assert.deepEqual(bahnhof.events.gleiswechsel({ state: alone, seat: 0, rng: createRng(5), board: bahnhof }).effects, []);
});

test('kontrolle fines 5, but not a broke player', () => {
  const s = fakeState(2);
  assert.deepEqual(bahnhof.events.kontrolle({ state: s, seat: 1, rng: createRng(1), board: bahnhof }).effects, [{ type: 'coins', seat: 1, delta: -5 }]);
  s.players[1].coins = 0;
  assert.deepEqual(bahnhof.events.kontrolle({ state: s, seat: 1, rng: createRng(1), board: bahnhof }).effects, []);
});

test('verspaetung has all three outcomes: Fahrgastrechte, Kaffee, Weichenstörung', () => {
  const kinds = new Set();
  for (let seed = 1; seed <= 80; seed++) {
    const e = bahnhof.events.verspaetung({ state: fakeState(2), seat: 0, rng: createRng(seed), board: bahnhof }).effects[0];
    kinds.add(e.type === 'skipTurns' ? 'skip' : e.delta > 0 ? 'gain' : 'loss');
  }
  assert.deepEqual([...kinds].sort(), ['gain', 'loss', 'skip']);
});

// ---- bot-driven full games on the real board ---------------------------------------------------------------------

function simulate(seed, nPlayers, stars) {
  registerBoard(bahnhof);
  let s = createGame({ gameId: 'sim', hostPlayerId: 'p0', hostProfile: profile(0), seed, starTarget: stars, boardId: 'bahnhof' });
  const step = (actor, intent) => {
    const r = applyIntent(s, actor, intent);
    assert.equal(r.error, null, `${JSON.stringify(intent)} -> ${r.error}`);
    s = r.state;
    return r.events;
  };
  for (let i = 1; i < nPlayers; i++) step(HOST_SEAT, { type: 'seatJoin', playerId: `p${i}`, profile: profile(i), isBot: true });
  for (let i = 1; i < nPlayers; i++) step(i, { type: 'setReady', ready: true });
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

test('bot-driven games on DB Hauptbahnhof terminate (4 players, 3 stars)', () => {
  const rounds = [];
  const seen = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const r = simulate(seed, 4, 3);
    rounds.push(r.rounds);
    r.seen.forEach((x) => seen.add(x));
  }
  const avg = rounds.reduce((a, b) => a + b, 0) / rounds.length;
  console.log(`# balance: DB Hauptbahnhof, 4 players, 3 stars: avg ${avg.toFixed(1)} rounds (min ${Math.min(...rounds)}, max ${Math.max(...rounds)}) over ${rounds.length} games`);
  // gleiswechsel only sits in the Reisezentrum (an optional detour the bots rarely take); the unit test above covers it
  const reachable = new Set(bahnhof.spaces.filter((s) => s.eventId && !s.id.startsWith('t')).map((s) => s.eventId));
  for (const id of reachable) assert.ok(seen.has(`event:${id}`), `event ${id} was triggered at least once in 30 games`);
  assert.ok(avg > 2 && avg < 60);
});

test('2 and 6 player games terminate too', () => {
  for (const n of [2, 6]) assert.ok(simulate(5 + n, n, 3).rounds > 0);
});
