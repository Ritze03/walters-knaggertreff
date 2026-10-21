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

/** Where the letterboxed SCREEN view sits inside a DOM box `cr` ({left, top, width, height}, e.g. the Kaplay canvas' bounding rect):
 *  `s` = page px per screen px, (ox, oy) = the view's top-left corner on the page. Same maths as three3d.laneToDom. */
export function fitView(cr, screen = SCREEN) {
  const s = Math.min(cr.width / screen.w, cr.height / screen.h);
  return { s, ox: cr.left + (cr.width - screen.w * s) / 2, oy: cr.top + (cr.height - screen.h * s) / 2 };
}

/** Solo split view (D7): own lane big on the left, the other `n` lanes as live thumbnails in the right-hand panel.
 *  `reserveTop` (screen px) keeps the top of the thumbnail panel free, for the DOM sound widget in the top-right corner (its bottom edge in screen px). */
export function soloLayout(n, logical = MG_VIEW.solo, screen = SCREEN, { reserveTop = 0 } = {}) {
  const scale = n > 3 ? 0.8 : 1;
  const w = logical.w * scale, h = logical.h * scale;
  const main = { x: 0, y: (screen.h - h) / 2, scale, w, h };
  const px = w + 12;
  const top = Math.max(12, reserveTop);
  const thumbs = gridLayout(n, { x: px, y: top, w: screen.w - px - 12, h: screen.h - 12 - top }, logical);
  return { main, thumbs };
}

/** Spectator view: all participants' lanes as a grid over the whole screen (`reserveTop` as in soloLayout). */
export function spectatorLayout(n, logical = MG_VIEW.solo, screen = SCREEN, { reserveTop = 0 } = {}) {
  const top = Math.max(12, reserveTop);
  return gridLayout(n, { x: 12, y: top, w: screen.w - 24, h: screen.h - 12 - top }, logical, { labelH: 34 });
}
