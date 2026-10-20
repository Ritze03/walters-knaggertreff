// Kaplay renderer for button hints (token syntax: see src/ui/glyphs.js): pad buttons as coloured letter circles, keyboard keys as
// drawn key-caps (shapes, never "[...]": brackets are Kaplay style tags). Used by the board prompts, the intro screen and minigames.
import { textOpts } from './font.js';
import { parseHint, PAD_GLYPHS, GLYPH_RING, KEYCAP } from '../ui/glyphs.js';

const col = (k, c) => (typeof c === 'string' ? k.rgb(c) : c);
const clean = (s) => s.replace(/\[/g, '(').replace(/\]/g, ')');

/**
 * One line of hint, built from child objects under `parent`.
 * opts: {size=22, color='#fff', outline:[width,color] (text outline), anchor:'center'|'left'|'right', opacity=1}
 * @returns GameObj at (x, y) (vertical centre of the line) with `.width` and `.setOpacity(a)`
 */
export function addHint(k, parent, str, x, y, opts = {}) {
  const size = opts.size ?? 22;
  const op = opts.opacity ?? 1;
  const sp = size * 0.3;
  const D = Math.round(size * 1.15);   // pad glyph diameter and key-cap height
  const capSize = Math.round(size * 0.72);
  const items = parseHint(str).map((p) => {
    if (p.type === 'text') {
      const text = clean(p.text.trim());
      return text ? { ...p, text, w: k.formatText({ text, ...textOpts(k, size) }).width } : null;
    }
    if (p.type === 'gap') return { ...p, w: size * 0.9 };
    if (p.type === 'key') {
      const label = clean(p.label);
      return { ...p, label, w: Math.max(D, k.formatText({ text: label, ...textOpts(k, capSize) }).width + size * 0.7) };
    }
    return { ...p, w: D };
  }).filter(Boolean);
  const width = items.reduce((s, it) => s + it.w, 0) + sp * Math.max(0, items.length - 1);

  const root = parent.add([k.pos(x, y)]);
  const parts = [];
  const add = (comps) => { const o = root.add([...comps, k.opacity(op)]); parts.push(o); return o; };
  let cx = opts.anchor === 'left' ? 0 : opts.anchor === 'right' ? -width : -width / 2;
  for (const it of items) {
    const mid = cx + it.w / 2;
    if (it.type === 'text') {
      const comps = [k.pos(mid, 0), k.text(it.text, textOpts(k, size)), k.color(col(k, opts.color ?? '#ffffff')), k.anchor('center')];
      if (opts.outline) comps.push(k.outline(opts.outline[0], col(k, opts.outline[1])));
      add(comps);
    } else if (it.type === 'key') {
      add([k.pos(mid, 2), k.rect(it.w, D, { radius: size * 0.22 }), k.color(col(k, KEYCAP.edge)), k.anchor('center')]);
      add([k.pos(mid, 0), k.rect(it.w, D - 2, { radius: size * 0.22 }), k.color(col(k, KEYCAP.fill)), k.anchor('center')]);
      add([k.pos(mid, 0), k.text(it.label, textOpts(k, capSize)), k.color(col(k, KEYCAP.ink)), k.anchor('center')]);
    } else if (it.type === 'pad') {
      const g = PAD_GLYPHS[it.id], r = D / 2;
      add([k.pos(mid, 0), k.circle(r + Math.max(1.5, size * 0.07)), k.color(col(k, GLYPH_RING)), k.anchor('center')]);
      add([k.pos(mid, 0), k.circle(r), k.color(col(k, g.fill)), k.anchor('center')]);
      if (it.id === 'DPAD') {
        for (const [w, h] of [[r * 1.25, r * 0.42], [r * 0.42, r * 1.25]]) add([k.pos(mid, 0), k.rect(w, h, { radius: r * 0.08 }), k.color(col(k, g.ink)), k.anchor('center')]);
      } else {
        if (it.id === 'LS') add([k.pos(mid, 0), k.circle(r * 0.72), k.color(col(k, '#454852')), k.anchor('center')]);
        add([k.pos(mid, 1), k.text(g.label, textOpts(k, Math.round(size * 0.78))), k.color(col(k, g.ink)), k.anchor('center')]);
      }
    }
    cx += it.w + sp;
  }
  root.width = width;
  root.setOpacity = (a) => { for (const p of parts) p.opacity = a; };
  return root;
}
