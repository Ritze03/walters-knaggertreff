// Doodle-Knagger: the static artwork, baked ONCE into textures (Canvas2D -> Kaplay texture) instead of re-tessellated every frame.
// Why: Kaplay's drawRect(radius+outline) / drawLines(round join) / drawCircle build polygons on the CPU (arc points, per-vertex objects). The old
// drawPaper alone issued ~60 line draws + scribbles per lane and frame, and every platform ~10 more, times 4 lanes (own + 3 thumbnails): the main
// thread sat at 100% in kaplay's polygon code. Now one lane frame = a handful of textured quads.
// `createArt(k, px)` returns the sprites for one Kaplay instance at `px` texture pixels per lane px (2 = main lane, 1 = thumbnails; shared by all lanes).
import { W, H } from './sim.js';

export const PAPER = '#fbf8ee', GRID = '#bcd5ea', INK = '#2b2f4a', PENCIL = '#7b8196';
export const GRID_STEP = 36;

const stores = new WeakMap();   // k -> Map(px -> art)

function rrect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function poly(g, pts, close = false) {
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
  if (close) g.closePath();
}
function stroke(g, color, width, alpha = 1) { g.strokeStyle = color; g.lineWidth = width; g.globalAlpha = alpha; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(); g.globalAlpha = 1; }
function fill(g, color, alpha = 1) { g.fillStyle = color; g.globalAlpha = alpha; g.fill(); g.globalAlpha = 1; }
function disc(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); }

export function createArt(k, px = 1) {
  let byPx = stores.get(k);
  if (!byPx) stores.set(k, (byPx = new Map()));
  if (byPx.has(px)) return byPx.get(px);

  const cache = new Map();
  /** a w x h lane-px sprite; draw(g) paints in lane px with the origin in its top-left corner */
  const bake = (key, w, h, draw) => {
    let e = cache.get(key);
    if (e) return e;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w * px)); cv.height = Math.max(1, Math.ceil(h * px));
    const g = cv.getContext('2d');
    g.scale(cv.width / w, cv.height / h);
    draw(g);
    e = { tex: k.SpriteData.fromImage(cv, { singular: true }).tex, w, h };
    cache.set(key, e);
    return e;
  };
  /** draws a baked sprite with its top-left (or `anchor`) at (x, y); o: width/height override, angle, opacity */
  const blit = (e, x, y, o = {}) => k.drawUVQuad({
    tex: e.tex, pos: k.vec2(x, y), width: o.width ?? e.w, height: o.height ?? e.h, anchor: o.anchor ?? 'topleft', angle: o.angle ?? 0, opacity: o.opacity ?? 1, flipX: !!o.flipX,
  });

  // ---- the notebook page: paper + grid + red margin, one tile tall enough to cover the lane at any scroll offset
  const paper = () => bake('paper', W, H + GRID_STEP, (g) => {
    g.fillStyle = PAPER; g.fillRect(0, 0, W, H + GRID_STEP);
    g.beginPath();
    for (let y = 0; y <= H + GRID_STEP; y += GRID_STEP) { g.moveTo(0, y); g.lineTo(W, y); }
    for (let x = 0; x <= W; x += GRID_STEP) { g.moveTo(x, 0); g.lineTo(x, H + GRID_STEP); }
    stroke(g, GRID, 1.4, 0.8);
    poly(g, [[84, 0], [84, H + GRID_STEP]]); stroke(g, '#e8a0a0', 2.5, 0.9);
    poly(g, [[90, 0], [90, H + GRID_STEP]]); stroke(g, '#e8a0a0', 1.5, 0.6);
  });
  const hole = () => bake('hole', 30, 30, (g) => { disc(g, 15, 15, 11); fill(g, '#d4cfbd'); stroke(g, '#b5af99', 2); });

  // ---- scribbles that sit in the world (kinds 0,1,2,4,5; kind 3 is text), drawn centred on the sprite
  const SC = { w: 120, h: 110, cx: 60, cy: 55 };
  const scribble = (kind) => bake(`scribble${kind}`, SC.w, SC.h, (g) => {
    g.translate(SC.cx, SC.cy);
    if (kind === 0) { poly(g, [[-44, 12], [-40, -8], [-22, -22], [-2, -28], [24, -20], [44, -4], [42, 12], [-44, 12]]); stroke(g, PENCIL, 2.5, 0.6); }
    else if (kind === 1) {
      const pts = []; for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (i * Math.PI * 4) / 5, r = i % 2 ? 11 : 26; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
      poly(g, pts); stroke(g, '#d9a441', 2.5, 0.7);
    } else if (kind === 2) {
      const pts = []; for (let i = 0; i < 60; i++) { const a = i * 0.45, r = 3 + i * 0.55; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
      poly(g, pts); stroke(g, '#6d8fd0', 2.2, 0.55);
    } else if (kind === 4) { poly(g, [[0, 24], [-26, -2], [-20, -22], [0, -10], [20, -22], [26, -2], [0, 24]]); stroke(g, '#d9645a', 2.5, 0.6); }
    else {
      disc(g, 0, 0, 24); stroke(g, '#6d8fd0', 2.5, 0.55);
      disc(g, -8, -6, 2.5); fill(g, '#6d8fd0', 0.6); disc(g, 8, -6, 2.5); fill(g, '#6d8fd0', 0.6);
      poly(g, [[-11, 6], [0, 13], [11, 6]]); stroke(g, '#6d8fd0', 2.2, 0.55);
    }
  });

  // ---- platforms: `w` is rounded, so there are at most ~45 widths per type. Origin of the sprite = platform top-left minus (PAD_X, PAD_Y).
  const PLAT = { padX: 22, padY: 6, h: 14 };
  const plat = (type, wIn) => {
    const w = Math.round(wIn), { padX: ax, padY: ay, h } = PLAT;
    return bake(`${type}${w}`, w + ax * 2, h + ay * 2, (g) => {
      rrect(g, ax, ay, w, h, 5); fill(g, type === 'moving' ? '#8ecbff' : '#9ae6a8'); stroke(g, INK, 3);
      poly(g, [[ax + 4, ay + 4], [ax + w - 4, ay + 4]]); stroke(g, '#ffffff', 1.6, 0.7);
      for (let i = 1; i < 5; i++) { const x = ax + (w * i) / 5; poly(g, [[x, ay + 8], [x - 6, ay + 13]]); stroke(g, INK, 1.6, 0.35); }
      if (type === 'moving') {
        for (const [x0, d] of [[ax - 12, 1], [ax + w + 12, -1]]) { poly(g, [[x0 + 8 * d, ay + 1], [x0, ay + 7], [x0 + 8 * d, ay + 13]]); stroke(g, INK, 2.5); poly(g, [[x0, ay + 7], [x0 + 16 * d, ay + 7]]); stroke(g, INK, 2.5); }
      }
    });
  };
  /** one half of a crumbling Pfand carton, centred on the sprite */
  const crumbleHalf = (hwIn) => {
    const hw = Math.round(hwIn);
    return bake(`crumble${hw}`, hw + 8, 22, (g) => {
      rrect(g, 4, 4, hw, 14, 3); fill(g, '#d8b27a'); stroke(g, INK, 3);
      poly(g, [[12, 9], [18, 14], [24, 9]]); stroke(g, '#8a6a3a', 2);
    });
  };
  /** Döner spring coil, 30 x 28: coil tip at y=4, base at y=24 (stretch it vertically around the base) */
  const coil = () => bake('coil', 30, 28, (g) => {
    const pts = [[15, 24]]; for (let i = 0; i < 6; i++) pts.push([15 + (i % 2 ? 10 : -10), 24 - (20 * (i + 1)) / 7]); pts.push([15, 4]);
    poly(g, pts); stroke(g, '#d94a4a', 3.5);
  });

  // ---- Club-Mate bottle, centred on the sprite (2*size square)
  const bottle = (size, glow) => bake(`bottle${size}${glow ? 'g' : ''}`, size * 2, size * 2, (g) => {
    const x = size, y = size;
    if (glow) { disc(g, x, y, size * 0.9); fill(g, '#ffe066', 0.35); }
    const box = (bx, by, bw, bh, r, color, lw) => { rrect(g, bx, by, bw, bh, r); fill(g, color); if (lw) stroke(g, INK, lw); };
    box(x - size * 0.28, y - size * 0.4, size * 0.56, size * 0.9, 5, '#2e8b57', 2.5);
    box(x - size * 0.14, y - size * 0.66, size * 0.28, size * 0.3, 3, '#2e8b57', 2.5);
    box(x - size * 0.17, y - size * 0.74, size * 0.34, size * 0.1, 2, '#d9d9d9', 2);
    g.fillStyle = '#fff3b0'; g.fillRect(x - size * 0.22, y - size * 0.1, size * 0.44, size * 0.3);
    g.fillStyle = INK; g.font = `${Math.max(10, size * 0.28)}px monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('M', x, y + size * 0.05);
  });

  // ---- the seagull (facing right; flip for left): body once, the wing in 9 flap poses. Both centred on (50, 40) = the gull's position.
  const G = { w: 100, h: 80, cx: 50, cy: 40, flaps: 9 };
  const gullBody = () => bake('gullBody', G.w, G.h, (g) => {
    g.translate(G.cx, G.cy);
    poly(g, [[-22, -3], [-40, -8], [-24, 5]], true); fill(g, '#cfd8e3'); stroke(g, INK, 2.5);
    g.beginPath(); g.ellipse(0, 0, 24, 12, 0, 0, Math.PI * 2); fill(g, '#ffffff'); stroke(g, INK, 3);
    disc(g, 20, -7, 9); fill(g, '#ffffff'); stroke(g, INK, 3);
    poly(g, [[27, -9], [42, -5], [27, -2]], true); fill(g, '#ffb02e'); stroke(g, INK, 2.5);
    disc(g, 22, -9, 2.4); fill(g, INK);
    poly(g, [[12, -14], [28, -15]]); stroke(g, INK, 2.5);
  });
  /** flap in -1..1 */
  const gullWing = (flap) => {
    const i = Math.max(0, Math.min(G.flaps - 1, Math.round(((flap + 1) / 2) * (G.flaps - 1))));
    const f = (i / (G.flaps - 1)) * 2 - 1;
    return bake(`gullWing${i}`, G.w, G.h, (g) => {
      g.translate(G.cx, G.cy);
      poly(g, [[-6, -4], [-26, -12 - f * 22], [-36, -6 - f * 26], [-14, 4]], true); fill(g, '#e9eef5'); stroke(g, INK, 2.5);
    });
  };
  // ---- the Ordnungsamt drone (without the spinning rotor blades), `light` = 0/1 (red / blue), centred on (40, 25) = the drone's position
  const D = { w: 80, h: 125, cx: 40, cy: 25 };
  const drone = (light) => bake(`drone${light}`, D.w, D.h, (g) => {
    g.translate(D.cx, D.cy);
    poly(g, [[-8, 10], [8, 10], [34, 100], [-34, 100]], true); fill(g, '#ffe066', 0.22);
    for (const sg of [-1, 1]) { poly(g, [[sg * 30, -16], [sg * 30, -8]]); stroke(g, INK, 2.5); }
    rrect(g, -30, -8, 60, 22, 9); fill(g, '#4b5563'); stroke(g, INK, 3);
    rrect(g, -22, -3, 44, 8, 3); fill(g, '#9ca3af');
    g.fillStyle = INK; g.font = '11px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('AMT', 0, 1);
    disc(g, 0, 14, 4); fill(g, light ? '#ff4d4d' : '#4dc3ff'); stroke(g, INK, 1.5);
  });

  // ---- HUD pieces: each baked with a canvas origin at the given lane position
  const HUD = {
    main: { x: 10, y: 0 }, thumb: { x: 122, y: 4 }, clock: { x: W - 92, y: 12 },
  };
  const hudMain = () => bake('hudMain', 266, 96, (g) => {
    g.translate(-HUD.main.x, -HUD.main.y);
    rrect(g, 18, 14, 250, 74, 6); fill(g, '#fff6a8', 0.95); stroke(g, '#c9a400', 3, 0.95);
    rrect(g, 100, 6, 86, 20, 3); fill(g, '#f2e27a', 0.9);
  });
  const hudThumb = () => bake('hudThumb', 716, 166, (g) => {
    g.translate(-HUD.thumb.x, -HUD.thumb.y);
    rrect(g, 130, 12, 700, 150, 8); fill(g, '#fff6a8', 0.95); stroke(g, '#c9a400', 4, 0.95);
  });
  const hudClock = () => bake('hudClock', 80, 80, (g) => { disc(g, 40, 40, 34); fill(g, PAPER, 0.95); stroke(g, INK, 3.5, 0.95); });

  const art = { gullBody, gullWing, G, drone, D, blit, paper, hole, scribble, SC, plat, PLAT, crumbleHalf, coil, bottle, hudMain, hudThumb, hudClock, HUD };
  byPx.set(px, art);
  return art;
}
