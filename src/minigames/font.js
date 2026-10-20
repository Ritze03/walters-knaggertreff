// Unclipped glyphs for every Kaplay text. Shared by the board, the minigames and the avatar: always build text options via `textOpts`.
//
// Why: Kaplay 3001's own glyph atlas (formatText in kaplay.mjs) rasterises each glyph with textBaseline='top' at y=0 and copies
// |ascent|+|descent| rows from there. Ink that rises above the em box (the dots of Ä Ö Ü, the top ~15% of every colour emoji) lands at
// y<0 and is cut off for good. This is the same lazy atlas with HEAD px of headroom above each glyph; `textOpts` lifts every glyph back up
// by that headroom (a per-char transform), so advances, line boxes and anchors stay exactly Kaplay's: only the missing ink comes back.
const F = 64;                 // atlas font size (Kaplay's own is 64 too)
const HEAD = 24;              // headroom above the em box: covers accents and emoji (~0.15 em) with margin
const CELL = HEAD + 96;       // atlas row height: headroom + em box + descenders / emoji bottoms (~1.05 em)
const ATLAS = 2048;
const FAMILY = 'monospace';   // Kaplay's default font, so the look does not change
const fonts = new WeakMap();  // k -> BitmapFontData-like { tex, map, size }

function glyphFont(k) {
  let font = fonts.get(k);
  if (font) return font;
  const blank = document.createElement('canvas');
  blank.width = blank.height = ATLAS;
  const tex = k.SpriteData.fromImage(blank, { singular: true }).tex;   // a texture of its own, never shared with the sprite packer
  const scratch = document.createElement('canvas');
  scratch.width = F * 4; scratch.height = CELL;
  const c2d = scratch.getContext('2d', { willReadFrequently: true });
  let x = 0, y = 0, full = false;
  const raster = (ch) => {
    c2d.clearRect(0, 0, scratch.width, scratch.height);
    c2d.font = `${F}px ${FAMILY}`;
    c2d.textBaseline = 'top';
    c2d.fillStyle = '#ffffff';
    const w = Math.min(scratch.width, Math.ceil(c2d.measureText(ch).width));   // advance width, rounded like Kaplay does
    if (!w) return null;
    if (x + w > ATLAS) { x = 0; y += CELL; }
    if (y + CELL > ATLAS) { if (!full) console.warn('[font] glyph atlas full'); full = true; return null; }
    c2d.fillText(ch, 0, HEAD);
    tex.update(c2d.getImageData(0, 0, w, CELL), x, y);
    const quad = new k.Quad(x, y, w, CELL);
    x += w + 1;
    return quad;
  };
  const glyphs = Object.create(null);
  const map = new Proxy(glyphs, {
    get: (g, ch) => {
      if (typeof ch !== 'string') return undefined;
      if (!(ch in g)) g[ch] = raster(ch);
      return g[ch] ?? undefined;   // undefined = Kaplay skips the char (zero width / atlas full)
    },
  });
  font = { tex, map, size: F };
  fonts.set(k, font);
  return font;
}

/** Kaplay text options ({ size, font, transform }) for text of `size` px (and Kaplay's numeric `scale` text option, if used):
 *  spread them into k.text / k.drawText / k.formatText options so measuring and drawing use the same glyphs. */
export function textOpts(k, size, scale = 1) {
  return { size, font: glyphFont(k), transform: { pos: k.vec2(0, (-HEAD * size * (scale ?? 1)) / F) } };
}
