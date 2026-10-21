import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, MINIGAMES } from '../../contracts.js';
import { hostInit, hostStep, hostResult, botFrame, counts, SEATS, SEAT_COUNT, TABLES, ARENA, C, DURATION_MS } from './sim.js';

const DT = 1000 / 60;
const TEAMS4 = [[0, 2], [1, 3]];
const init = (seats = [0, 1, 2, 3], teams = TEAMS4, seed = 7) => hostInit({ seats, seed, rng: createRng(seed), mode: 'team', teams });
const frame = (over = {}) => ({ move: { x: 0, y: 0 }, jump: false, action: false, confirm: false, back: false, pressed: { jump: false, action: false, confirm: false, back: false }, ...over });
const pl = (mg, s) => mg.ps.find((p) => p.s === s);
const away = (mg) => { mg.sc.x = 1200; mg.sc.pz = 1e9; return mg; };   // parks the Schaffner far from the test spots

function playBots(seats, teams, seed, ms = DURATION_MS + 1000) {
  const mg = init(seats, teams, seed);
  const rngs = Object.fromEntries(seats.map((s) => [s, createRng(seed + s)]));
  const mems = Object.fromEntries(seats.map((s) => [s, {}]));
  for (let i = 0; i < Math.ceil(ms / DT) && !mg.done; i++) {
    hostStep(mg, Object.fromEntries(seats.map((s) => [s, botFrame(mg, s, rngs[s], mems[s])])), DT);
  }
  return mg;
}

test('the registry says sitzplatz is a team game for 4..6', () => {
  assert.equal(MINIGAMES.sitzplatz.kind, 'team');
  assert.ok(MINIGAMES.sitzplatz.min >= 4);
});

test('hostInit uses the given teams exactly and falls back to parity teams', () => {
  const mg = init();
  assert.deepEqual(mg.teams, TEAMS4);
  assert.deepEqual(mg.ps.map((p) => [p.s, p.tm]), [[0, 0], [1, 1], [2, 0], [3, 1]]);
  const fb = hostInit({ seats: [0, 1, 2, 3, 4, 5], seed: 1, rng: createRng(1), mode: 'team', teams: null });
  assert.deepEqual(fb.teams, [[0, 2, 4], [1, 3, 5]]);
  assert.equal(fb.o.length, SEAT_COUNT);
  assert.ok(fb.o.every((o) => o === -1));
});

test('seats and tables do not overlap and lie inside the arena', () => {
  for (const s of SEATS) assert.ok(s.x > ARENA.x0 && s.x < ARENA.x1 && s.y > ARENA.y0 && s.y < ARENA.y1);
  for (const t of TABLES) for (const s of SEATS) assert.ok(Math.abs(t.x - s.x) > 20 || Math.abs(t.y - s.y) > 40, 'table sits between the seat rows');
});

test('the sim is deterministic: same seed + same inputs => identical state', () => {
  const a = playBots([0, 1, 2, 3], TEAMS4, 99), b = playBots([0, 1, 2, 3], TEAMS4, 99), c = playBots([0, 1, 2, 3], TEAMS4, 100);
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

test('the game ends at durationMs and a finished game does not advance', () => {
  const mg = init();
  for (let i = 0; i < 3000 && !mg.done; i++) hostStep(mg, {}, DT);
  assert.equal(mg.done, true);
  assert.ok(mg.t >= DURATION_MS && mg.t < DURATION_MS + 2 * DT, `t=${mg.t}`);
  const t = mg.t;
  hostStep(mg, {}, DT);
  assert.equal(mg.t, t);
});

test('touching a seat paints it in the team colour, and the other team flips it after the immunity', () => {
  const mg = away(init());
  const i = 9, s = SEATS[i];
  Object.assign(pl(mg, 0), { x: s.x, y: s.y });
  hostStep(mg, {}, DT);
  assert.equal(mg.o[i], 0);
  Object.assign(pl(mg, 1), { x: s.x, y: s.y });
  Object.assign(pl(mg, 0), { x: 400, y: 370 });
  hostStep(mg, {}, DT);
  assert.equal(mg.o[i], 0, 'freshly painted seats are immune for a moment');
  for (let k = 0; k < Math.ceil(C.FLIP_CD_MS / DT) + 2; k++) { Object.assign(pl(mg, 1), { x: s.x, y: s.y, vx: 0, vy: 0 }); hostStep(mg, {}, DT); }
  assert.equal(mg.o[i], 1, 'then the rival flips it');
  assert.deepEqual(counts(mg), [0, 1]);
});

test('a stunned player does not paint', () => {
  const mg = away(init());
  const s = SEATS[3];
  Object.assign(pl(mg, 0), { x: s.x, y: s.y, stun: 300 });
  hostStep(mg, {}, DT);
  assert.equal(mg.o[3], -1);
});

test('the jacket claims and locks the seats around, rivals cannot flip locked seats, the lock runs out', () => {
  const mg = away(init());
  const near = SEATS.map((s, i) => i).filter((i) => Math.hypot(SEATS[i].x - 296, SEATS[i].y - 260) <= C.JACKET_R);
  assert.ok(near.length >= 3, `${near.length} seats near`);
  Object.assign(pl(mg, 0), { x: 296, y: 260 });
  hostStep(mg, { 0: frame({ pressed: { jump: false, action: true, confirm: false, back: false } }) }, DT);
  for (const i of near) { assert.equal(mg.o[i], 0); assert.ok(mg.lk[i] > 0); }
  assert.ok(pl(mg, 0).cd > 0, 'jacket has a cooldown');
  assert.ok(mg.ev.some((e) => e.k === 'j' && e.s === 0 && e.n === near.length));
  const s = SEATS[near[0]];
  Object.assign(pl(mg, 1), { x: s.x, y: s.y });
  Object.assign(pl(mg, 0), { x: 700, y: 370 });
  hostStep(mg, {}, DT);
  assert.equal(mg.o[near[0]], 0, 'locked');
  for (let k = 0; k < Math.ceil(C.LOCK_MS / DT) + 40; k++) { Object.assign(pl(mg, 1), { x: s.x, y: s.y, vx: 0, vy: 0 }); hostStep(mg, {}, DT); }
  assert.equal(mg.o[near[0]], 1, 'after the lock the rival paints it');
});

test('the jacket press is ignored during the cooldown', () => {
  const mg = away(init());
  Object.assign(pl(mg, 0), { x: 296, y: 260 });
  const press = { 0: frame({ pressed: { jump: false, action: true, confirm: false, back: false } }) };
  hostStep(mg, press, DT);
  const n = mg.ev.filter((e) => e.k === 'j').length;
  hostStep(mg, press, DT);
  assert.equal(mg.ev.filter((e) => e.k === 'j').length, n);
});

test('the Schaffner flings and stuns a player in the aisle, then leaves them alone for a while', () => {
  const mg = init();
  Object.assign(mg.sc, { x: 640, pz: 1e9 });
  Object.assign(pl(mg, 0), { x: 640 - 30, y: mg.sc.y });
  hostStep(mg, {}, DT);
  assert.ok(pl(mg, 0).stun > 0);
  assert.ok(pl(mg, 0).kx < 0, 'flung away from him');
  assert.ok(mg.ev.some((e) => e.k === 'b' && e.s === 0));
  const stun = pl(mg, 0).stun;
  Object.assign(pl(mg, 0), { x: 640 - 30, y: mg.sc.y });
  hostStep(mg, {}, DT);
  assert.ok(pl(mg, 0).stun <= stun, 'no second bump during immunity');
});

test('tables block players', () => {
  const mg = away(init());
  const t = TABLES[0];
  Object.assign(pl(mg, 0), { x: t.x, y: t.y });
  hostStep(mg, {}, DT);
  assert.ok(Math.abs(pl(mg, 0).x - t.x) >= 12 || Math.abs(pl(mg, 0).y - t.y) >= 22, 'pushed out of the table');
});

test('players stay inside the arena', () => {
  const mg = away(init());
  for (let i = 0; i < 300; i++) hostStep(mg, { 0: frame({ move: { x: -1, y: -1 } }), 1: frame({ move: { x: 1, y: 1 } }) }, DT);
  for (const p of mg.ps) assert.ok(p.x >= ARENA.x0 && p.x <= ARENA.x1 && p.y >= ARENA.y0 && p.y <= ARENA.y1);
});

test('hostResult: more seats wins; the team gets one group; equal seats is a draw; every seat appears once', () => {
  const mg = init();
  mg.o.fill(-1);
  assert.deepEqual(hostResult(mg).placements, [[0, 1, 2, 3]], 'nothing claimed: draw');
  mg.o[0] = 1; mg.o[1] = 1; mg.o[2] = 0;
  const r = hostResult(mg);
  assert.deepEqual(r.placements, [[1, 3], [0, 2]]);
  assert.match(r.labels[1], /Team Blau: 2/);
  assert.deepEqual(r.placements.flat().sort(), [0, 1, 2, 3]);
  mg.o[2] = 1; mg.o[3] = 0; mg.o[4] = 0; mg.o[5] = 0; mg.o[6] = 0;
  assert.deepEqual(hostResult(mg).placements, [[0, 2], [1, 3]]);
  const six = hostInit({ seats: [0, 1, 2, 3, 4, 5], seed: 1, rng: createRng(1), mode: 'team', teams: [[0, 3, 4], [1, 2, 5]] });
  six.o[0] = 1;
  assert.deepEqual(hostResult(six).placements, [[1, 2, 5], [0, 3, 4]]);
});

test('bots: a full 4-bot and 6-bot game ends, claims a good part of the carriage and is not always a draw', () => {
  const results = [];
  for (let seed = 1; seed <= 6; seed++) {
    const mg = playBots([0, 1, 2, 3], TEAMS4, seed);
    assert.equal(mg.done, true);
    const [a, b] = counts(mg);
    assert.ok(a + b >= SEAT_COUNT * 0.6, `seed ${seed}: only ${a + b} of ${SEAT_COUNT} claimed`);
    results.push(hostResult(mg).placements.length);
  }
  assert.ok(results.includes(2), 'at least one decisive game');
  const six = playBots([0, 1, 2, 3, 4, 5], [[0, 2, 4], [1, 3, 5]], 3);
  assert.equal(six.done, true);
  assert.equal(hostResult(six).placements.flat().length, 6);
});

test('a team of bots beats two idle players', () => {
  const seats = [0, 1, 2, 3];
  const mg = init(seats, TEAMS4, 5);
  const rngs = { 0: createRng(1), 2: createRng(2) }, mems = { 0: {}, 2: {} };
  for (let i = 0; i < 3000 && !mg.done; i++) hostStep(mg, { 0: botFrame(mg, 0, rngs[0], mems[0]), 2: botFrame(mg, 2, rngs[2], mems[2]) }, DT);
  const [a, b] = counts(mg);
  assert.ok(a > b + 10, `${a} vs ${b}`);
  assert.deepEqual(hostResult(mg).placements[0], [0, 2]);
});
