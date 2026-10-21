import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrack } from './interp.js';

const mk = (o) => createTrack({ delayMs: 100, snapDist: 200, maxExtrapMs: 120, ...o });

test('empty track samples null', () => {
  assert.equal(mk().sample(1000), null);
});

test('lerps between the two snapshots straddling now - delay', () => {
  const tr = mk();
  tr.push(1000, { x: 0, y: 10, name: 'a' });
  tr.push(1050, { x: 50, y: 20, name: 'b' });
  tr.push(1100, { x: 100, y: 30, name: 'c' });
  // render time 1075 -> halfway between the 2nd and 3rd
  const s = tr.sample(1175);
  assert.equal(s.x, 75); assert.equal(s.y, 25);
  assert.equal(s.name, 'c', 'non-numeric fields come from the later snapshot');
  assert.equal(tr.sample(1150).x, 50, 'exactly on a snapshot');
});

test('before the first snapshot it holds the first one', () => {
  const tr = mk();
  tr.push(1000, { x: 5 });
  tr.push(1050, { x: 10 });
  assert.equal(tr.sample(1010).x, 5);
});

test('samples are copies', () => {
  const tr = mk();
  tr.push(1000, { x: 5 });
  const s = tr.sample(2000);
  s.x = 99;
  assert.equal(tr.sample(2000).x, 5);
});

test('dry buffer extrapolates with vx/vy(/vz) up to maxExtrapMs, then holds', () => {
  const tr = mk();
  tr.push(1000, { x: 100, y: 0, z: 5, vx: 200, vy: -100, vz: 10 });
  // render time 1060 = 60 ms past the last snapshot
  let s = tr.sample(1160);
  assert.ok(Math.abs(s.x - 112) < 1e-9 && Math.abs(s.y + 6) < 1e-9 && Math.abs(s.z - 5.6) < 1e-9, JSON.stringify(s));
  // 500 ms past: capped at 120 ms of extrapolation
  s = tr.sample(1600);
  assert.ok(Math.abs(s.x - 124) < 1e-9 && Math.abs(s.y + 12) < 1e-9, JSON.stringify(s));
  assert.deepEqual(tr.sample(5000), s, 'held');
});

test('no velocity fields: a dry buffer just holds the last state', () => {
  const tr = mk();
  tr.push(1000, { x: 1 }); tr.push(1050, { x: 2 });
  assert.equal(tr.sample(9000).x, 2);
});

test('a jump above snapDist snaps (no sliding)', () => {
  const tr = mk();
  tr.push(1000, { x: 0, y: 0 });
  tr.push(1050, { x: 10, y: 0 });
  tr.push(1100, { x: 500, y: 0 });   // teleport
  assert.equal(tr.length, 1);
  assert.equal(tr.sample(1175).x, 500);
  assert.equal(tr.sample(1100).x, 500);
});

test('a jump at or below snapDist still interpolates', () => {
  const tr = mk();
  tr.push(1000, { x: 0, y: 0 });
  tr.push(1100, { x: 200, y: 0 });
  assert.equal(tr.sample(1150).x, 100);
});

test('out-of-order pushes are ignored; keys restricts lerping', () => {
  const tr = mk({ keys: ['x'] });
  tr.push(1000, { x: 0, n: 1 });
  tr.push(1100, { x: 100, n: 2 });
  tr.push(1050, { x: 777, n: 9 });
  assert.equal(tr.length, 2);
  const s = tr.sample(1150);
  assert.equal(s.x, 50); assert.equal(s.n, 2, 'n is not interpolated');
});

test('old history is trimmed', () => {
  const tr = mk();
  for (let i = 0; i < 100; i++) tr.push(1000 + i * 50, { x: i });
  assert.ok(tr.length < 40, `length ${tr.length}`);
  assert.equal(tr.sample(1000 + 99 * 50 + 100).x, 99);
});
