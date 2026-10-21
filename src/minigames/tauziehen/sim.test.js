import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../contracts.js';
import { hostInit, hostStep, hostResult, makeBot, C, DURATION_MS, LINE } from './sim.js';

const DT = 1000 / 60;
const TEAMS = [[0, 2], [1, 3]];
const init = (teams = TEAMS, seed = 5) => hostInit({ seats: teams.flat().sort(), seed, rng: createRng(seed), mode: 'team', teams });
const tap = (b) => ({ move: { x: 0, y: 0 }, jump: false, action: false, confirm: false, back: false, pressed: { jump: b === 'jump', action: b === 'action', confirm: false, back: false } });

/** every seat in `rates` (Hz, alternating buttons) presses for `ms`; others idle */
function mash(mg, rates, ms, { alternate = true } = {}) {
  const acc = {}, last = {};
  for (let i = 0; i < Math.ceil(ms / DT) && !mg.done; i++) {
    const inputs = {};
    for (const [s, hz] of Object.entries(rates)) {
      acc[s] = (acc[s] ?? 0) + hz * DT / 1000;
      if (acc[s] >= 1) { acc[s] -= 1; last[s] = alternate && last[s] !== 'jump' ? 'jump' : alternate ? 'action' : 'jump'; inputs[s] = tap(last[s]); }
    }
    hostStep(mg, inputs, DT);
  }
  return mg;
}

function playBots(teams, seed, ms = DURATION_MS + 1000) {
  const mg = init(teams, seed), seats = teams.flat();
  const bots = Object.fromEntries(seats.map((s) => [s, makeBot(createRng(seed * 31 + s))]));
  for (let i = 0; i < Math.ceil(ms / DT) && !mg.done; i++) {
    const inputs = {};
    for (const s of seats) { const b = bots[s].tick(DT); if (b) inputs[s] = tap(b); }
    hostStep(mg, inputs, DT);
  }
  return mg;
}

test('hostInit uses the given teams; falls back to an even split', () => {
  const mg = init([[0, 3], [1, 2]]);
  assert.deepEqual(mg.ps.map((p) => [p.s, p.tm]), [[0, 0], [1, 1], [2, 1], [3, 0]]);
  const fb = hostInit({ seats: [0, 1, 2, 3], seed: 1, rng: createRng(1), mode: 'team', teams: null });
  assert.deepEqual(fb.ps.map((p) => p.tm), [0, 0, 1, 1]);
});

test('the sim is deterministic and its state is plain JSON with t + done', () => {
  const a = playBots(TEAMS, 11), b = playBots(TEAMS, 11);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  assert.equal(typeof a.t, 'number');
  assert.equal(typeof a.done, 'boolean');
});

test('nobody pulling: the crate stays put and the game ends by the timer as a draw', () => {
  const mg = init();
  for (let i = 0; i < 2000 && !mg.done; i++) hostStep(mg, {}, DT);
  assert.equal(mg.done, true);
  assert.ok(mg.t >= DURATION_MS && mg.t < DURATION_MS + 2 * DT);
  assert.equal(mg.pos, 0);
  assert.deepEqual(hostResult(mg).placements, [[0, 1, 2, 3]]);
  const t = mg.t;
  hostStep(mg, {}, DT);
  assert.equal(mg.t, t, 'a finished game does not advance');
});

test('team 1 pulling moves the crate toward +, team 0 toward -', () => {
  const a = mash(init(), { 1: 8, 3: 8 }, 2000);
  assert.ok(a.pos > 10, `pos=${a.pos}`);
  const b = mash(init(), { 0: 8, 2: 8 }, 2000);
  assert.ok(b.pos < -10, `pos=${b.pos}`);
});

test('evenly matched teams hold the rope still', () => {
  const mg = mash(init(), { 0: 8, 1: 8, 2: 8, 3: 8 }, 5000);
  assert.ok(Math.abs(mg.pos) < 1, `pos=${mg.pos}`);
});

test('alternating the two buttons beats hammering one', () => {
  const alt = mash(init(), { 0: 8 }, 3000), same = mash(init(), { 0: 8 }, 3000, { alternate: false });
  assert.ok(alt.pos < same.pos - 5, `alt ${alt.pos} vs same ${same.pos}`);
  assert.ok(same.pos < 0, 'single-button mashing still pulls');
});

test('stamina: sustained mashing tires, a rest refills', () => {
  const mg = mash(init(), { 0: 12, 1: 12 }, 12000);   // both teams, so the rope holds and nobody wins early
  const p = mg.ps.find((q) => q.s === 0);
  assert.ok(p.st < C.TIRED + 0.05, `st=${p.st}`);
  assert.ok(p.pw < 3.3, 'tired pull is weaker than a fresh player at the same rate');
  const fresh = mash(init(), { 0: 12, 1: 12 }, 1500).ps.find((q) => q.s === 0);
  assert.ok(fresh.pw > p.pw);
  for (let i = 0; i < 300; i++) hostStep(mg, {}, DT);
  assert.ok(mg.ps.find((q) => q.s === 0).st > 0.9);
});

test('presses faster than MIN_GAP_MS are ignored (autoclicker cap)', () => {
  const mg = init();
  for (let i = 0; i < 60; i++) hostStep(mg, { 0: { pressed: { jump: i % 2 === 0, action: i % 2 === 1 } } }, DT);   // one press per frame = 60 Hz
  const p = mg.ps.find((q) => q.s === 0);
  assert.ok(p.n <= 1000 / C.MIN_GAP_MS + 1, `n=${p.n}`);
  assert.ok(p.n >= 10);
});

test('crossing the line ends the game at once and the whole team wins', () => {
  const mg = mash(init(), { 0: 9, 2: 9 }, 19000);
  assert.equal(mg.done, true);
  assert.equal(mg.win, 0);
  assert.equal(mg.pos, -LINE);
  assert.ok(mg.t < DURATION_MS);
  const r = hostResult(mg);
  assert.deepEqual(r.placements, [[0, 2], [1, 3]]);
  assert.match(r.labels[0], /^Gewonnen/);
  assert.match(r.labels[1], /^Verloren/);
});

test('timer end: the crate side decides', () => {
  const mg = init();
  mash(mg, { 1: 6 }, 3000);               // pulls a bit toward +
  mash(mg, { 0: 4 }, 100);                // nobody wins by the line yet
  assert.equal(mg.done, false);
  mg.t = DURATION_MS - 1;
  hostStep(mg, {}, DT);
  assert.equal(mg.done, true);
  assert.equal(mg.win, 1);
  assert.deepEqual(hostResult(mg).placements, [[1, 3], [0, 2]]);
});

test('hostResult also works on a not-yet-done state (hard cap)', () => {
  const mg = mash(init(), { 0: 8 }, 1500);
  assert.equal(mg.done, false);
  assert.deepEqual(hostResult(mg).placements, [[0, 2], [1, 3]]);
});

test('3v3 works too and a disconnected seat (no input) is just idle', () => {
  const mg = init([[0, 2, 4], [1, 3, 5]]);
  mash(mg, { 0: 8, 2: 8, 4: 8, 1: 8, 3: 8 }, 6000);   // seat 5 never presses
  assert.ok(mg.pos < -5, `pos=${mg.pos}`);
});

test('bots: 6-10 Hz-ish, pulsed, and a full bot game finishes with a legal result', () => {
  const bot = makeBot(createRng(3));
  let presses = 0, held = 0;
  for (let i = 0; i < 60 * 20; i++) { if (bot.tick(DT)) { presses++; held = Math.max(held, 1); } }
  const hz = presses / 20;
  assert.ok(hz > 4 && hz < 11, `bot rate ${hz} Hz`);
  for (const seed of [1, 2, 3, 4, 5]) {
    const mg = playBots(TEAMS, seed);
    assert.equal(mg.done, true, `seed ${seed}`);
    const r = hostResult(mg);
    assert.equal(r.placements.flat().length, 4);
    assert.deepEqual([...r.placements.flat()].sort(), [0, 1, 2, 3]);
  }
});

test('bot games are not always the same winner', () => {
  const wins = new Set();
  for (let seed = 1; seed <= 12; seed++) wins.add(playBots(TEAMS, seed).win);
  assert.ok(wins.size >= 2, `winners ${[...wins]}`);
});
