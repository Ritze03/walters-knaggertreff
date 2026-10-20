import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOST_SEAT } from '../contracts.js';
import { applyIntent, previewPath, previewLanding, registerBoard, createGame } from './index.js';
import { started, run, edit, makeBoard, profile } from './fixtures.js';
import spaeti from '../board/boards/spaeti.js';

/** a state standing at fork `forkId` (seat 0) with `steps` left, at the path prompt */
function atFork(base, board, forkId, steps, { coins = 5, starSpaceId = null } = {}) {
  return edit(base, (d) => {
    d.players[0].spaceId = forkId;
    d.players[0].coins = coins;
    if (starSpaceId) d.starSpaceId = starSpaceId;
    d.turn.step = 'path';
    d.turn.stepsLeft = steps;
    d.turn.options = [...board.spaces.find((s) => s.id === forkId).next];
  });
}

/** chooses `opt`, declines every star / shop prompt, returns the final state + every space the engine walked over, in order */
function play(state, opt) {
  let r = run(state, 0, { type: 'choosePath', spaceId: opt });
  const walked = [];
  for (let i = 0; i < 20; i++) {
    for (const e of r.events) if (e.type === 'moved') walked.push(...e.path);
    const t = r.state.turn;
    if (r.state.phase !== 'boardTurn' || t.seat !== 0 || !['star', 'shop'].includes(t.step)) break;
    r = run(r.state, 0, t.step === 'star' ? { type: 'buyStar', accept: false } : { type: 'buyItem', item: null });
  }
  return { state: r.state, walked };
}

function check(base, board, label) {
  const forks = board.spaces.filter((s) => s.next.length > 1);
  assert.ok(forks.length >= 1);
  let n = 0, again = 0;
  for (const fork of forks) {
    for (const steps of [1, 2, 3, 5, 8, 10, 14, 20, 30]) {
      for (const opt of fork.next) {
        // coins 5 = no prompts on the way, 40 = every affordable star / shop interrupts the walk
        for (const coins of [5, 40]) {
          const path = previewPath(board, fork.id, opt, steps).path;
          const st = atFork(base, board, fork.id, steps, { coins, starSpaceId: board.starSpaceIds.find((id) => path.includes(id)) });
          const pv = previewLanding(st, opt);
          assert.ok(pv, `${label} ${fork.id}->${opt} ${steps}`);
          const { state, walked } = play(st, opt);
          assert.deepEqual(walked, pv.path, `${label} ${fork.id}->${opt} with ${steps} steps (coins ${coins})`);
          if (pv.landed) {
            assert.equal(pv.stepsLeft, 0);
            assert.equal(walked.at(-1), pv.end);
          } else {
            assert.equal(state.turn.step, 'path', 'stopped at a further fork');
            assert.equal(state.players[0].spaceId, pv.end);
            assert.equal(state.turn.stepsLeft, pv.stepsLeft);
            assert.ok(board.spaces.find((s) => s.id === pv.end).next.length > 1);
            again++;
          }
          n++;
        }
      }
    }
  }
  return { n, again };
}

test('previewLanding agrees with what choosePath really does (fixture board, incl. star / shop interruptions)', () => {
  const { n, again } = check(started(3), makeBoard(), 'fixture');
  assert.ok(n >= 36);
  assert.ok(again > 0, 'some case stops at a further fork');
});

test('previewLanding agrees with choosePath on the real Spaeti-Kiez board (both forks)', () => {
  registerBoard(spaeti);
  let s = createGame({ gameId: 'x', hostPlayerId: 'p0', hostProfile: profile(0), seed: 1, boardId: 'spaeti' });
  for (const i of [1, 2]) s = run(s, HOST_SEAT, { type: 'seatJoin', playerId: `p${i}`, profile: profile(i), isBot: false }).state;
  s = run(s, 0, { type: 'startGame' }).state;
  s = edit(s, (d) => { d.turnOrder = [0, 1, 2]; d.turnIndex = 0; d.turn.seat = 0; });
  const { n, again } = check(s, spaeti, 'spaeti');
  assert.ok(n > 60);
  assert.ok(again > 0);
});

test('previewPath: counts the first step, stops at a further fork, lands exactly when steps run out', () => {
  const b = makeBoard();
  assert.deepEqual(previewPath(b, 's6', 's7', 1), { path: ['s7'], end: 's7', landed: true, stepsLeft: 0 });
  assert.deepEqual(previewPath(b, 's6', 's12', 4), { path: ['s12', 's13', 's14', 's15'], end: 's15', landed: true, stepsLeft: 0 });
  // loops around to the fork again: stops there with the rest of the steps
  const loop = previewPath(b, 's6', 's7', 20);
  assert.equal(loop.landed, false);
  assert.equal(loop.end, 's6');
  assert.equal(loop.stepsLeft, 20 - loop.path.length);
  // invalid input: nothing moves
  assert.equal(previewPath(b, 's6', 's9', 3).path.length, 0);
  assert.equal(previewLanding(started(3), 's7'), null);
});

test('previewLanding just uses stepsLeft as rolled (Doppelwuerfel / Goldener Doener only change the roll, not the counting)', () => {
  const st = atFork(started(3), makeBoard(), 's6', 13);
  const pv = previewLanding(st, 's7');
  assert.equal(pv.path.length, 13 - pv.stepsLeft);
  assert.equal(applyIntent(st, 0, { type: 'choosePath', spaceId: 's7' }).error, null);
});
