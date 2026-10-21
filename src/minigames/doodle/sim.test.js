import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../contracts.js';
import { W, H, C, STEP, DURATION_MS, makeCourse, newState, launch, step, newBot, botControl, heightM, fmtM, wrapDelta, platX } from './sim.js';
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

// ---- softlock: a breaking platform must never take progress away
const JUMP = (C.V_BOUNCE ** 2) / (2 * C.G);

test('landing on a breaking platform always bounces up (a bit stronger), then it breaks', () => {
  let tested = 0;
  for (let seed = 1; seed <= 40; seed++) {
    for (let which = 0; which < 3; which++) {
      const course = makeCourse(createRng(seed));   // a fresh course each time: the follow-up bounces must not break the other ones
      course.ensure(-4000);
      const p = course.plats.filter((q) => q.type === 'crumble')[which];
      if (!p) continue;
      course.items.length = 0;   // no Club-Mate / gull / drone next to it: this is about the platform only
      course.gulls.length = 0; course.drones.length = 0;
      const st = newState(course);
      st.started = true; st.t = 5; st.x = platX(p, st.t); st.y = p.y - 3; st.vy = 300; st.camY = p.y - 400; st.maxH = -p.y;
      step(st, course, 0);
      assert.equal(st.vy, -C.V_CRUMBLE, 'normal-or-better bounce, no fall-through');
      assert.ok(C.V_CRUMBLE >= C.V_BOUNCE);
      assert.ok(st.ev.includes('crumble'));
      assert.ok(p.broke >= 0, 'it breaks AFTER the bounce');
      let top = st.y;
      for (let i = 0; i < 60; i++) { step(st, course, 0); top = Math.min(top, st.y); }
      assert.ok(top < p.y - JUMP + 5, `moved up (apex ${top} vs platform ${p.y})`);
      tested++;
    }
  }
  assert.ok(tested >= 40, `${tested} crumble landings tested`);
});

test('course: the non-breaking platforms always form a chain of normal jumps; every breaking one has a normal platform within jump height above it', () => {
  let crumbles = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const c = makeCourse(createRng(seed));
    c.ensure(-9000);
    const solids = c.plats.filter((p) => p.type !== 'crumble');
    for (let i = 1; i < solids.length; i++) {
      assert.ok(solids[i - 1].y - solids[i].y < JUMP - 20, `seed ${seed}: solid gap ${solids[i - 1].y - solids[i].y}`);
      assert.ok(Math.abs(wrapDelta(solids[i - 1].x, solids[i].x)) <= 245, `seed ${seed}: solid dx`);
    }
    for (let i = 1; i < c.plats.length; i++) assert.ok(c.plats[i - 1].y > c.plats[i].y, 'sorted by y (the client culls by binary search)');
    c.plats.forEach((p, i) => {
      if (p.type !== 'crumble') return;
      crumbles++;
      const above = c.plats.slice(i + 1).find((q) => q.type !== 'crumble');
      assert.ok(above, `seed ${seed}: a normal platform follows`);
      assert.ok(p.y - above.y < JUMP - 20, `seed ${seed}: reachable from the breaking one`);
      assert.ok(Math.abs(wrapDelta(p.x, above.x)) <= 245, `seed ${seed}: reachable sideways`);
    });
  }
  assert.ok(crumbles > 300, `${crumbles} breaking platforms in 200 seeds`);
});

test('safety net: below the screen with nothing to land on -> respawn on a normal platform, short invulnerable flash, no score loss', () => {
  const course = makeCourse(createRng(4));
  course.ensure(-3000);
  const st = newState(course);
  launch(st);
  st.y = -1500; st.camY = -1800; st.maxH = 1500; st.t = 9; st.vy = 600;
  for (const p of course.plats) if (p.type === 'crumble') p.broke = 1;   // every Pappe has broken
  st.y = st.camY + H + C.FALL_MARGIN + 30;                            // fell out of the screen
  step(st, course, 0);
  assert.equal(st.falls, 1);
  assert.ok(st.ev.includes('fall'));
  assert.ok(st.inv > 1, 'invulnerable flash');
  assert.ok(st.vy < 0, 'bounces right away');
  assert.equal(st.maxH, 1500, 'score untouched');
  assert.ok(course.plats.every((p) => p.type !== 'crumble' || p.broke < 0), 'broken Pappe is whole again');
  assert.ok(course.plats.some((p) => p.type !== 'crumble' && Math.abs(p.y - st.y) < 1e-6), 'stands on a normal platform');
  assert.ok(-st.y <= st.maxH - C.PENALTY_PX + 1);
});

test('nobody is ever stuck: even with every breaking platform already gone, a perfect bot keeps climbing', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const course = makeCourse(createRng(seed));
    course.ensure(-9000);
    for (const p of course.plats) if (p.type === 'crumble') p.broke = 0;   // all gone as soon as t > CRUMBLE_S
    const st = newState(course), bot = newBot(createRng(seed));
    launch(st);
    for (let i = 0; i < 60 * 20; i++) { step(st, course, botControl(st, course, bot, 0)); st.ev.length = 0; }
    assert.ok(heightM(st) > 150, `seed ${seed}: ${heightM(st)} m`);
  }
});
