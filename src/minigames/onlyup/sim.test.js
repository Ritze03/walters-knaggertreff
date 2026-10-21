import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../contracts.js';
import { C, DURATION_MS, BOT_NOISE, makeCourse, newState, step, botControl, over, supportBelow, angDiff } from './sim.js';

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

// ---- controls: only left / right + jump; the depth axis is automatic (assistMove)
import { assistMove } from './sim.js';

test('assistMove: no input = no movement; right is clockwise round the tower and the radial part pulls onto the route', () => {
  const course = makeCourse(createRng(4));
  const st = newState(course);
  assert.deepEqual(assistMove(st, course, 0), { dx: 0, dz: 0 });
  const p = course.plats[2];
  Object.assign(st, { x: p.x, z: p.z, y: p.top, grounded: true, on: 2, ref: 2, stand: p.top });
  const th = Math.atan2(st.z, st.x), cw = { x: Math.sin(th), z: -Math.cos(th) };
  const m = assistMove(st, course, 1), l = assistMove(st, course, -1);
  assert.ok(m.dx * cw.x + m.dz * cw.z > 0.95, 'right = clockwise');
  assert.ok(l.dx * cw.x + l.dz * cw.z < -0.95, 'left = counter-clockwise');
  assert.ok(Math.hypot(m.dx, m.dz) <= 1.0001);
  // pushed 1.5 m outwards of the route: holding right also moves it inwards; pushed inwards, outwards
  const r0 = Math.hypot(p.x, p.z);
  Object.assign(st, { x: Math.cos(th) * (r0 + 1.5), z: Math.sin(th) * (r0 + 1.5) });
  const out = assistMove(st, course, 1);
  assert.ok(out.dx * Math.cos(th) + out.dz * Math.sin(th) < -0.3, 'pulled inwards');
  Object.assign(st, { x: Math.cos(th) * (r0 - 1.0), z: Math.sin(th) * (r0 - 1.0) });
  const inn = assistMove(st, course, 1);
  assert.ok(inn.dx * Math.cos(th) + inn.dz * Math.sin(th) > 0.3, 'pulled outwards');
  // a half stick is a half speed
  assert.ok(Math.hypot(assistMove({ ...st, x: p.x, z: p.z }, course, 0.5).dx, assistMove({ ...st, x: p.x, z: p.z }, course, 0.5).dz) < 0.55);
});

/** a "player": holds right (D) all the time and presses jump at the last moment before running off the platform it stands on. No depth input at all. */
function holdRight(seed, sec) {
  const course = makeCourse(createRng(seed));
  const st = newState(course);
  let jumped = false;
  for (let i = 0; i < sec / C.DT && !st.done; i++) {
    const cur = st.on >= 0 ? course.plats[st.on] : null;
    const edge = st.grounded && (!cur || !over(cur, st.x + st.vx * 0.09, st.z + st.vz * 0.09, -0.1));
    const jump = st.grounded && edge && !jumped;
    jumped = jump;
    step(st, course, { axis: 1, jump });
  }
  return { st, course };
}

test('with only right + jump (no depth input) a runner climbs well past platform 5 on every seed', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const { st, course } = holdRight(seed, 25);
    assert.ok(st.bestOn >= 5, `seed ${seed}: only reached platform ${st.bestOn} (${st.best.toFixed(1)} of ${course.top.toFixed(1)} m)`);
  }
});

test('steering along a platform keeps the blob on the line through the platform centre (no sideways drift off narrow benches)', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const course = makeCourse(createRng(seed));
    for (const i of [1, 3, 6, 9]) {
      const p = course.plats[i];
      // start 0.6 m counter-clockwise of the centre and 0.5 m too far out, hold right while still on the platform
      const th = Math.atan2(p.z, p.x) + 0.6 / p.rad, r0 = p.rad + 0.5;
      const st = newState(course);
      Object.assign(st, { x: Math.cos(th) * r0, z: Math.sin(th) * r0, y: p.top, grounded: true, on: i, ref: i, stand: p.top });
      let worst = 0;
      for (let k = 0; k < 0.4 / C.DT && st.on === i; k++) {
        step(st, course, { axis: 1, jump: false });
        if (st.on === i && k > 0.15 / C.DT && Math.abs(angDiff(Math.atan2(st.z, st.x), p.ang)) * p.rad < 0.6 * p.e) worst = Math.max(worst, Math.abs(Math.hypot(st.x, st.z) - p.rad));
      }
      assert.ok(worst < 0.35, `seed ${seed} platform ${i}: ${worst.toFixed(2)} m off the line after the first 0.15 s`);
    }
  }
});
