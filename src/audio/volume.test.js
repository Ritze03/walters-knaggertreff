import test from 'node:test';
import assert from 'node:assert/strict';
import { volumeToGain } from './index.js';

test('volume curve: 0 -> 0, 1 -> 1, monotonic, low slider is well below linear', () => {
  assert.equal(volumeToGain(0), 0);
  assert.equal(volumeToGain(1), 1);
  assert.ok(volumeToGain(0.2) < 0.2 / 5, `0.2 -> ${volumeToGain(0.2)}`);
  let prev = -1;
  for (let i = 0; i <= 100; i++) { const g = volumeToGain(i / 100); assert.ok(g > prev || i === 0, String(i)); prev = g; }
  assert.equal(volumeToGain(NaN), 0);
  assert.equal(volumeToGain(5), 1);
});
