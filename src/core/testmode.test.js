import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOST_SEAT, MAX_PLAYERS, ERR, MINIGAMES } from '../contracts.js';
import { applyIntent, serialize, deserialize, resumeGame } from './index.js';
import { lobby, run, edit, types, startAll } from './fixtures.js';

const testLobby = (n = 1, o = {}) => run(lobby(n, o), 0, { type: 'setTestMode', on: true }).state;
const withBots = (s, count) => run(s, 0, { type: 'addBot', count }).state;
const err = (s, actor, intent) => applyIntent(s, actor, intent).error;
const botSeats = (s) => s.seats.filter((x) => x.hostBot).map((x) => x.index);

test('setTestMode: host only, lobby only, validated, idempotent', () => {
  const s = lobby(2);
  assert.equal(s.settings.testMode, false);
  assert.equal(err(s, 1, { type: 'setTestMode', on: true }), ERR.forbidden);
  assert.equal(err(s, 0, { type: 'setTestMode', on: 'yes' }), ERR.invalid);
  const on = run(s, 0, { type: 'setTestMode', on: true });
  assert.equal(on.state.settings.testMode, true);
  const again = applyIntent(on.state, 0, { type: 'setTestMode', on: true });
  assert.equal(again.state, on.state);   // no-op: same object
  assert.equal(err(startAll(lobby(2)).state, 0, { type: 'setTestMode', on: true }), ERR.wrongPhase);
});

test('startGame is refused while test mode is on (the picker is not a match)', () => {
  const s = testLobby(2);
  const ready = run(s, 1, { type: 'setReady', ready: true }).state;
  assert.equal(err(ready, 0, { type: 'startGame' }), ERR.invalid);
});

test('addBot / removeBot: host-run bot seats, ready, unique names + colours, capped at MAX_PLAYERS', () => {
  let s = testLobby(1);
  const r = run(s, 0, { type: 'addBot', count: 3 });
  s = r.state;
  assert.deepEqual(types(r.events), ['seatJoined', 'seatJoined', 'seatJoined']);
  assert.equal(s.seats.length, 4);
  assert.deepEqual(botSeats(s), [1, 2, 3]);
  assert.equal(s.players.length, 4);
  for (const i of [1, 2, 3]) {
    assert.deepEqual([s.seats[i].isBot, s.seats[i].connected, s.seats[i].ready, s.seats[i].isHost], [true, true, true, false]);
    assert.match(s.seats[i].playerId, /^bot-/);
  }
  assert.equal(new Set(s.seats.map((x) => x.profile.name)).size, 4);
  assert.equal(new Set(s.seats.map((x) => x.profile.color)).size, 4);
  // remove a bot in the middle: indices re-packed, the next name fills the gap
  s = run(s, 0, { type: 'removeBot', seat: 2 }).state;
  assert.deepEqual(s.seats.map((x) => x.index), [0, 1, 2]);
  assert.equal(s.players.length, 3);
  s = run(s, 0, { type: 'addBot' }).state;
  assert.equal(new Set(s.seats.map((x) => x.profile.name)).size, 4);
  // cap
  s = run(s, 0, { type: 'addBot', count: 99 }).state;
  assert.equal(s.seats.length, MAX_PLAYERS);
  assert.equal(err(s, 0, { type: 'addBot' }), ERR.full);
});

test('addBot / removeBot guards: test mode, host, human seats', () => {
  const plain = lobby(2);
  assert.equal(err(plain, 0, { type: 'addBot' }), ERR.invalid);   // test mode off
  const s = withBots(testLobby(2), 1);
  assert.equal(err(s, 1, { type: 'addBot' }), ERR.forbidden);
  assert.equal(err(s, 0, { type: 'addBot', count: 0 }), ERR.invalid);
  assert.equal(err(s, 0, { type: 'removeBot', seat: 1 }), ERR.invalid);   // a human
  assert.equal(err(s, 0, { type: 'removeBot', seat: 0 }), ERR.invalid);   // the host
  assert.equal(err(s, 0, { type: 'removeBot', seat: 9 }), ERR.invalid);
  assert.equal(err(s, 1, { type: 'removeBot', seat: 2 }), ERR.forbidden);
});

test('leaving test mode removes the host-run bots, humans stay', () => {
  let s = withBots(testLobby(2), 2);
  assert.equal(s.seats.length, 4);
  s = run(s, 0, { type: 'setTestMode', on: false }).state;
  assert.equal(s.settings.testMode, false);
  assert.deepEqual(s.seats.map((x) => x.playerId), ['p0', 'p1']);
  assert.equal(s.players.length, 2);
  assert.equal(err(s, 0, { type: 'addBot' }), ERR.invalid);
});

test('testMinigame: arena game with host + bots goes straight to the intro, bots pre-ready, no board state touched', () => {
  const s = withBots(testLobby(1), 3);
  const r = run(s, 0, { type: 'testMinigame', id: 'aura' });
  const st = r.state;
  assert.equal(st.phase, 'minigameIntro');
  assert.deepEqual(types(r.events), ['minigameStart']);
  assert.equal(st.minigame.id, 'aura');
  assert.equal(st.minigame.mode, 'ffa');
  assert.deepEqual(st.minigame.seats, [0, 1, 2, 3]);
  assert.deepEqual(st.minigame.ready, [1, 2, 3]);
  assert.equal(st.settings.testLast, 'aura');
  assert.deepEqual([st.round, st.mgHistory, st.turn, st.turnOrder], [0, [], null, []]);
  // the human readies -> minigame
  assert.equal(run(st, 0, { type: 'ready' }).state.phase, 'minigame');
});

test('testMinigame: guards (host, test mode, id, pool, player count, team parity)', () => {
  const s = withBots(testLobby(1), 1);
  assert.equal(err(s, 1, { type: 'testMinigame', id: 'aura' }), ERR.forbidden);
  assert.equal(err(s, 0, { type: 'testMinigame', id: 'nope' }), ERR.invalid);
  assert.equal(err(s, 0, { type: 'testMinigame' }), ERR.invalid);
  assert.equal(err(lobby(2), 0, { type: 'testMinigame', id: 'aura' }), ERR.invalid);   // test mode off
  assert.equal(err(testLobby(1), 0, { type: 'testMinigame', id: 'aura' }), ERR.tooFewPlayers);   // alone
  const pooled = testLobby(2, { availableMinigames: ['forza'] });
  assert.equal(err(pooled, 0, { type: 'testMinigame', id: 'aura' }), ERR.invalid);
  assert.equal(applyIntent(pooled, 0, { type: 'testMinigame', id: 'forza' }).error, null);
  // team games: even count >= 4 only (isTeamGameAllowed)
  const team = Object.keys(MINIGAMES).find((id) => MINIGAMES[id].kind === 'team');
  for (const n of [2, 3, 5]) assert.equal(err(withBots(testLobby(1), n - 1), 0, { type: 'testMinigame', id: team }), ERR.playerCount, `${team} with ${n}`);
  for (const n of [4, 6]) {
    const t = run(withBots(testLobby(1), n - 1), 0, { type: 'testMinigame', id: team }).state;
    assert.equal(t.minigame.mode, 'team');
    assert.deepEqual(t.minigame.teams.map((x) => x.length), [n / 2, n / 2]);
  }
  // every registered game has some player count that works
  for (const id of Object.keys(MINIGAMES)) {
    const ok = [2, 3, 4, 5, 6].filter((n) => !applyIntent(withBots(testLobby(1), n - 1), 0, { type: 'testMinigame', id }).error);
    assert.ok(ok.length > 0, id);
  }
});

test('test run: placements are reported, but no coins, stars, mgWins, log or history change', () => {
  let s = withBots(testLobby(1), 3);
  s = run(s, 0, { type: 'testMinigame', id: 'pfand' }).state;
  s = run(s, 0, { type: 'ready' }).state;
  const before = structuredClone({ players: s.players, log: s.log, round: s.round, mgHistory: s.mgHistory });
  const r = run(s, HOST_SEAT, { type: 'minigameDone', results: { placements: [[2], [0, 1], [3]], labels: { 2: '12' } } });
  assert.equal(r.state.phase, 'minigameResults');
  assert.deepEqual(r.state.minigame.results.placements, [[2], [0, 1], [3]]);
  assert.deepEqual(r.state.minigame.coinDelta, { 0: 0, 1: 0, 2: 0, 3: 0 });
  assert.deepEqual(types(r.events), ['minigameResults']);
  assert.deepEqual(r.state.players, before.players);
  assert.deepEqual(r.state.log, before.log);
  assert.deepEqual([r.state.round, r.state.mgHistory], [before.round, before.mgHistory]);
});

test('advance after the results returns to the picker (lobby, test mode on, bots kept); the same game can start again', () => {
  let s = withBots(testLobby(1), 3);
  s = run(s, 0, { type: 'testMinigame', id: 'aura' }).state;
  s = run(s, HOST_SEAT, { type: 'advance' }).state;   // intro timeout
  assert.equal(s.phase, 'minigame');
  s = run(s, HOST_SEAT, { type: 'minigameDone', results: { placements: [[1], [0], [2], [3]] } }).state;
  s = run(s, HOST_SEAT, { type: 'advance' }).state;
  assert.equal(s.phase, 'lobby');
  assert.equal(s.minigame, null);
  assert.equal(s.settings.testMode, true);
  assert.equal(s.settings.testLast, 'aura');
  assert.equal(s.seats.length, 4);
  const again = run(s, 0, { type: 'testMinigame', id: 'aura' }).state;
  assert.equal(again.phase, 'minigameIntro');
  // another game with the same crowd
  assert.equal(run(s, 0, { type: 'testMinigame', id: 'pfand' }).state.minigame.id, 'pfand');
});

test('a seat that dropped during a test run is gone when the picker comes back', () => {
  let s = run(testLobby(3), 0, { type: 'testMinigame', id: 'forza' }).state;
  s = run(s, HOST_SEAT, { type: 'seatPresence', seat: 2, connected: false }).state;
  s = run(s, 0, { type: 'ready' }).state;
  s = run(s, 1, { type: 'ready' }).state;
  assert.equal(s.phase, 'minigame');
  s = run(s, HOST_SEAT, { type: 'minigameDone', results: { placements: [[0], [1]] } }).state;
  s = run(s, HOST_SEAT, { type: 'advance' }).state;
  assert.deepEqual(s.seats.map((x) => x.playerId), ['p0', 'p1']);
  assert.equal(s.players.length, 2);
});

test('a normal match is untouched: coins and mgWins still move when test mode is off', () => {
  let s = run(lobby(2), 0, { type: 'setTestMode', on: true }).state;
  s = run(s, 0, { type: 'setTestMode', on: false }).state;
  s = startAll(s).state;
  assert.equal(s.settings.testMode, false);
  s = edit(s, (d) => {
    d.phase = 'minigame'; d.turn = null;
    d.minigame = { id: 'forza', kind: 'solo', mode: 'ffa', purpose: 'round', seats: [0, 1], teams: null, seed: 1, ready: [0, 1], results: null, coinDelta: null };
  });
  const coins = s.players.map((p) => p.coins);
  const r = run(s, HOST_SEAT, { type: 'minigameDone', results: { placements: [[1], [0]] } });
  assert.notDeepEqual(r.state.players.map((p) => p.coins), coins);
  assert.equal(r.state.players[1].mgWins, 1);
});

test('resumeGame in test mode: a running test minigame resumes as the picker, bots and absent humans dropped', () => {
  let s = withBots(testLobby(2), 2);
  s = run(s, 0, { type: 'testMinigame', id: 'aura' }).state;
  const back = resumeGame(s, 'p0');
  assert.equal(back.phase, 'lobby');
  assert.equal(back.minigame, null);
  assert.equal(back.settings.testMode, true);
  assert.deepEqual(back.seats.map((x) => x.playerId), ['p0']);
  assert.equal(deserialize(serialize(s)).settings.testMode, true);
});

test('createGame defaults: test mode off, no bot flags', () => {
  const s = lobby(1);
  assert.deepEqual([s.settings.testMode, s.settings.testLast], [false, null]);
  assert.equal(s.seats[0].hostBot, false);
});
