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

/** German number format with one decimal: 99.25 -> '99,3' */
export const decimal = (v, digits = 1) => v.toFixed(digits).replace('.', ',');

/** exponential smoothing factor for frame-rate independent lerps: lerp(a, b, ease(dt, 12)) */
export const ease = (dt, speed) => 1 - Math.exp(-dt * speed);

/** assigns text only when it changed (re-laying out text every frame is wasteful) */
export const setText = (obj, str) => { if (obj.text !== str) obj.text = str; };
