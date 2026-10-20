// Tiny Kaplay drawing helpers shared by the runner and the minigames (optional for minigame authors). Always go through the passed `k`.

/** '#rrggbb' -> Kaplay Color (Color objects pass through) */
export const colorOf = (k, c) => (typeof c === 'string' ? k.rgb(c) : c);

/** Filled rectangle child. opts: {anchor='topleft', radius, outline:[width,color], opacity, angle} */
export function box(k, parent, x, y, w, h, color, opts = {}) {
  const comps = [k.pos(x, y), k.rect(w, h, opts.radius ? { radius: opts.radius } : undefined), k.color(colorOf(k, color)), k.anchor(opts.anchor ?? 'topleft'), k.opacity(opts.opacity ?? 1)];
  if (opts.outline) comps.push(k.outline(opts.outline[0], colorOf(k, opts.outline[1])));
  if (opts.angle) comps.push(k.rotate(opts.angle));
  return parent.add(comps);
}

/** Filled circle child. opts: {outline:[width,color], opacity} */
export function disc(k, parent, x, y, r, color, opts = {}) {
  const comps = [k.pos(x, y), k.circle(r), k.color(colorOf(k, color)), k.anchor('center'), k.opacity(opts.opacity ?? 1)];
  if (opts.outline) comps.push(k.outline(opts.outline[0], colorOf(k, opts.outline[1])));
  return parent.add(comps);
}

/** Text child. NOTE: Kaplay reads "[tag]…[/tag]" as styled text, so never put square brackets in texts.
 *  opts: {size=24, color='#fff', anchor='center', width, align, lineSpacing, outline:[width,color], opacity, angle} */
export function label(k, parent, str, x, y, opts = {}) {
  const t = { size: opts.size ?? 24 };
  if (opts.width) t.width = opts.width;
  if (opts.align) t.align = opts.align;
  if (opts.lineSpacing) t.lineSpacing = opts.lineSpacing;
  const comps = [k.pos(x, y), k.text(str, t), k.color(colorOf(k, opts.color ?? '#ffffff')), k.anchor(opts.anchor ?? 'center'), k.opacity(opts.opacity ?? 1)];
  if (opts.outline) comps.push(k.outline(opts.outline[0], colorOf(k, opts.outline[1])));
  if (opts.angle) comps.push(k.rotate(opts.angle));
  return parent.add(comps);
}

/**
 * Speech bubble that sizes itself to its text (measured with k.formatText) and stays inside `bounds`. Returns {obj, w, h, place(tx, ty)}:
 * place() puts the bubble centred ABOVE the target point (tx, ty), clamps it into bounds and slides the tail so it still points at the target.
 * opts: {size=17, color='#1b2a49' text, fill='#ffffff', outline='#1b2a49', pad=10, gap=14 tail length, maxWidth, bounds:{x0,y0,x1,y1}}
 */
export function bubble(k, parent, str, opts = {}) {
  const size = opts.size ?? 17, pad = opts.pad ?? 10, tail = opts.gap ?? 14, line = opts.line ?? 3;
  const fmt = k.formatText({ text: str, size, ...(opts.maxWidth ? { width: opts.maxWidth, align: 'center' } : {}) });
  const w = Math.ceil(fmt.width) + pad * 2, h = Math.ceil(fmt.height) + pad * 2;
  const obj = parent.add([k.pos(0, 0)]);
  const tailObj = obj.add([k.pos(0, h / 2 - 1), k.polygon([k.vec2(-9, 0), k.vec2(9, 0), k.vec2(0, tail)]), k.color(colorOf(k, opts.outline ?? '#1b2a49'))]);
  box(k, obj, 0, 0, w, h, opts.fill ?? '#ffffff', { anchor: 'center', radius: Math.min(12, h / 2), outline: [line, opts.outline ?? '#1b2a49'] });
  label(k, obj, str, 0, 0, { size, color: opts.color ?? '#1b2a49', ...(opts.maxWidth ? { width: opts.maxWidth, align: 'center' } : {}) });
  const b = opts.bounds;
  function place(tx, ty) {
    let x = tx, y = ty - tail - h / 2;
    if (b) {
      x = Math.max(b.x0 + w / 2, Math.min(b.x1 - w / 2, x));
      y = Math.max(b.y0 + h / 2, Math.min(b.y1 - h / 2 - tail, y));
    }
    obj.pos = k.vec2(x, y);
    tailObj.pos = k.vec2(Math.max(-w / 2 + 16, Math.min(w / 2 - 16, tx - x)), h / 2 - 1);
  }
  return { obj, w, h, place };
}

/** German number format with one decimal: 99.25 -> '99,3' */
export const decimal = (v, digits = 1) => v.toFixed(digits).replace('.', ',');

/** exponential smoothing factor for frame-rate independent lerps: lerp(a, b, ease(dt, 12)) */
export const ease = (dt, speed) => 1 - Math.exp(-dt * speed);

/** assigns text only when it changed (re-laying out text every frame is wasteful) */
export const setText = (obj, str) => { if (obj.text !== str) obj.text = str; };

/** Button hints with Xbox-style glyphs and key-caps: addHint(k, parent, '{key:Enter} / {A} Stoppen', x, y, opts). Token syntax: src/ui/glyphs.js */
export { addHint } from './hint.js';
