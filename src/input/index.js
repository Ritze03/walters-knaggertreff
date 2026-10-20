// Input layer (contracts §8). Keyboard + standard-mapping gamepads -> one InputState. No window/navigator access at module top level.
import { TIMING } from '../contracts.js';

const KEYS = {
  jump: ['Space'],
  action: ['KeyE', 'ShiftLeft', 'ShiftRight'],
  confirm: ['Enter', 'NumpadEnter', 'Space'],
  back: ['Escape', 'Backspace'],
};
const MOVE_KEYS = {
  left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'],
};
const PAD = { jump: [0], action: [2, 3], confirm: [0], back: [1] }; // standard mapping button indices
const DPAD = { up: 12, down: 13, left: 14, right: 15 };
const BUTTONS = ['jump', 'action', 'confirm', 'back'];
const DIRS = ['up', 'down', 'left', 'right'];
const DEADZONE = 0.25;
const DIR_THRESHOLD = 0.5;
const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

const isTextField = (t) => !!t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
const clampLen = (x, y) => {
  const l = Math.hypot(x, y);
  return l > 1 ? { x: x / l, y: y / l } : { x, y };
};
const pressedBtn = (b) => !!b && (b.pressed || b.value > 0.5);

/** Reads all connected pads fresh (never cached: Gamepad objects are snapshots in Chrome). */
function readPads() {
  const out = { jump: false, action: false, confirm: false, back: false, x: 0, y: 0 };
  let pads = null;
  try { pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : null; } catch { pads = null; }
  for (const p of pads || []) {
    if (!p || p.connected === false) continue;
    const b = p.buttons || [];
    for (const a of BUTTONS) if (PAD[a].some((i) => pressedBtn(b[i]))) out[a] = true;
    let sx = p.axes?.[0] || 0, sy = p.axes?.[1] || 0;
    const m = Math.hypot(sx, sy);
    if (m < DEADZONE) { sx = 0; sy = 0; } else { const s = Math.min(1, (m - DEADZONE) / (1 - DEADZONE)) / m; sx *= s; sy *= s; }
    out.x += sx + (pressedBtn(b[DPAD.right]) ? 1 : 0) - (pressedBtn(b[DPAD.left]) ? 1 : 0);
    out.y += sy + (pressedBtn(b[DPAD.down]) ? 1 : 0) - (pressedBtn(b[DPAD.up]) ? 1 : 0);
  }
  return out;
}

/**
 * @param {{ target?: EventTarget, now?: () => number }} o  `now` (ms) is injectable for tests.
 * Keyboard events whose target is <input>/<textarea>/<select> are ignored completely (the name picker handles its own Enter/Esc).
 * inject(): booleans are OR-ed with devices; `move`, when given, replaces the device move.
 */
export function createInput({ target = globalThis.window, now = () => performance.now() } = {}) {
  const held = new Set();
  const latched = { jump: false, action: false, confirm: false, back: false };
  const state = { move: { x: 0, y: 0 }, jump: false, action: false, confirm: false, back: false };
  let prev = {};
  let edges = {};
  let released = {};
  let injected = null;
  const navHandlers = new Set();
  const nextRepeat = {};
  const tapped = new Set(); // nav names pressed since the last update(), so a tap shorter than a frame still navigates

  const onKeyDown = (e) => {
    if (isTextField(e.target)) return;
    if (PREVENT.has(e.code) && e.preventDefault) e.preventDefault();
    const fresh = !held.has(e.code);   // OS key auto-repeat must not count as new taps
    held.add(e.code);
    for (const a of BUTTONS) if (KEYS[a].includes(e.code)) latched[a] = true; // so a tap shorter than a frame still counts
    if (fresh) {
      for (const a of ['confirm', 'back']) if (KEYS[a].includes(e.code)) tapped.add(a);
      for (const d of DIRS) if (MOVE_KEYS[d].includes(e.code)) tapped.add(d);
    }
  };
  const onKeyUp = (e) => { if (!isTextField(e.target)) held.delete(e.code); };
  const onBlur = () => held.clear();
  target?.addEventListener('keydown', onKeyDown);
  target?.addEventListener('keyup', onKeyUp);
  target?.addEventListener('blur', onBlur);

  const down = (codes) => codes.some((c) => held.has(c));
  const emit = (n) => { for (const h of [...navHandlers]) h(n); };

  function update() {
    const pad = readPads();
    let x = (down(MOVE_KEYS.right) ? 1 : 0) - (down(MOVE_KEYS.left) ? 1 : 0) + pad.x;
    let y = (down(MOVE_KEYS.down) ? 1 : 0) - (down(MOVE_KEYS.up) ? 1 : 0) + pad.y;
    if (injected?.move) { x = injected.move.x; y = injected.move.y; }
    const move = clampLen(x, y);
    const btn = {};
    for (const a of BUTTONS) btn[a] = down(KEYS[a]) || pad[a] || !!injected?.[a];
    state.move = move;
    Object.assign(state, btn);
    const all = {
      ...btn,
      up: move.y < -DIR_THRESHOLD, down: move.y > DIR_THRESHOLD, left: move.x < -DIR_THRESHOLD, right: move.x > DIR_THRESHOLD,
    };
    edges = {}; released = {};
    for (const k of Object.keys(all)) {
      edges[k] = all[k] && !prev[k];
      if (k in btn) {
        released[k] = !all[k] && !!prev[k];
        if (edges[k]) latched[k] = true;
      }
    }
    // menu navigation: fire on press; directions then repeat while held (confirm/back do not repeat)
    const t = now();
    for (const n of [...DIRS, 'confirm', 'back']) {
      if (edges[n] || tapped.has(n)) {
        emit(n);
        nextRepeat[n] = t + TIMING.NAV_REPEAT.delayMs;
      } else if (all[n] && DIRS.includes(n) && t >= nextRepeat[n]) {
        emit(n);
        nextRepeat[n] = t + TIMING.NAV_REPEAT.intervalMs;
      }
    }
    tapped.clear();
    prev = all;
  }

  return {
    state,
    update,
    pressed: (a) => !!edges[a],
    released: (a) => !!released[a],
    pressedDir: (d) => !!edges[d],
    takeFrame() {
      const f = { move: { ...state.move }, jump: state.jump, action: state.action, confirm: state.confirm, back: state.back, pressed: { ...latched } };
      for (const a of BUTTONS) latched[a] = false;
      return f;
    },
    onNav(h) { navHandlers.add(h); return () => navHandlers.delete(h); },
    inject(partial) { injected = partial ? { ...partial } : null; },
    destroy() {
      target?.removeEventListener('keydown', onKeyDown);
      target?.removeEventListener('keyup', onKeyUp);
      target?.removeEventListener('blur', onBlur);
      held.clear(); navHandlers.clear();
    },
  };
}
