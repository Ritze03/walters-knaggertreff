// A device-less Input for a HOST-RUN bot (test mode): same surface the minigames use (state, update, pressed, released, pressedDir, takeFrame, onNav,
// inject, destroy), but it ignores keyboard and gamepads. Every frame: inject(instance.botInput()) then update(); the instance reads the edges like it would
// from the real Input, and arena/team bots send takeFrame() to the host sim at 30 Hz exactly like a `?bot` tab does.
const BUTTONS = ['jump', 'action', 'confirm', 'back'];
const DIRS = ['up', 'down', 'left', 'right'];
const DIR_THRESHOLD = 0.5;

export function createBotDevice() {
  const state = { move: { x: 0, y: 0 }, jump: false, action: false, confirm: false, back: false };
  const latched = { jump: false, action: false, confirm: false, back: false };
  let injected = null, prev = {}, edges = {}, released = {};
  return {
    state,
    inject(partial) { injected = partial ? { ...partial } : null; },
    update() {
      let x = Number(injected?.move?.x) || 0, y = Number(injected?.move?.y) || 0;
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      state.move = { x, y };
      const all = { up: y < -DIR_THRESHOLD, down: y > DIR_THRESHOLD, left: x < -DIR_THRESHOLD, right: x > DIR_THRESHOLD };
      for (const b of BUTTONS) all[b] = state[b] = !!injected?.[b];
      edges = {}; released = {};
      for (const key of [...BUTTONS, ...DIRS]) {
        edges[key] = all[key] && !prev[key];
        if (BUTTONS.includes(key)) {
          released[key] = !all[key] && !!prev[key];
          if (edges[key]) latched[key] = true;
        }
      }
      prev = all;
    },
    pressed: (a) => !!edges[a],
    released: (a) => !!released[a],
    pressedDir: (d) => !!edges[d],
    takeFrame() {
      const f = { move: { ...state.move }, jump: state.jump, action: state.action, confirm: state.confirm, back: state.back, pressed: { ...latched } };
      for (const b of BUTTONS) latched[b] = false;
      return f;
    },
    onNav: () => () => {},
    destroy() {},
  };
}
