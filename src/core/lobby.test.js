import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOST_SEAT, PLAYER_COLORS, STAR_TARGET, STATE_VERSION, MAX_PLAYERS } from '../contracts.js';
import { createGame, applyIntent, serialize, deserialize, resumeGame, getBoard, registerBoard } from './index.js';
import { RULES_FOR_STATE } from './rules.js';
import { lobby, started, profile, run, edit, deepFreeze, types, makeBoard, registerFixture } from './test-fixtures.js';

test('createGame: lobby, host seat 0, rules copied, defaults', () => {
  const s = createGame({ gameId: 'g', hostPlayerId: 'p0', hostProfile: profile(0), seed: 5 });
  assert.equal(s.version, STATE_VERSION);
  assert.equal(s.phase, 'lobby');
  assert.equal(s.rev, 0);
  assert.equal(s.round, 0);
  assert.equal(s.turn, null);
  assert.equal(s.seats.length, 1);
  assert.deepEqual([s.seats[0].index, s.seats[0].isHost, s.seats[0].connected], [0, true, true]);
  assert.equal(s.settings.starTarget, STAR_TARGET.default);
  assert.equal(s.settings.boardId, 'spaeti');
  assert.equal(s.settings.forceMinigame, null);
  assert.deepEqual(s.rules, RULES_FOR_STATE);
  assert.equal(s.rules.starPrice, 10);
  assert.equal(s.rng, 5);
  JSON.parse(JSON.stringify(s));
});

test('createGame: ?stars bypasses the max, ?mg validated', () => {
  const s = createGame({ gameId: 'g', hostPlayerId: 'p0', hostProfile: profile(0), seed: 1, starTarget: 30, forceMinigame: 'forza' });
  assert.equal(s.settings.starTarget, 30);
  assert.equal(s.settings.forceMinigame, 'forza');
  const bad = createGame({ gameId: 'g', hostPlayerId: 'p0', hostProfile: profile(0), seed: 1, starTarget: 0, forceMinigame: 'nope' });
  assert.equal(bad.settings.starTarget, STAR_TARGET.default);
  assert.equal(bad.settings.forceMinigame, null);
});

test('registerBoard validates, getBoard returns', () => {
  assert.throws(() => registerBoard({ id: 'spaeti', name: 'x', spaces: [] }), /invalid board/);
  registerFixture();
  assert.equal(getBoard('spaeti').name, 'Testboard');
  assert.throws(() => getBoard('nowhere'), /not registered/);
});

test('seatJoin: new seat in lobby with unique colour; rejoin keeps seat', () => {
  let s = lobby(2);
  assert.equal(s.seats.length, 2);
  // same colour as host requested -> gets another
  const r = run(s, HOST_SEAT, { type: 'seatJoin', playerId: 'px', profile: { ...profile(5), color: s.seats[0].profile.color }, isBot: true });
  assert.deepEqual(r.events, [{ type: 'seatJoined', seat: 2, rejoin: false }]);
  s = r.state;
  assert.notEqual(s.seats[2].profile.color, s.seats[0].profile.color);
  assert.equal(new Set(s.seats.map((x) => x.profile.color)).size, 3);
  assert.equal(s.seats[2].isBot, true);
  // rejoin of a known playerId
  const again = run(s, HOST_SEAT, { type: 'seatJoin', playerId: 'p1', profile: { ...profile(1), name: 'Neu' }, isBot: false });
  assert.deepEqual(again.events, [{ type: 'seatJoined', seat: 1, rejoin: true }]);
  assert.equal(again.state.seats.length, 3);
  assert.equal(again.state.seats[1].profile.name, 'Neu');
});

test('seatJoin: lobby full -> full, running game -> started', () => {
  let s = lobby(MAX_PLAYERS);
  let r = applyIntent(s, HOST_SEAT, { type: 'seatJoin', playerId: 'late', profile: profile(0), isBot: false });
  assert.equal(r.error, 'full');
  assert.equal(r.state, s);
  assert.deepEqual(r.events, []);
  s = started(3);
  r = applyIntent(s, HOST_SEAT, { type: 'seatJoin', playerId: 'late', profile: profile(0), isBot: false });
  assert.equal(r.error, 'started');
});

test('setProfile: trims, clamps, colour stays unique, lobby only', () => {
  let s = lobby(3);
  s = run(s, 1, { type: 'setProfile', profile: { name: '  Wirklich Langer Name Hier  ', hat: 'crown' } }).state;
  assert.equal(s.seats[1].profile.name, 'Wirklich Langer');
  assert.ok(s.seats[1].profile.name.length <= 16);
  assert.equal(s.seats[1].profile.hat, 'crown');
  const hostColor = s.seats[0].profile.color;
  const mine = s.seats[1].profile.color;
  s = run(s, 1, { type: 'setProfile', profile: { color: hostColor } }).state;   // taken -> unchanged
  assert.equal(s.seats[1].profile.color, mine);
  const free = PLAYER_COLORS.find((c) => !s.seats.some((x) => x.profile.color === c));
  s = run(s, 1, { type: 'setProfile', profile: { color: free, name: '   ', hat: 'bogus' } }).state;
  assert.equal(s.seats[1].profile.color, free);
  assert.equal(s.seats[1].profile.name, 'Wirklich Langer');   // blank name ignored
  assert.equal(s.seats[1].profile.hat, 'crown');                // bad hat ignored
  assert.equal(s.seats[1].profile.playerId, 'p1');
  const g = started(3);
  assert.equal(applyIntent(g, 1, { type: 'setProfile', profile: { name: 'x' } }).error, 'wrongPhase');
});

test('seatPresence: lobby disconnect removes + repacks, game disconnect only flips', () => {
  let s = lobby(3);
  const r = run(s, HOST_SEAT, { type: 'seatPresence', seat: 1, connected: false });
  assert.deepEqual(r.events, [{ type: 'seatLeft', seat: 1 }]);
  assert.equal(r.state.seats.length, 2);
  assert.deepEqual(r.state.seats.map((x) => x.index), [0, 1]);
  assert.equal(r.state.seats[1].playerId, 'p2');
  assert.equal(r.state.players.length, 2);
  assert.equal(applyIntent(s, HOST_SEAT, { type: 'seatPresence', seat: 0, connected: false }).error, 'invalid');

  s = started(3);
  const g = run(s, HOST_SEAT, { type: 'seatPresence', seat: 1, connected: false });
  assert.equal(g.state.seats.length, 3);
  assert.equal(g.state.seats[1].connected, false);
  const back = run(g.state, HOST_SEAT, { type: 'seatPresence', seat: 1, connected: true });
  assert.deepEqual(back.events, [{ type: 'seatJoined', seat: 1, rejoin: true }]);
});

test('rejoin in a running game restores the same seat with coins/stars/position', () => {
  let s = started(3);
  s = edit(s, (d) => { Object.assign(d.players[1], { coins: 33, stars: 2, spaceId: 's9' }); });
  s = run(s, HOST_SEAT, { type: 'seatPresence', seat: 1, connected: false }).state;
  const r = run(s, HOST_SEAT, { type: 'seatJoin', playerId: 'p1', profile: profile(1), isBot: false });
  assert.equal(r.state.seats[1].connected, true);
  assert.deepEqual(r.events, [{ type: 'seatJoined', seat: 1, rejoin: true }]);
  assert.deepEqual([r.state.players[1].coins, r.state.players[1].stars, r.state.players[1].spaceId], [33, 2, 's9']);
  assert.equal(r.state.seats.length, 3);
});

test('setSettings: host only, lobby only, clamps starTarget, board must be registered', () => {
  const s = lobby(2);
  assert.equal(applyIntent(s, 1, { type: 'setSettings', starTarget: 5 }).error, 'forbidden');
  assert.equal(run(s, 0, { type: 'setSettings', starTarget: 5 }).state.settings.starTarget, 5);
  assert.equal(run(s, 0, { type: 'setSettings', starTarget: 99 }).state.settings.starTarget, STAR_TARGET.max);
  assert.equal(applyIntent(s, 0, { type: 'setSettings', starTarget: 'x' }).error, 'invalid');
  assert.equal(applyIntent(s, 0, { type: 'setSettings', boardId: 'bahnhof' }).error, 'invalid');   // not registered
  registerBoard(makeBoard({ id: 'bahnhof' }));
  assert.equal(run(s, 0, { type: 'setSettings', boardId: 'bahnhof' }).state.settings.boardId, 'bahnhof');
  assert.equal(applyIntent(s, 0, { type: 'setSettings', boardId: 'nope' }).error, 'invalid');
  assert.equal(applyIntent(started(2), 0, { type: 'setSettings', starTarget: 5 }).error, 'wrongPhase');
});

test('startGame: permissions, min players, initial state and events', () => {
  const one = lobby(1);
  assert.equal(applyIntent(one, 0, { type: 'startGame' }).error, 'tooFewPlayers');
  const s = lobby(3);
  assert.equal(applyIntent(s, 1, { type: 'startGame' }).error, 'forbidden');
  const absent = run(s, HOST_SEAT, { type: 'seatPresence', seat: 1, connected: false }).state;
  assert.equal(run(absent, 0, { type: 'startGame' }).state.turnOrder.length, 2);
  const r = run(s, 0, { type: 'startGame' });
  const g = r.state;
  assert.equal(g.phase, 'boardTurn');
  assert.equal(g.round, 1);
  assert.deepEqual([...g.turnOrder].sort(), [0, 1, 2]);
  assert.equal(g.turn.seat, g.turnOrder[0]);
  assert.equal(g.turn.step, 'roll');
  assert.ok(getBoard('spaeti').starSpaceIds.includes(g.starSpaceId));
  assert.ok(g.players.every((p) => p.spaceId === 's0' && p.coins === g.rules.startCoins && p.stars === 0));
  assert.deepEqual(types(r.events), ['gameStarted', 'roundStarted', 'turnStarted']);
  assert.equal(applyIntent(g, 0, { type: 'startGame' }).error, 'wrongPhase');
});

test('permissions: host intents need HOST_SEAT, player intents refuse HOST_SEAT, unknown intent invalid', () => {
  const s = started(3);
  for (const t of [{ type: 'advance' }, { type: 'seatPresence', seat: 1, connected: false }, { type: 'minigameDone', results: { placements: [] } },
    { type: 'seatJoin', playerId: 'z', profile: profile(0), isBot: false }]) {
    assert.equal(applyIntent(s, 0, t).error, 'forbidden', t.type);
    assert.equal(applyIntent(s, 2, t).error, 'forbidden', t.type);
  }
  assert.equal(applyIntent(s, HOST_SEAT, { type: 'roll' }).error, 'forbidden');
  assert.equal(applyIntent(s, 7, { type: 'roll' }).error, 'forbidden');
  assert.equal(applyIntent(s, 0, { type: 'dance' }).error, 'invalid');
  assert.equal(applyIntent(s, 0, null).error, 'invalid');
  assert.equal(applyIntent(s, 0, { type: 'ready' }).error, 'wrongPhase');
  assert.equal(applyIntent(s, HOST_SEAT, { type: 'minigameDone', results: { placements: [[0]] } }).error, 'wrongPhase');
});

test('rematch: host only in victory, resets players, keeps seats + settings', () => {
  let s = started(3, { starTarget: 4 });
  s = edit(s, (d) => { d.phase = 'victory'; d.winner = 1; d.turn = null; d.endspurt = true; d.players[1].stars = 4; d.players[1].coins = 50; d.players[1].items = ['trap']; d.traps = { s5: 1 }; });
  assert.equal(applyIntent(s, 1, { type: 'rematch' }).error, 'forbidden');
  assert.equal(applyIntent(started(3), 0, { type: 'rematch' }).error, 'wrongPhase');
  s = run(s, HOST_SEAT, { type: 'seatPresence', seat: 2, connected: false }).state;
  const g = run(s, 0, { type: 'rematch' }).state;
  assert.equal(g.phase, 'lobby');
  assert.equal(g.settings.starTarget, 4);
  assert.equal(g.winner, null);
  assert.equal(g.endspurt, false);
  assert.equal(g.round, 0);
  assert.deepEqual(g.traps, {});
  assert.equal(g.seats.length, 2);   // the offline seat is dropped like any lobby seat
  assert.deepEqual(g.players[1], { coins: g.rules.startCoins, stars: 0, items: [], spaceId: null, mgWins: 0, skipTurns: 0 });
  assert.equal(run(g, 0, { type: 'startGame' }).state.phase, 'boardTurn');
});

test('serialize / deserialize round trip, bad version and bad json -> null', () => {
  const s = started(3);
  const json = serialize(s);
  assert.deepEqual(deserialize(json), s);
  assert.equal(deserialize(JSON.stringify({ ...s, version: STATE_VERSION + 1 })), null);
  assert.equal(deserialize('{not json'), null);
  assert.equal(deserialize('null'), null);
  assert.equal(deserialize('{}'), null);
});

test('resumeGame: host connected, others offline, minigame restarts at intro, lobby drops offline seats', () => {
  let s = started(3);
  s = edit(s, (d) => { d.phase = 'minigame'; d.minigame = { id: 'forza', kind: 'solo', mode: 'ffa', purpose: 'round', seats: [0, 1, 2], teams: null, seed: 1, ready: [0, 1, 2], results: null, coinDelta: null }; });
  const frozen = deepFreeze(structuredClone(s));
  const r = resumeGame(frozen, 'p0');
  assert.deepEqual(r.seats.map((x) => x.connected), [true, false, false]);
  assert.equal(r.phase, 'minigameIntro');
  assert.deepEqual(r.minigame.ready, []);
  assert.equal(r.rev, s.rev + 1);
  assert.equal(frozen.phase, 'minigame');
  const l = resumeGame(lobby(3), 'p0');
  assert.equal(l.seats.length, 1);
  // a non-host playerId still keeps one connected seat (fallback seat 0) -- host is always seat 0
  assert.equal(resumeGame(started(2), 'p0').seats[0].connected, true);
});

test('applyIntent: errors return the input state untouched, success bumps rev', () => {
  const s = deepFreeze(started(3));
  const e = applyIntent(s, 1, { type: 'roll' });
  assert.equal(e.error, 'notYourTurn');
  assert.equal(e.state, s);
  assert.deepEqual(e.events, []);
  const ok = applyIntent(s, 0, { type: 'roll' });
  assert.equal(ok.state.rev, s.rev + 1);
  assert.notEqual(ok.state, s);
});
