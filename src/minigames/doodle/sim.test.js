import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../contracts.js';
import { W, C, STEP, DURATION_MS, makeCourse, newState, launch, step, newBot, botControl, heightM, fmtM, wrapDelta } from './sim.js';
import LINES from './lines.js';

function play(seed, botSeed = seed, noise) {
  const course = makeCourse(createRng(seed));
  const st = newState(course);
  const bot = newBot(createRng(botSeed));
  launch(st);
  for (let i = 0; i < Math.round(DURATION_MS / 1000 / STEP); i++) { step(st, course, botControl(st, course, bot, noise)); st.ev.length = 0; }
  return st;
}

test('course is identical for the same seed, independent of how far it was generated', () => {
  const a = makeCourse(createRng(5)), b = makeCourse(createRng(5));
  a.ensure(-6000);
  b.ensure(-3000); b.ensure(-6000);
  const n = Math.min(a.plats.length, b.plats.length);
  assert.ok(n > 30);
  for (let i = 0; i < n; i++) assert.deepEqual(a.plats[i], b.plats[i]);
  assert.notDeepEqual(makeCourse(createRng(6)).plats[3], a.plats[3]);
});

test('every platform gap is jumpable', () => {
  const c = makeCourse(createRng(11));
  c.ensure(-9000);
  for (let i = 1; i < c.plats.length; i++) assert.ok(c.plats[i - 1].y - c.plats[i].y < (C.V_BOUNCE ** 2) / (2 * C.G) - 20);
});

test('wrapDelta is the short way around', () => {
  assert.equal(wrapDelta(10, W - 10), -20);
  assert.equal(wrapDelta(W - 10, 10), 20);
});

test('bouncing: the blob rises ~168 px per bounce and the screen wraps', () => {
  const course = makeCourse(createRng(1));
  const st = newState(course);
  launch(st);
  let minY = 0;
  for (let i = 0; i < 60; i++) { step(st, course, 0); minY = Math.min(minY, st.y); }
  assert.ok(minY < -160 && minY > -175, `apex ${minY}`);
  st.x = 5;
  for (let i = 0; i < 20; i++) step(st, course, -1);
  assert.ok(st.x > W / 2, 'wrapped to the right edge');
});

test('standing still eventually falls and respawns with a penalty, run keeps its best height', () => {
  const course = makeCourse(createRng(2));
  const st = newState(course);
  launch(st);
  const bot = newBot(createRng(2));
  for (let i = 0; i < 600; i++) step(st, course, botControl(st, course, bot, 0));
  const best = st.maxH;
  assert.ok(best > 400);
  for (let i = 0; i < 60 * 8 && !st.falls; i++) step(st, course, 1);   // run into the void
  assert.ok(st.falls >= 1);
  assert.ok(st.maxH >= best);
  assert.ok(-st.y <= st.maxH - C.PENALTY_PX + 1, 'restarted lower than the best height');
});

test('bots climb, deterministically, and some of them fall (spread of results)', () => {
  const res = [];
  for (let s = 1; s <= 12; s++) res.push(play(s));
  const hs = res.map(heightM);
  console.log('doodle bot heights (m):', hs.map(Math.round).join(' '), '| falls:', res.map((r) => r.falls).join(' '), '| hits:', res.map((r) => r.hits).join(' '));
  assert.deepEqual(heightM(play(3)), heightM(res[2]));
  assert.ok(Math.min(...hs) > 150, 'every bot gets somewhere');
  assert.ok(Math.max(...hs) < 2500);
  assert.ok(res.some((r) => r.falls > 0), 'the noisy bot sometimes misses');
  assert.ok(res.filter((r) => r.falls === 0).length >= 2, 'but not always');
  assert.ok(new Set(hs.map(Math.round)).size >= 8, 'scores spread');
});

test('a perfect bot is faster than a sloppy one', () => {
  let perfect = 0, sloppy = 0;
  for (let s = 1; s <= 6; s++) { perfect += heightM(play(s, s, 0)); sloppy += heightM(play(s, s, 70)); }
  assert.ok(perfect > sloppy);
});

test('score label has the German thousands dot', () => {
  assert.equal(fmtM(123.9), '123 m');
  assert.equal(fmtM(999), '999 m');
  assert.equal(fmtM(1234.5), '1.234 m');
  assert.equal(fmtM(12345), '12.345 m');
});

test('lines.js: pure data, German, short', () => {
  for (const [key, arr] of Object.entries(LINES)) {
    assert.ok(Array.isArray(arr) && arr.length > 0, key);
    for (const s of arr) { assert.equal(typeof s, 'string'); assert.ok(s.length <= 60, s); assert.ok(!/[\[\]]/.test(s), s); }
  }
});
