// Small drawing helpers over a Kaplay instance (immediate-mode shapes used by onDraw callbacks). Colours are cached by hex.
import { createRng } from '../contracts.js';

export function makeDraw(k) {
  const cache = new Map();
  const col = (c) => {
    if (typeof c !== 'string') return c;
    let v = cache.get(c);
    if (!v) cache.set(c, (v = k.Color.fromHex(/^#[0-9a-f]{3}$/i.test(c) ? `#${[...c.slice(1)].map((x) => x + x).join('')}` : c)));
    return v;
  };
  const v = (x, y) => k.vec2(x, y);
  const texts = new Map();
  const textOpts = (s, x, y, size, c, o) => ({ text: s, pos: v(x, y), size, color: col(c), anchor: o.anchor ?? 'center', opacity: o.a, angle: o.angle,
    align: o.align, width: o.width, scale: o.scale,
    outline: o.line === 0 ? undefined : { width: o.line ?? Math.max(2, size / 8), color: col(o.lineColor ?? '#1e1a2e') } });
  const d = {
    col, v,
    // outlines are drawn as a darker rect underneath (kaplay's own outline path is far slower)
    rect: (x, y, w, h, c, o = {}) => {
      const mid = o.anchor === 'center' || !!o.angle;   // rotated rects are given by their centre
      const base = { angle: o.angle, opacity: o.a, anchor: mid ? 'center' : undefined, radius: o.r };
      const L = o.line ?? 0;
      if (L) k.drawRect({ ...base, pos: v(mid ? x : x - L, mid ? y : y - L), width: w + 2 * L, height: h + 2 * L, radius: o.r ? o.r + L : undefined, color: col(o.lineColor ?? '#1e1a2e') });
      k.drawRect({ ...base, pos: v(x, y), width: w, height: h, color: col(c) });
    },
    // outlined circles are very slow in kaplay: fake the outline with a bigger dark circle underneath
    circle: (x, y, r, c, o = {}) => {
      if (o.line) k.drawCircle({ pos: v(x, y), radius: r + o.line / 2, color: col(o.lineColor ?? '#1e1a2e'), opacity: o.a });
      k.drawCircle({ pos: v(x, y), radius: o.line ? r - o.line / 2 : r, color: col(c), opacity: o.a });
    },
    ellipse: (x, y, rx, ry, c, o = {}) => k.drawEllipse({ pos: v(x, y), radiusX: rx, radiusY: ry, color: col(c), opacity: o.a }),
    line: (x1, y1, x2, y2, w, c, o = {}) => k.drawLine({ p1: v(x1, y1), p2: v(x2, y2), width: w, color: col(c), opacity: o.a }),
    poly: (pts, c, o = {}) => k.drawPolygon({ pts: pts.map(([x, y]) => v(x, y)), color: col(c), opacity: o.a,
      outline: o.line ? { width: o.line, color: col(o.lineColor ?? '#1e1a2e') } : undefined }),
    /** uncached text: use for text whose position/content changes every frame */
    dtext: (s, x, y, size, c = '#ffffff', o = {}) => k.drawText(textOpts(s, x, y, size, c, o)),
    /** cached text (formatText once, draw the formatted result every frame): MUCH cheaper for static labels. Use only for text that stays put. */
    text: (s, x, y, size, c = '#ffffff', o = {}) => {
      const opts = textOpts(s, x, y, size, c, o);
      const key = `${s}|${x}|${y}|${size}|${c}|${o.anchor}|${o.a}|${o.angle}|${o.line}|${o.lineColor}|${o.width}`;
      let ft = texts.get(key);
      if (!ft) { ft = k.formatText(opts); if (texts.size > 600) texts.clear(); texts.set(key, ft); }
      k.drawFormattedText(ft);
    },
  };
  return d;
}

export const rngFor = (seed) => createRng(seed);

/** hex '#rrggbb' mixed towards white (amt>0) or black (amt<0) */
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s) => {
    const c = (n >> s) & 255;
    return Math.max(0, Math.min(255, Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt))));
  };
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}
