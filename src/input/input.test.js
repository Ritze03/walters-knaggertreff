import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInput } from './index.js';
import { TIMING } from '../contracts.js';

const key = (t, type, code, target) => {
  const e = new Event(type);
  e.code = code;
  if (target) Object.defineProperty(e, 'target', { value: target });
  t.dispatchEvent(e);
};
const mk = () => {
  const t = new EventTarget();
  let time = 0;
  const input = createInput({ target: t, now: () => time });
  return { t, input, tick: (ms) => { time += ms; } };
};
const pad = () => ({ connected: true, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] });
const setNav = (v) => Object.defineProperty(globalThis, "navigator", { value: v, configurable: true, writable: true });
const setPads = (...p) => setNav({ getGamepads: () => p });

test('keyboard edge fires once, state follows', () => {
  setPads();
  const { t, input } = mk();
  key(t, 'keydown', 'Space'); input.update();
  assert.ok(input.state.jump && input.state.confirm && input.pressed('jump') && input.pressed('confirm'));
  input.update();
  assert.ok(input.state.jump && !input.pressed('jump'));
  key(t, 'keyup', 'Space'); input.update();
  assert.ok(!input.state.jump && input.released('jump'));
  input.update();
  assert.ok(!input.released('jump'));
});

test('text field keyboard events ignored', () => {
  setPads();
  const { t, input } = mk();
  key(t, 'keydown', 'KeyD', { tagName: 'INPUT' }); input.update();
  assert.equal(input.state.move.x, 0);
});

test('takeFrame latches a tap between updates', () => {
  setPads();
  const { t, input } = mk();
  key(t, 'keydown', 'KeyE'); key(t, 'keyup', 'KeyE'); input.update();
  assert.equal(input.state.action, false);
  assert.equal(input.takeFrame().pressed.action, true);
  assert.equal(input.takeFrame().pressed.action, false);
});

test('gamepad A -> jump + confirm; stick deadzone; diagonal normalised', () => {
  const p = pad(); setPads(p, null);
  const { input } = mk();
  p.buttons[0].pressed = true; input.update();
  assert.ok(input.state.jump && input.state.confirm);
  p.axes[0] = 0.2; input.update();
  assert.deepEqual(input.state.move, { x: 0, y: 0 });
  p.axes[0] = 1; p.axes[1] = 1; input.update();
  assert.ok(Math.hypot(input.state.move.x, input.state.move.y) <= 1.0000001);
  assert.ok(input.state.move.x > 0.7 && input.state.move.y > 0.7);
});

test('works with no getGamepads', () => {
  setNav({});
  const { input } = mk();
  input.update();
  assert.equal(input.state.move.x, 0);
});

test('inject overrides and null clears', () => {
  setPads();
  const { input } = mk();
  input.inject({ move: { x: 1, y: 0 }, action: true }); input.update();
  assert.equal(input.state.move.x, 1);
  assert.ok(input.state.action && input.pressed('action'));
  input.inject(null); input.update();
  assert.equal(input.state.move.x, 0);
  assert.ok(!input.state.action);
});

test('onNav fires on press then repeats after delay/interval', () => {
  setPads();
  const { t, input, tick } = mk();
  const got = [];
  const off = input.onNav((n) => got.push(n));
  key(t, 'keydown', 'ArrowDown'); input.update();
  assert.deepEqual(got, ['down']);
  tick(TIMING.NAV_REPEAT.delayMs - 1); input.update();
  assert.equal(got.length, 1);
  tick(1); input.update();
  assert.equal(got.length, 2);
  tick(TIMING.NAV_REPEAT.intervalMs); input.update();
  assert.equal(got.length, 3);
  key(t, 'keyup', 'ArrowDown'); key(t, 'keydown', 'Enter'); input.update(); tick(1000); input.update();
  assert.equal(got.filter((n) => n === 'confirm').length, 1);
  off(); key(t, 'keydown', 'ArrowDown'); input.update();
  assert.equal(got.filter((n) => n === 'down').length, 3);
});

test('onNav latches a tap shorter than one frame (down+up between updates), key auto-repeat adds nothing', () => {
  setPads();
  const { t, input } = mk();
  const got = [];
  input.onNav((n) => got.push(n));
  key(t, 'keydown', 'ArrowRight'); key(t, 'keyup', 'ArrowRight');
  key(t, 'keydown', 'Enter'); key(t, 'keyup', 'Enter');
  input.update();
  assert.deepEqual(got.sort(), ['confirm', 'right']);
  input.update();
  assert.equal(got.length, 2);
  key(t, 'keydown', 'ArrowDown'); key(t, 'keydown', 'ArrowDown'); key(t, 'keydown', 'ArrowDown');
  input.update();
  assert.equal(got.filter((n) => n === 'down').length, 1);
});
