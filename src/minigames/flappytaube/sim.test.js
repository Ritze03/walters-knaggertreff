import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../contracts.js';
import { makeCourse, createRun, step, score, labelOf, STEP, GROUND, rectsOf, KINDS } from './sim.js';
import { createBot } from './bot.js';

const play = (seed, who) => {
  const course = makeCourse(createRng(seed));
  const st = createRun(course);
  const bot = createBot(createRng(who * 7919 + seed));
  let pending = false, frames = 0;
  while (!st.dead && !st.done && frames++ < 60 * 40) {
    step(st, pending, STEP);
    pending = bot(st, STEP);   // reaches the sim one step late
  }
  return st;
};

test('course is deterministic and sane', () => {
  const a = makeCourse(createRng(5)), b = makeCourse(createRng(5)), c = makeCourse(createRng(6));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  for (const o of a.obs) {
    assert.ok(o.c - o.h / 2 >= 89 && o.c + o.h / 2 <= GROUND - 89, 'gap keeps clear of floor/ceiling');
    assert.ok(o.kind >= 0 && o.kind < KINDS.length);
  }
  for (let i = 1; i < a.obs.length; i++) assert.ok(a.obs[i].x - a.obs[i - 1].x >= 319);
  assert.ok(a.crumbs.length > 10);
});

test('gap centre is never inside a collision rect', () => {
  for (const o of makeCourse(createRng(9)).obs) for (const r of rectsOf(o)) assert.ok(!(r[0] < o.x && r[2] > o.x && r[1] < o.c && r[3] > o.c));
});

test('falling without flapping hits the ground; flapping blindly ends the run', () => {
  const st = createRun(makeCourse(createRng(1)));
  let ev = [];
  for (let i = 0; i < 400 && !st.dead; i++) ev = step(st, false);
  assert.ok(st.dead && st.hit === -1 && ev.includes('crash'));
  const s2 = createRun(makeCourse(createRng(1)));
  for (let i = 0; i < 60 * 40 && !s2.dead && !s2.done; i++) step(s2, i % 15 === 0);
  assert.ok(s2.dead || s2.done);
});

test('score and label', () => {
  const st = createRun(makeCourse(createRng(1)));
  st.gaps = 14; st.crumbs = 0;
  assert.equal(labelOf(st), '14 Lücken'); assert.equal(score(st), 42);
  st.crumbs = 3;
  assert.equal(labelOf(st), '14 Lücken + 3 Krümel'); assert.equal(score(st), 45);
});

test('bot flies a while but crashes at varying points', () => {
  const gaps = [];
  for (let seed = 1; seed <= 6; seed++) for (let who = 0; who < 6; who++) gaps.push(play(seed, who).gaps);
  console.log('bot gaps:', gaps.join(','));
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  assert.ok(avg >= 4, `avg ${avg}`);
  assert.ok(new Set(gaps).size >= 5, 'varied outcomes');
});
