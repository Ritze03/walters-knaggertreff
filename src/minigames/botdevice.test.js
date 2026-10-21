import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBotDevice } from './botdevice.js';

test('bot device: injected frames become edges, held state and latched taps', () => {
  const d = createBotDevice();
  d.update();
  assert.equal(d.pressed('action'), false);
  d.inject({ action: true, move: { x: 1, y: 0 } });
  d.update();
  assert.equal(d.pressed('action'), true);
  assert.equal(d.pressedDir('right'), true);
  assert.deepEqual(d.state.move, { x: 1, y: 0 });
  d.update();   // still held: no new edge
  assert.equal(d.pressed('action'), false);
  assert.equal(d.state.action, true);
  d.inject({});
  d.update();
  assert.equal(d.released('action'), true);
  const f = d.takeFrame();   // the tap survived the release
  assert.equal(f.pressed.action, true);
  assert.equal(f.action, false);
  assert.equal(d.takeFrame().pressed.action, false);
});

test('bot device: long move vectors are clamped, garbage ignored', () => {
  const d = createBotDevice();
  d.inject({ move: { x: 3, y: 4 }, jump: 1 });
  d.update();
  assert.ok(Math.abs(Math.hypot(d.state.move.x, d.state.move.y) - 1) < 1e-9);
  assert.equal(d.pressed('jump'), true);
  d.inject({ move: { x: 'a' } });
  d.update();
  assert.deepEqual(d.state.move, { x: 0, y: 0 });
});
