// Gamepad stub for the e2e specs: a fake standard-mapping pad behind navigator.getGamepads().
// The test drives it through window.__pad (set(buttonIndex, down), axis(i, v)).
// Standard mapping: 0 = A, 1 = B, 2 = X, 3 = Y, 12..15 = d-pad up/down/left/right.
import { expect } from '@playwright/test';

export const PAD = { A: 0, B: 1, X: 2, Y: 3, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

/** addInitScript body */
export const PAD_STUB = () => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false }));
  const axes = [0, 0, 0, 0];
  window.__pad = {
    set(i, down) { buttons[i].pressed = down; buttons[i].value = down ? 1 : 0; },
    axis(i, v) { axes[i] = v; },
  };
  navigator.getGamepads = () => [{
    id: 'Fake Pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: performance.now(),
    buttons: buttons.map((b) => ({ ...b })), axes: axes.slice(),
  }];
};

/** Holds a pad button for `holdMs` (several frames: the Input layer polls once per frame), then releases it. */
export async function padTap(page, button, holdMs = 160) {
  await page.evaluate((b) => window.__pad.set(b, true), button);
  await page.waitForTimeout(holdMs);
  await page.evaluate((b) => window.__pad.set(b, false), button);
  await page.waitForTimeout(120);
}

/** Moves the DOM menu focus to [data-testid=testid] using only d-pad taps, mirroring src/ui/nav.js (rows, column clamp). */
export async function padFocus(page, testid) {
  for (let guard = 0; guard < 30; guard++) {
    const { rows, active } = await page.evaluate(() => {
      const panel = [...document.querySelectorAll('[data-row]')].filter((r) => r.offsetParent !== null);
      const rows = panel.map((r) => [...r.querySelectorAll('button:not([disabled]), input:not([disabled])')].map((e) => e.dataset.testid ?? '?')).filter((r) => r.length);
      return { rows, active: document.activeElement?.dataset?.testid ?? null };
    });
    const ty = rows.findIndex((r) => r.includes(testid));
    expect(ty, `${testid} is in a navigable row`).toBeGreaterThanOrEqual(0);
    if (active === testid) return;
    const ay = rows.findIndex((r) => r.includes(active));
    if (ay < 0) await padTap(page, PAD.DOWN);   // focus is outside the rows: any nav focuses the first widget
    else if (ay !== ty) await padTap(page, ty > ay ? PAD.DOWN : PAD.UP);
    else await padTap(page, rows[ty].indexOf(testid) > rows[ty].indexOf(active) ? PAD.RIGHT : PAD.LEFT);
  }
  throw new Error(`could not focus ${testid} with the pad`);
}

/** Focus a widget with the d-pad and press it with A. */
export async function padPress(page, testid) {
  await padFocus(page, testid);
  await padTap(page, PAD.A);
}
