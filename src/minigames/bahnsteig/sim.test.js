import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, MINIGAMES } from '../../contracts.js';
import { hostInit, hostStep, hostResult, botFrame, tileAt, tileCenter, C, GW, GH, HALF_W, DURATION_MS } from './sim.js';

const DT = 1000 / 60;
const init = (seats = [0, 1, 2], seed = 7) => hostInit({ seats, seed, rng: createRng(seed), mode: 'ffa', teams: null });
const frame = (over = {}) => ({ move: { x: 0, y: 0 }, jump: false, action: false, confirm: false, back: false, pressed: { jump: false, action: false, confirm: false, back: false }, ...over });
const press = frame({ pressed: { jump: false, action: true, confirm: false, back: false } });
const pl = (mg, s) => mg.ps.find((p) => p.s === s);
/** no patterns, no ICE: only what the test sets up happens */
const quiet = (mg) => { mg.next = 1e9; mg.iceNext = 1e9; return mg; };

function playBots(seats, seed, ms = DURATION_MS + 1000) {
  const mg = init(seats, seed);
  const rngs = Object.fromEntries(seats.map((s) => [s, createRng(seed + s)]));
  for (let i = 0; i < Math.ceil(ms / DT) && !mg.done; i++) {
    hostStep(mg, Object.fromEntries(seats.map((s) => [s, botFrame(mg, s, rngs[s])])), DT);
  }
  return mg;
}

test('the sim is deterministic: same seed + same inputs => identical state', () => {
  const a = playBots([0, 1, 2, 3], 99), b = playBots([0, 1, 2, 3], 99), c = playBots([0, 1, 2, 3], 100);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.notDeepEqual(a.tw, c.tw);
});

test('state is plain JSON and carries t + done; everybody starts on a tile', () => {
  const mg = init([0, 1, 2, 3, 4, 5]);
  hostStep(mg, {}, DT);
  assert.equal(typeof mg.t, 'number');
  assert.equal(mg.done, false);
  assert.deepEqual(JSON.parse(JSON.stringify(mg)), mg);
  assert.equal(mg.tw.length, GW * GH);
  for (const p of mg.ps) assert.ok(tileAt(p.x, p.z) >= 0, `seat ${p.s} spawns on the platform`);
});

test('a pattern is announced, makes tiles wobble, and they fall when the timer is up', () => {
  const mg = init([0, 1]);
  mg.next = 0; mg.iceNext = 1e9;
  hostStep(mg, {}, DT);
  const ann = mg.ev.find((e) => e.k === 'a');
  assert.ok(ann, 'announcement event');
  assert.ok(ann.n > 0);
  const wobbling = mg.tw.filter((x) => x > 0).length;
  assert.equal(wobbling, ann.n);
  mg.next = 1e9;
  for (let i = 0; i < 150 && mg.tw.some((x) => x > 0); i++) hostStep(mg, {}, DT);
  assert.equal(mg.tw.filter((x) => x === -1).length, ann.n, 'every wobbling tile fell');
  assert.equal(mg.tw.filter((x) => x > 0).length, 0);
});

test('standing on a tile that falls drops you out (after the coyote time); walking off the platform too', () => {
  const mg = quiet(init([0, 1, 2]));
  Object.assign(pl(mg, 0), { x: 0, z: 0 });
  Object.assign(pl(mg, 1), { x: 6, z: 0 });
  Object.assign(pl(mg, 2), { x: -6, z: 3 });
  mg.tw[tileAt(0, 0)] = 100;
  for (let i = 0; i < 30; i++) hostStep(mg, { 1: frame({ move: { x: 1, y: 0 } }) }, DT);
  assert.notEqual(pl(mg, 0).out, null, 'tile fell under player 0');
  assert.ok(pl(mg, 0).out >= 100 + C.COYOTE_MS - DT);
  assert.equal(pl(mg, 2).out, null);
  for (let i = 0; i < 120; i++) hostStep(mg, { 1: frame({ move: { x: 1, y: 0 } }) }, DT);
  assert.notEqual(pl(mg, 1).out, null, 'ran off the east edge');
  assert.ok(pl(mg, 1).x > HALF_W);
  assert.ok(pl(mg, 0).y < -1, 'keeps falling after being out');
  assert.ok(pl(mg, 0).y >= C.FLOOR_Y, 'but lands on the track bed');
});

test('a short hop over the coyote time does not kill you', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: -0.9, z: 0.1, vx: -5 });
  mg.tw[tileAt(-0.9, 0.1)] = -1;                      // the tile you stand on is already gone, but the adjacent one is not
  for (let i = 0; i < 12; i++) hostStep(mg, { 0: frame({ move: { x: -1, y: 0 } }) }, DT);
  assert.ok(pl(mg, 0).x < -1, 'made it over');
  assert.equal(pl(mg, 0).out, null);
  assert.equal(pl(mg, 0).air, 0);
});

test('a shove knocks a rival away, stuns them, and credits the shover when they then fall', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 5.2, z: 0, fx: 1, fz: 0 });
  Object.assign(pl(mg, 1), { x: 6.4, z: 0 });
  hostStep(mg, { 0: frame({ move: { x: 1, y: 0 }, action: true, pressed: { jump: false, action: true, confirm: false, back: false } }) }, DT);
  assert.ok(pl(mg, 1).stun > 0);
  assert.equal(pl(mg, 1).ls, 0);
  assert.ok(mg.ev.some((e) => e.k === 's' && e.s === 0 && e.o === 1));
  for (let i = 0; i < 90 && pl(mg, 1).out === null; i++) hostStep(mg, {}, DT);
  assert.notEqual(pl(mg, 1).out, null, 'knocked off the edge');
  assert.equal(pl(mg, 0).ko, 1);
  assert.ok(mg.ev.some((e) => e.k === 'o' && e.s === 1 && e.by === 0) || pl(mg, 1).out !== null);
});

test('a shove needs the cooldown to be over; jump (A) also shoves', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: -3, z: 0 }); Object.assign(pl(mg, 1), { x: 3, z: 3 });
  hostStep(mg, { 0: press }, DT);
  assert.ok(pl(mg, 0).dash > 0);
  for (let i = 0; i < 30; i++) hostStep(mg, {}, DT);          // dash over, cooldown still running
  hostStep(mg, { 0: press }, DT);
  assert.equal(pl(mg, 0).dash, 0, 'second press ignored while on cooldown');
  for (let i = 0; i < 60; i++) hostStep(mg, {}, DT);
  hostStep(mg, { 0: frame({ pressed: { jump: true, action: false, confirm: false, back: false } }) }, DT);
  assert.ok(pl(mg, 0).dash > 0, 'jump press shoves too');
});

test('the ICE: warning first, then its suction drags players towards its track', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 0, z: 0 }); Object.assign(pl(mg, 1), { x: 3, z: 0 });
  mg.iceNext = 0;
  hostStep(mg, {}, DT);
  assert.ok(mg.ice && mg.ice.w === 0, 'warning phase');
  assert.ok(mg.ev.some((e) => e.k === 'i'));
  const side = mg.ice.side, z0 = pl(mg, 0).z;
  for (let i = 0; i < 100; i++) hostStep(mg, {}, DT);          // 1.7 s: still warning, no push
  assert.equal(pl(mg, 0).z, z0);
  let started = false;
  for (let i = 0; i < 200 && !started; i++) { hostStep(mg, {}, DT); started = mg.ice?.w === 1; }
  assert.ok(started, 'the ICE rushes through after the warning');
  const mid = [];
  for (let i = 0; i < 70 && mg.ice; i++) { hostStep(mg, {}, DT); mid.push(pl(mg, 0).z); }
  assert.ok((pl(mg, 0).z - z0) * side > 0.5 || pl(mg, 0).out !== null, `dragged towards side ${side}: z=${pl(mg, 0).z}`);
  for (let i = 0; i < 200 && mg.ice; i++) hostStep(mg, {}, DT);
  assert.equal(mg.ice, null, 'the ICE leaves again');
});

test('the last survivor ends the game after a short outro, and hovers safely meanwhile', () => {
  const mg = quiet(init([0, 1, 2]));
  mg.t = 4000;
  Object.assign(pl(mg, 0), { x: 0, z: 0 });
  Object.assign(pl(mg, 1), { x: 12, z: 0 });
  Object.assign(pl(mg, 2), { x: -12, z: 0 });
  for (let i = 0; i < 20; i++) hostStep(mg, {}, DT);
  assert.notEqual(pl(mg, 1).out, null); assert.notEqual(pl(mg, 2).out, null);
  assert.equal(mg.done, false, 'outro still running');
  mg.tw[tileAt(0, 0)] = -1;
  for (let i = 0; i < 20; i++) hostStep(mg, {}, DT);
  assert.equal(pl(mg, 0).out, null, 'the winner does not fall during the outro');
  for (let i = 0; i < 120; i++) hostStep(mg, {}, DT);
  assert.equal(mg.done, true);
  assert.deepEqual(hostResult(mg).placements[0], [0]);
});

test('the game ends by durationMs at the latest; survivors tie for first', () => {
  const mg = quiet(init([0, 1, 2]));
  for (let i = 0; i < 3000 && !mg.done; i++) hostStep(mg, {}, DT);
  assert.equal(mg.done, true);
  assert.ok(mg.t >= DURATION_MS && mg.t < DURATION_MS + 2 * DT, `t=${mg.t}`);
  assert.deepEqual(hostResult(mg).placements, [[0, 1, 2]], 'everybody survived: one big tie');
  const stepped = mg.t;
  hostStep(mg, {}, DT);
  assert.equal(mg.t, stepped, 'a finished game does not advance');
});

test('hostResult: survivors first (tied), then later out is better, equal times tie', () => {
  const mg = init([0, 1, 2, 3, 4]);
  Object.assign(pl(mg, 0), { out: 5000, ko: 2 });
  Object.assign(pl(mg, 1), { out: 9000 });
  Object.assign(pl(mg, 3), { out: 5000 });
  const r = hostResult(mg);
  assert.deepEqual(r.placements, [[2, 4], [1], [0, 3]]);
  assert.match(r.labels[0], /abgefahren nach 5,0 s/);
  assert.match(r.labels[0], /2× rausgeschubst/);
  assert.match(r.labels[2], /noch auf dem Bahnsteig/);
});

test('hostResult covers exactly the participants (non-contiguous seats)', () => {
  const mg = playBots([1, 3, 4, 5], 5);
  const r = hostResult(mg);
  assert.deepEqual(r.placements.flat().sort(), [1, 3, 4, 5]);
  assert.equal(new Set(r.placements.flat()).size, 4);
  for (const s of [1, 3, 4, 5]) assert.equal(typeof r.labels[s], 'string');
});

test('bots alone finish a game (2, 4 and 6 players, various seeds) with a winner most of the time', () => {
  let decided = 0, games = 0;
  for (const n of [2, 4, 6]) for (const seed of [1, 2, 3]) {
    const seats = [...Array(n).keys()];
    const mg = playBots(seats, seed);
    assert.equal(mg.done, true, `n=${n} seed ${seed} not finished at t=${mg.t}`);
    assert.ok(mg.t <= DURATION_MS + 2 * DT);
    assert.deepEqual(hostResult(mg).placements.flat().sort(), seats);
    games++; if (hostResult(mg).placements[0].length === 1) decided++;
  }
  assert.ok(decided >= games - 2, `${decided}/${games} games had a single winner`);
});

test('the bot leaves a wobbling tile for a stable one, and stands still on a quiet platform', () => {
  const mg = quiet(init([0]));
  Object.assign(pl(mg, 0), { x: 0.1, z: 0.1 });
  const idle = botFrame(mg, 0, createRng(1));
  assert.ok(Math.hypot(idle.move.x, idle.move.y) < 0.99, 'content on its tile');
  mg.tw[tileAt(0.1, 0.1)] = 100;                          // about to fall (past any reaction time)
  const f = botFrame(mg, 0, createRng(1));
  assert.ok(Math.hypot(f.move.x, f.move.y) > 0.9, 'runs');
  // simulate: it survives the fall
  for (let i = 0; i < 90; i++) hostStep(mg, { 0: botFrame(mg, 0, createRng(1)) }, DT);
  assert.equal(pl(mg, 0).out, null);
  assert.equal(mg.tw[tileAt(0.1, 0.1)], -1);
});

test('the bot shoves a rival standing at the brink', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 5.0, z: 0 });
  Object.assign(pl(mg, 1), { x: 6.8, z: 0 });
  let pressed = false;
  const rng = createRng(3);
  for (let i = 0; i < 200 && !pressed; i++) pressed = botFrame(mg, 0, rng).pressed.action;
  assert.ok(pressed);
});

test('bahnsteig is an arena game in the MINIGAMES table', () => {
  assert.equal(MINIGAMES.bahnsteig.kind, 'arena');
  assert.ok(tileCenter(0).x < 0);
});
