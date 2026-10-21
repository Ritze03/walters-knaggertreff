import test from 'node:test';
import assert from 'node:assert/strict';
import { MG_VIEW, SCREEN } from '../contracts.js';
import { fitView, gridLayout, soloLayout, spectatorLayout } from './layout.js';

const inside = (r, w, h) => r.x >= -0.001 && r.y >= -0.001 && r.x + r.w <= w + 0.001 && r.y + r.h <= h + 0.001;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('solo layout: 1-5 other lanes fit on screen, never overlap the main lane or each other', () => {
  for (let n = 1; n <= 5; n++) {
    const { main, thumbs } = soloLayout(n);
    assert.equal(thumbs.length, n);
    assert.ok(inside(main, SCREEN.w, SCREEN.h), `main n=${n}`);
    const rects = [main, ...thumbs];
    rects.forEach((r) => assert.ok(inside(r, SCREEN.w, SCREEN.h) && r.scale > 0.1, `n=${n} ${JSON.stringify(r)}`));
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) assert.ok(!overlap(rects[i], rects[j]), `n=${n}: ${i} overlaps ${j}`);
  }
});

test('thumbnails are big enough to read (>= 0.15)', () => {
  for (let n = 1; n <= 5; n++) assert.ok(soloLayout(n).thumbs[0].scale >= 0.15, `n=${n}`);
});

test('spectator layout: 2 duel lanes side by side, 6 lanes in a grid', () => {
  const two = spectatorLayout(2);
  assert.ok(two[1].x > two[0].x + two[0].w - 1 && Math.abs(two[0].y - two[1].y) < 1);
  const six = spectatorLayout(6);
  six.forEach((r) => assert.ok(inside(r, SCREEN.w, SCREEN.h)));
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) assert.ok(!overlap(six[i], six[j]));
});

test('gridLayout with 0 boxes is empty', () => assert.deepEqual(gridLayout(0, { x: 0, y: 0, w: 100, h: 100 }, MG_VIEW.solo), []));

test('reserveTop keeps the sound widget corner free: no thumbnail cell (name tag) starts above it, nothing overlaps or leaves the screen', () => {
  for (let n = 1; n <= 5; n++) {
    const { main, thumbs } = soloLayout(n, MG_VIEW.solo, SCREEN, { reserveTop: 70 });
    thumbs.forEach((t) => { assert.ok(t.cell.y >= 70 && inside(t, SCREEN.w, SCREEN.h) && t.scale >= 0.15, `n=${n}`); assert.ok(!overlap(main, t)); });
  }
  spectatorLayout(6, MG_VIEW.solo, SCREEN, { reserveTop: 70 }).forEach((r) => assert.ok(r.cell.y >= 70 && inside(r, SCREEN.w, SCREEN.h)));
  assert.equal(soloLayout(3).thumbs[0].cell.y, 12, 'no reserve: unchanged');
});

test('fitView letterboxes the 1280x720 view into a DOM box', () => {
  assert.deepEqual(fitView({ left: 0, top: 0, width: 960, height: 540 }), { s: 0.75, ox: 0, oy: 0 });
  const wide = fitView({ left: 10, top: 0, width: 1600, height: 720 });   // pillarbox
  assert.equal(wide.s, 1); assert.equal(wide.ox, 10 + 160); assert.equal(wide.oy, 0);
  const tall = fitView({ left: 0, top: 5, width: 640, height: 600 });    // letterbox
  assert.equal(tall.s, 0.5); assert.equal(tall.oy, 5 + 120);
});
