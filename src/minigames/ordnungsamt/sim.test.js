import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, MINIGAMES } from '../../contracts.js';
import { hostInit, hostStep, hostResult, botFrame, ARENA, C, DURATION_MS } from './sim.js';

const DT = 1000 / 60;
const init = (seats = [0, 1, 2], seed = 7) => hostInit({ seats, seed, rng: createRng(seed), mode: 'ffa', teams: null });
const frame = (over = {}) => ({ move: { x: 0, y: 0 }, jump: false, action: false, confirm: false, back: false, pressed: { jump: false, action: false, confirm: false, back: false }, ...over });
const pl = (mg, s) => mg.ps.find((p) => p.s === s);
const quiet = (mg) => { mg.vans = []; mg.next = 1e9; return mg; };

/** plays `ms` with every seat steered by its bot; returns the final state */
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
  assert.notDeepEqual(a.ps.map((p) => [p.x, p.y]), c.ps.map((p) => [p.x, p.y]));
});

test('state is plain JSON and carries t + done', () => {
  const mg = init();
  hostStep(mg, {}, DT);
  assert.equal(typeof mg.t, 'number');
  assert.equal(mg.done, false);
  assert.deepEqual(JSON.parse(JSON.stringify(mg)), mg);
});

test('the game ends by durationMs at the latest', () => {
  const mg = init([0, 1]);
  // two sitting ducks that are never hit would idle forever: remove all vans each step
  for (let i = 0; i < 3000 && !mg.done; i++) { hostStep(mg, {}, DT); mg.vans = []; }
  assert.equal(mg.done, true);
  assert.ok(mg.t >= DURATION_MS && mg.t < DURATION_MS + 2 * DT, `t=${mg.t}`);
  assert.equal(hostResult(mg).placements.length, 1, 'both survived with 3 lives and no credits: a tie');
  const stepped = mg.t;
  hostStep(mg, {}, DT);
  assert.equal(mg.t, stepped, 'a finished game does not advance');
});

test('a shove pushes a rival away, stuns them and credits the shover', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 600, y: 400, fx: 1, fy: 0 });
  Object.assign(pl(mg, 1), { x: 640, y: 400 });
  hostStep(mg, { 0: frame({ move: { x: 1, y: 0 }, action: true, pressed: { jump: false, action: true, confirm: false, back: false } }) }, DT);
  assert.ok(pl(mg, 1).stun > 0);
  assert.equal(pl(mg, 1).ls, 0);
  assert.ok(mg.ev.some((e) => e.k === 's' && e.s === 0 && e.o === 1));
  for (let i = 0; i < 30; i++) hostStep(mg, {}, DT);
  assert.ok(pl(mg, 1).x > 640 + 100, `pushed to x=${pl(mg, 1).x}`);
  assert.ok(pl(mg, 0).cd > 0, 'shove has a cooldown');
});

test('a shove needs the cooldown to be over', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 300, y: 300 }); Object.assign(pl(mg, 1), { x: 900, y: 600 });
  const press = frame({ pressed: { jump: false, action: true, confirm: false, back: false } });
  hostStep(mg, { 0: press }, DT);
  const dash = pl(mg, 0).dash;
  for (let i = 0; i < 30; i++) hostStep(mg, {}, DT);          // dash over, cooldown still running
  hostStep(mg, { 0: press }, DT);
  assert.equal(pl(mg, 0).dash, 0, `second press ignored (first dash was ${dash} ms)`);
});

test('a van hit costs a life, grants invulnerability, and shoving someone into it credits the shover', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 600, y: 400 });
  Object.assign(pl(mg, 1), { x: 200, y: 200, ls: 0, lt: mg.t });
  mg.vans.push({ id: 1, w: C.VAN_W, h: C.VAN_T, x: 600, y: 400, vx: 300, vy: 0 });
  mg.vans.push({ id: 2, w: C.VAN_W, h: C.VAN_T, x: 200, y: 200, vx: 300, vy: 0 });
  hostStep(mg, {}, DT);
  assert.equal(pl(mg, 0).lives, C.LIVES - 1);
  assert.ok(pl(mg, 0).inv > 0);
  assert.ok(mg.ev.some((e) => e.k === 'h' && e.s === 0 && e.o === -1));
  assert.equal(pl(mg, 1).lives, C.LIVES - 1);
  assert.equal(pl(mg, 0).cr, 1, 'player 0 shoved player 1 shortly before the van hit');
  assert.ok(mg.ev.some((e) => e.k === 'h' && e.s === 1 && e.o === 0));
  hostStep(mg, {}, DT);
  assert.equal(pl(mg, 0).lives, C.LIVES - 1, 'invulnerable right after a hit');
});

test('at 0 lives you are out, and the last survivor ends the game', () => {
  const mg = quiet(init([0, 1, 2]));
  mg.t = 4000;
  for (const s of [0, 1]) { Object.assign(pl(mg, s), { lives: 1, x: 500 + s * 300, y: 400 }); mg.vans.push({ id: s + 1, w: C.VAN_W, h: C.VAN_T, x: 500 + s * 300, y: 400, vx: 300, vy: 0 }); }
  hostStep(mg, {}, DT);
  assert.notEqual(pl(mg, 0).out, null);
  assert.notEqual(pl(mg, 1).out, null);
  assert.equal(mg.done, true);
  assert.deepEqual(hostResult(mg).placements, [[2], [0, 1]], 'same step out = tie');
});

test('hostResult: alive before out, more lives first, credits break ties, later out is better', () => {
  const mg = init([0, 1, 2, 3, 4]);
  Object.assign(pl(mg, 0), { lives: 2, cr: 0 });
  Object.assign(pl(mg, 1), { lives: 0, out: 5000 });
  Object.assign(pl(mg, 2), { lives: 0, out: 9000 });
  Object.assign(pl(mg, 3), { lives: 3 });
  Object.assign(pl(mg, 4), { lives: 2, cr: 1 });
  const r = hostResult(mg);
  assert.deepEqual(r.placements, [[3], [4], [0], [2], [1]]);
  assert.match(r.labels[1], /kontrolliert nach 5,0 s/);
  assert.match(r.labels[4], /Kollateralschaden/);
});

test('hostResult covers exactly the participants (non-contiguous seats)', () => {
  const mg = playBots([1, 3, 4, 5], 5);
  const r = hostResult(mg);
  assert.deepEqual(r.placements.flat().sort(), [1, 3, 4, 5]);
  assert.equal(new Set(r.placements.flat()).size, 4);
  for (const s of [1, 3, 4, 5]) assert.equal(typeof r.labels[s], 'string');
});

test('bots alone finish a game (6 players, various seeds) and stay inside the arena', () => {
  for (const seed of [1, 2, 3]) {
    const mg = playBots([0, 1, 2, 3, 4, 5], seed);
    assert.equal(mg.done, true, `seed ${seed} not finished at t=${mg.t}`);
    assert.ok(mg.t <= DURATION_MS + 2 * DT);
    for (const p of mg.ps) assert.ok(p.x >= ARENA.x0 && p.x <= ARENA.x1 && p.y >= ARENA.y0 && p.y <= ARENA.y1);
    assert.deepEqual(hostResult(mg).placements.flat().sort(), [0, 1, 2, 3, 4, 5]);
  }
});

test('the bot sidesteps an oncoming van but a van-less bot stays put', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 640, y: 400 });
  const f0 = botFrame(mg, 0, createRng(1));
  assert.deepEqual(f0.move, { x: 0, y: 0 });
  mg.vans.push({ id: 1, w: C.VAN_W, h: C.VAN_T, x: 300, y: 405, vx: 400, vy: 0 });
  const f1 = botFrame(mg, 0, createRng(1));
  assert.equal(f1.move.x, 0);
  assert.notEqual(f1.move.y, 0);
});

test('vans speed up over time and lanes are seeded', () => {
  const early = init([0, 1], 3), late = init([0, 1], 3);
  late.t = 25000;
  for (const m of [early, late]) { m.next = 0; hostStep(m, {}, DT); }
  const speed = (m) => Math.abs(m.vans[0].vx || m.vans[0].vy);
  assert.ok(speed(late) > speed(early) + 100);
  const again = init([0, 1], 3); again.next = 0; hostStep(again, {}, DT);
  assert.deepEqual(again.vans, early.vans);
});

test('ordnungsamt is an arena game in the MINIGAMES table', () => {
  assert.equal(MINIGAMES.ordnungsamt.kind, 'arena');
});
