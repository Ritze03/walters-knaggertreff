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

test('the curve starts at 0, rises, passes 100 % and ends at the cap', () => {
  for (let seed = 1; seed <= 50; seed++) for (const c of makeCurves(seed)) {
    assert.equal(c.valueAt(0), 0);
    assert.ok(Math.abs(c.valueAt(c.t100) - 100) < 1e-6 || c.valueAt(c.t100) >= 99.99);
    assert.equal(c.valueAt(c.tCap + 5000), CAP);
    assert.ok(c.valueAt(c.t100 - 1) < 100);
    for (let t = 0; t < c.tCap; t += 25) assert.ok(c.valueAt(t) <= CAP && c.valueAt(t) >= 0 && typeof c.labelAt(t) === 'string');
  }
});

test('time to the first 100 % varies widely between seeds and attempts', () => {
  const first = [], all = [];
  for (let seed = 1; seed <= 50; seed++) { const cs = makeCurves(seed); first.push(cs[0].t100); all.push(...cs.map((c) => c.t100)); }
  const spread = Math.max(...first) - Math.min(...first);
  console.log(`t100 spread over 50 seeds: ${(spread / 1000).toFixed(2)} s (${Math.min(...first).toFixed(0)}..${Math.max(...first).toFixed(0)} ms)`);
  assert.ok(spread > 2000, `spread ${spread}`);
  assert.ok(Math.min(...all) >= 2500 && Math.max(...all) <= 9000, `${Math.min(...all)}..${Math.max(...all)}`);
});

test('segment sequences and final approaches differ between seeds and between attempts of one seed', () => {
  const seqs = new Set(), styles = new Set();
  for (let seed = 1; seed <= 50; seed++) for (const c of makeCurves(seed)) { seqs.add(c.kinds.join()); styles.add(c.style); }
  assert.ok(seqs.size > 80, `only ${seqs.size} distinct sequences of 150`);
  assert.deepEqual([...styles].sort(), ['crawl', 'fast', 'stall', 'stutter']);
  for (let seed = 1; seed <= 20; seed++) {
    const cs = makeCurves(seed);
    assert.ok(new Set(cs.map((c) => Math.round(c.t100 / 100))).size >= 2, `seed ${seed}: all attempts hit 100 at the same time`);
    assert.notEqual(cs[0].kinds.join(), cs[1].kinds.join() + cs[2].kinds.join());
  }
  const kinds = new Set(); for (let seed = 1; seed <= 100; seed++) makeCurves(seed).forEach((c) => c.kinds.forEach((x) => kinds.add(x)));
  for (const x of ['fill', 'burst', 'stall', 'stutter', 'drop', 'crawl', 'pass', 'over']) assert.ok(kinds.has(x), `no ${x} segment seen`);
});

test('200 seeds: every attempt is catchable (>= 0.25 s inside 98.5-100.5), caps out and stays under 10 s', () => {
  for (let seed = 1; seed <= 200; seed++) for (const c of makeCurves(seed * 7919)) {
    let ms = 0;
    for (let t = 0; t <= c.tCap; t += 5) { const v = c.valueAt(t); if (v >= 98.5 && v <= 100.5) ms += 5; }
    assert.ok(ms >= 250, `seed ${seed}: only ${ms} ms in the window (${c.style})`);
    assert.ok(c.tCap <= 10000, `seed ${seed}: tCap ${c.tCap}`);
    assert.equal(c.valueAt(c.tCap), CAP);
  }
});

test('the whole game fits in durationMs even if every attempt runs to the cap', () => {
  for (let seed = 1; seed <= 300; seed++) {
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
