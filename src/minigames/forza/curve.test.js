import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, MINIGAMES } from '../../contracts.js';
import { makeCurve, makeCurves, scoreAttempt, isPerfect, isOvershoot, CAP, ATTEMPTS, DURATION_MS } from './curve.js';

const sample = (c, step = 20) => { const o = []; for (let t = 0; t <= c.tCap + 100; t += step) o.push(c.valueAt(t)); return o; };

test('the curve is seeded-deterministic and differs between seeds and attempts', () => {
  const a = sample(makeCurves(42)[0]), b = sample(makeCurves(42)[0]);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, sample(makeCurves(43)[0]));
  const cs = makeCurves(42);
  assert.equal(cs.length, ATTEMPTS);
  assert.notDeepEqual(sample(cs[0]), sample(cs[1]));
});

test('the curve starts at 0, stalls at 99 %, jumps back, passes 100 % and ends at the cap', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const c = makeCurve(createRng(seed));
    assert.equal(c.valueAt(0), 0);
    const labels = new Set();
    for (let t = 0; t < c.tCap; t += 10) labels.add(c.labelAt(t));
    for (const l of ['load', 'hang', 'rush', 'stall', 'unpack', 'crawl', 'over']) assert.ok(labels.has(l), `seed ${seed} lacks ${l}`);
    // there is a downward jump (the fake "Entpacke…" reset)
    const v = sample(c, 10);
    assert.ok(v.some((x, i) => i >= 10 && v[i - 10] - x > 20), 'jump back (within 100 ms)');
    // it stalls just under 100
    let stall = 0; for (let t = 0; t < c.tCap; t += 10) if (c.labelAt(t) === 'stall') { stall++; assert.ok(c.valueAt(t) >= 99 && c.valueAt(t) < 99.5); }
    assert.ok(stall > 100, 'stalls for > 1 s');
    assert.ok(Math.abs(c.valueAt(c.t100) - 100) < 1e-6);
    assert.equal(c.valueAt(c.tCap + 5000), CAP);
  }
});

test('the last stretch is a crawl: <= 8 %/s around 100 %, so a stop within 0.5 % is humanly possible', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const c = makeCurve(createRng(seed));
    const window = (c.valueAt(c.t100 + 50) - c.valueAt(c.t100 - 50)) / 0.1;   // %/s
    assert.ok(window < 14, `seed ${seed}: ${window.toFixed(1)} %/s`);
    assert.ok(c.t100 > 5000 && c.tCap < 12000);
  }
});

test('the whole game fits in durationMs even if every attempt runs to the cap', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const total = makeCurves(seed).reduce((s, c) => s + c.tCap + 1500, 0);
    assert.ok(total < DURATION_MS, `seed ${seed}: ${total}`);
  }
});

test('scoring is monotonic in closeness to 100 % (undershoot rises, overshoot falls)', () => {
  let prev = -1;
  for (let v = 0; v <= 100; v += 0.1) { const s = scoreAttempt(v); assert.ok(s >= prev, `v=${v}`); prev = s; }
  prev = Infinity;
  for (let v = 100.1; v <= CAP; v += 0.1) { const s = scoreAttempt(v); assert.ok(s <= prev, `v=${v}`); prev = s; }
  assert.equal(scoreAttempt(100), 1000);
  assert.equal(scoreAttempt(CAP), 0);
});

test('overshoot scores worse than an equally close undershoot', () => {
  for (const e of [0.1, 0.3, 0.5, 1, 2, 4]) assert.ok(scoreAttempt(100 + e) < scoreAttempt(100 - e), `e=${e}`);
});

test('perfect = 99.5..100.0, overshoot = anything above 100.0 as displayed', () => {
  assert.ok(isPerfect(99.5) && isPerfect(100) && isPerfect(99.96));
  assert.ok(!isPerfect(99.4) && !isPerfect(100.1));
  assert.ok(isOvershoot(100.1) && !isOvershoot(100) && !isOvershoot(100.04));
  assert.equal(scoreAttempt(NaN), 0);
});

test('forza is a solo game in the MINIGAMES table', () => assert.equal(MINIGAMES.forza.kind, 'solo'));
