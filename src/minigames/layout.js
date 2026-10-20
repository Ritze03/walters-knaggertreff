// Pure screen layout for the runner (node-testable). Everything in screen px (SCREEN = 1280x720).
import { MG_VIEW, SCREEN } from '../contracts.js';

/** Fits `n` boxes of `logical` size (plus a caption strip) into `area`; picks the column count with the biggest scale.
 *  @returns {{x:number, y:number, scale:number, w:number, h:number, cell:{x:number,y:number,w:number,h:number}}[]} x/y = top-left of the scaled lane, cell = lane + caption */
export function gridLayout(n, area, logical, { gap = 10, labelH = 26 } = {}) {
  if (n <= 0) return [];
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (area.w - gap * (cols - 1)) / cols, ch = (area.h - gap * (rows - 1)) / rows;
    const scale = Math.min(cw / logical.w, (ch - labelH) / logical.h);
    if (!best || scale > best.scale + 1e-9) best = { cols, rows, cw, ch, scale };
  }
  const { cols, rows, cw, ch, scale } = best;
  const out = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;      // centre a short last row
    const rowW = inRow * cw + (inRow - 1) * gap;
    const cx = area.x + (area.w - rowW) / 2 + col * (cw + gap);
    const cy = area.y + row * (ch + gap);
    const w = logical.w * scale, h = logical.h * scale;
    out.push({ x: cx + (cw - w) / 2, y: cy + labelH, scale, w, h, cell: { x: cx, y: cy, w: cw, h: ch } });
  }
  return out;
}

/** Solo split view (D7): own lane big on the left, the other `n` lanes as live thumbnails in the right-hand panel. */
export function soloLayout(n, logical = MG_VIEW.solo, screen = SCREEN) {
  const scale = n > 3 ? 0.8 : 1;
  const w = logical.w * scale, h = logical.h * scale;
  const main = { x: 0, y: (screen.h - h) / 2, scale, w, h };
  const px = w + 12;
  const thumbs = gridLayout(n, { x: px, y: 12, w: screen.w - px - 12, h: screen.h - 24 }, logical);
  return { main, thumbs };
}

/** Spectator view: all participants' lanes as a grid over the whole screen. */
export function spectatorLayout(n, logical = MG_VIEW.solo, screen = SCREEN) {
  return gridLayout(n, { x: 12, y: 12, w: screen.w - 24, h: screen.h - 24 }, logical, { labelH: 34 });
}
