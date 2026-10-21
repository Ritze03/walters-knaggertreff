import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../contracts.js';
import { makeSchedule, judgePress, posAt, SLOT_X, DURATION_MS, euro, isGood, FIRST_T, HALF } from './seq.js';

test('schedule is deterministic, ordered, fits the duration, starts with a good item', () => {
  const a = makeSchedule(createRng(7)), b = makeSchedule(createRng(7)), c = makeSchedule(createRng(8));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(a.length >= 22 && a.length <= 60, `items: ${a.length}`);
  assert.equal(a[0].T, FIRST_T);
  assert.ok(isGood(a[0]));
  for (let i = 1; i < a.length; i++) assert.ok(a[i].T > a[i - 1].T + 250);
  assert.ok(a.at(-1).T < DURATION_MS - 1000);
  assert.ok(a.at(-1).v > a[0].v);
});

test('mix of good, junk and the odd crate over many seeds', () => {
  let good = 0, junk = 0, crate = 0;
  for (let s = 1; s <= 50; s++) for (const it of makeSchedule(createRng(s))) { if (it.kind === 'crate') crate++; else if (isGood(it)) good++; else junk++; }
  assert.ok(good > junk && junk > 0 && crate > 0, `${good}/${junk}/${crate}`);
});

test('press judging: window, early/late, junk, crate centre', () => {
  const good = { id: 0, kind: 'glass', T: 1000, v: 300 }, junk = { id: 1, kind: 'sock', T: 2000, v: 300 }, crate = { id: 2, kind: 'crate', T: 4000, v: 300 };
  assert.equal(posAt(good, 1000), SLOT_X);
  assert.equal(judgePress([good, junk], 1000).kind, 'feed');
  assert.equal(judgePress([good, junk], 1000).perfect, true);
  assert.equal(judgePress([good, junk], 1100).kind, 'feed');        // 30 px
  assert.equal(judgePress([good, junk], 700).kind, 'feed');         // 90 px early: the window is 100 px each side now
  assert.deepEqual(judgePress([good, junk], 650).reason, 'early');  // 105 px before the window
  assert.deepEqual(judgePress([good, junk], 1400).reason, 'late');  // 120 px after
  assert.equal(judgePress([good], 1900).reason, 'empty');           // 270 px past it, nothing else near
  assert.equal(judgePress([junk], 2000).kind, 'wrong');
  assert.equal(judgePress([crate], 4000).kind, 'feed');
  assert.equal(judgePress([crate], 3850).kind, 'feed');             // 45 px off centre: inside the crate window (52 px)
  assert.equal(judgePress([crate], 3700).reason, 'crate');          // 90 px off centre: still inside the big crate body
  assert.equal(judgePress([], 5000).reason, 'empty');
});

test('euro label uses the German decimal comma', () => {
  assert.equal(euro(375), '3,75 €');
  assert.equal(euro(0), '0,00 €');
  assert.equal(euro(25), '0,25 €');
});

test('a perfect-ish human (every press within 60% of the window, junk left alone) hits at least 80% of the good items', () => {
  const rng = createRng(99);
  let good = 0, fed = 0, wrong = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const items = makeSchedule(createRng(seed));
    for (const it of items) {
      if (!isGood(it) && it.kind !== 'crate') continue;
      good++;
      const half = it.kind === 'crate' ? HALF.crate : HALF.normal;
      const off = (rng.next() * 2 - 1) * 0.6 * half;                     // px off centre
      const t = it.T + (off / it.v) * 1000;
      const r = judgePress(items.filter((o) => Math.abs(posAt(o, t) - SLOT_X) < 400), t);
      if (r.kind === 'feed' && r.item.id === it.id) fed++; else if (r.kind === 'wrong') wrong++;
    }
  }
  assert.ok(fed / good >= 0.8, `${fed}/${good} fed, ${wrong} wrong`);
});
