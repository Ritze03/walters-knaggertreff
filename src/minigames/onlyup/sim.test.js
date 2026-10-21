import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../contracts.js';
import { C, DURATION_MS, BOT_NOISE, makeCourse, newState, step, botControl, over, supportBelow } from './sim.js';

/** plays `sec` seconds with the bot; returns { st, falls, summitAt (s or null), course } */
function play(seed, noise, sec = DURATION_MS / 1000) {
  const course = makeCourse(createRng(seed));
  const st = newState(course);
  const bot = { rng: createRng(seed * 7 + 1) };
  let falls = 0, summitAt = null;
  for (let i = 0; i < sec / C.DT && !st.done; i++) {
    const c = botControl(st, course, bot, noise);
    for (const e of step(st, course, c)) { if (e.type === 'splat') falls++; if (e === 'summit') summitAt = st.t; }
  }
  return { st, falls, summitAt, course };
}

test('the course is deterministic per seed and differs between seeds', () => {
  const a = makeCourse(createRng(5)), b = makeCourse(createRng(5)), c = makeCourse(createRng(6));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.plats.map((p) => p.x), c.plats.map((p) => p.x));
  assert.equal(a.plats.length, C.N);
  assert.ok(a.top > 28 && a.top < 48, `summit at ${a.top}`);
});

test('platforms climb monotonically with reachable steps', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { plats } = makeCourse(createRng(seed));
    for (let i = 1; i < plats.length; i++) {
      const dy = plats[i].top - plats[i - 1].top;
      assert.ok(dy >= 1.2 && dy <= 1.8, `seed ${seed} step ${i}: dy ${dy}`);
      assert.ok(Math.hypot(plats[i].x - plats[i - 1].x, plats[i].z - plats[i - 1].z) < 7, `seed ${seed} step ${i}: too far apart`);
    }
  }
});

test('a clean bot (noise 0) reaches the summit in time on many seeds', () => {
  const times = [];
  for (let seed = 1; seed <= 30; seed++) {
    const r = play(seed, 0);
    assert.ok(r.st.done, `seed ${seed}: stuck at ${r.st.best.toFixed(1)} of ${r.course.top.toFixed(1)} m`);
    times.push(r.summitAt);
  }
  const max = Math.max(...times);
  assert.ok(max < 28, `slowest clean climb ${max.toFixed(1)} s`);
});

test('a noisy bot is slower, sometimes falls, and results differ', () => {
  const runs = Array.from({ length: 20 }, (_, i) => play(i + 1, BOT_NOISE));
  const falls = runs.reduce((s, r) => s + r.falls, 0);
  const bests = new Set(runs.map((r) => r.st.best.toFixed(1)));
  assert.ok(falls > 5, `only ${falls} falls over 20 runs`);
  assert.ok(runs.filter((r) => !r.st.done).length >= 4, 'noisy bots should often miss the summit');
  assert.ok(runs.filter((r) => r.st.best >= 15).length >= 10, 'noisy bots should still climb a good way');
  assert.ok(bests.size > 5);
});

test('falling costs height: stepping off drops you to the platform or ground below', () => {
  const course = makeCourse(createRng(3));
  const st = newState(course);
  const p = course.plats[1];
  Object.assign(st, { x: p.x, z: p.z, y: p.top, grounded: true, on: 1, stand: p.top });
  for (let i = 0; i < 600; i++) step(st, course, { dx: 0, dz: 0, jump: false });
  assert.ok(st.grounded && st.y === p.top, 'stays on its platform when idle');
  for (let i = 0; i < 2000 && st.on === 1; i++) step(st, course, { dx: 1, dz: 0, jump: false });
  for (let i = 0; i < 600; i++) step(st, course, { dx: 0, dz: 0, jump: false });
  assert.ok(st.grounded && st.y < p.top, `landed lower: ${st.y} < ${p.top}`);
});

test('coyote time and jump buffer forgive late and early presses', () => {
  const course = makeCourse(createRng(3));
  const p = course.plats[0];
  // late jump right after leaving the edge
  const s = newState(course);
  Object.assign(s, { x: p.x, z: p.z, y: p.top, grounded: false, on: -1, coyote: C.COYOTE });
  assert.ok(step(s, course, { dx: 0, dz: 0, jump: true }).includes('jump'));
  // early press in the air is buffered and fires on landing
  const t = newState(course);
  Object.assign(t, { x: p.x, z: p.z, y: p.top + 0.2, vy: -3, grounded: false, on: -1, stand: p.top });
  let jumped = false;
  step(t, course, { dx: 0, dz: 0, jump: true });
  for (let i = 0; i < 60 && !jumped; i++) jumped = step(t, course, { dx: 0, dz: 0, jump: false }).includes('jump');
  assert.ok(jumped, 'buffered jump fires on landing');
});

test('over() and supportBelow() agree with landing', () => {
  const course = makeCourse(createRng(9));
  const p = course.plats[4];
  assert.ok(over(p, p.x, p.z));
  assert.ok(!over(p, p.x + 20, p.z));
  assert.equal(supportBelow(course, p.x, p.z, p.top + 3), p.top);
  assert.equal(supportBelow(course, 23, 0, 50), 0);
});

test('state stays plain JSON', () => {
  const r = play(2, BOT_NOISE, 5);
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(r.st))), JSON.stringify(r.st));
});
