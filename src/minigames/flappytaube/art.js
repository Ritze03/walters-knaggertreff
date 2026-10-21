// Flappy Taube: everything that is drawn with Kaplay shapes (pigeon, obstacles, seagull, skyline). No game logic.
import { createRng } from '../../contracts.js';
import { box, disc, label } from '../draw.js';
import { KINDS, GROUND, W } from './sim.js';

const poly = (k, parent, x, y, pts, color) => parent.add([k.pos(x, y), k.polygon(pts.map(([a, b]) => k.vec2(a, b))), k.color(k.rgb(color))]);

/** A Berlin pigeon facing right, origin = body centre. Returns { obj, flap(), setPose(vy, dt, dead) }. */
export function addPigeon(k, parent, capColor = '#ff5a4a') {
  const obj = parent.add([k.pos(0, 0), k.rotate(0)]);
  poly(k, obj, 0, 0, [[-14, -4], [-40, -12], [-42, 4], [-34, 12], [-12, 8]], '#657180');      // tail
  poly(k, obj, 0, 0, [[-30, -2], [-44, -4], [-44, 2]], '#4a5460');
  box(k, obj, -6, 14, 3, 11, '#ff9e3d'); box(k, obj, 6, 14, 3, 11, '#ff9e3d');                // legs
  box(k, obj, -9, 23, 9, 3, '#ff9e3d'); box(k, obj, 3, 23, 9, 3, '#ff9e3d');
  disc(k, obj, 0, 0, 19, '#9aa7b4', { outline: [3, '#4a5460'] });                              // body
  disc(k, obj, 4, 6, 12, '#c9d1d9');                                                           // belly
  disc(k, obj, 13, -9, 10, '#5fc9a0');                                                         // neck sheen (green/purple, very Berlin)
  disc(k, obj, 11, -6, 6, '#a478d8');
  disc(k, obj, 17, -15, 11, '#8f9ca9', { outline: [3, '#4a5460'] });                           // head
  poly(k, obj, 0, 0, [[25, -18], [38, -13], [25, -9]], '#ffb347');                           // beak
  disc(k, obj, 22, -17, 4.5, '#ffffff'); disc(k, obj, 23.5, -17, 2.2, '#101010');              // eye
  box(k, obj, 9, -29, 17, 7, capColor, { anchor: 'center', radius: 3, outline: [2, '#101010'] });   // seat-coloured cap
  box(k, obj, 24, -26, 12, 4, capColor, { anchor: 'center', outline: [2, '#101010'] });
  const wing = obj.add([k.pos(-4, -3), k.rotate(25)]);
  poly(k, wing, 0, 0, [[4, -4], [-24, -14], [-34, 6], [-22, 16], [2, 12]], '#6c7885');
  poly(k, wing, 0, 0, [[-8, -2], [-30, 2], [-22, 12]], '#56606c');
  let flapT = 0;
  return {
    obj, wing,
    flap() { flapT = 0.22; },
    setPose(vy, dt, dead) {
      flapT = Math.max(0, flapT - dt);
      wing.angle = dead ? 70 : flapT > 0 ? -65 + (1 - flapT / 0.22) * 70 : 25 + Math.sin(performance.now() / 90) * 4;
      obj.angle = dead ? 90 : Math.max(-22, Math.min(55, vy * 0.06));
    },
  };
}

/** A seagull (cosmetic rival) facing left. Returns { obj, setWing(phase) }. */
export function addGull(k, parent) {
  const obj = parent.add([k.pos(0, 0)]);
  poly(k, obj, 0, 0, [[12, -2], [34, -6], [34, 4], [12, 8]], '#e9eef2');                       // tail (right, as it flies left)
  disc(k, obj, 0, 0, 17, '#ffffff', { outline: [3, '#8a96a3'] });
  disc(k, obj, -20, -5, 10, '#ffffff', { outline: [3, '#8a96a3'] });
  poly(k, obj, 0, 0, [[-28, -8], [-44, -3], [-28, -1]], '#ffb000');
  disc(k, obj, -23, -8, 3.5, '#101010');
  box(k, obj, -30, -8, 10, 2, '#101010', { angle: 18, anchor: 'center' });                     // angry brow
  const wing = obj.add([k.pos(2, -4), k.scale(1, 1)]);
  poly(k, wing, 0, 0, [[-8, 0], [10, -4], [34, -46], [22, -50], [-4, -30]], '#dfe6ec');
  poly(k, wing, 0, 0, [[22, -50], [34, -46], [30, -34]], '#4a5460');
  return { obj, setWing(ph) { wing.scale = k.vec2(1, Math.sin(ph)); } };
}

// ---- obstacles -------------------------------------------------------------------------------------------------

/** Draws the two pieces of obstacle `o` into a container whose x = the gap column centre (y absolute). Returns the container. */
export function buildObstacle(k, parent, o) {
  const c = parent.add([k.pos(0, 0)]);
  const gTop = o.c - o.h / 2, gBot = o.c + o.h / 2;
  const id = KINDS[o.kind].id;
  const D = { plattenbau, fernsehturm, laterne, kran, spaeti }[id];
  D(k, c, -80, gTop, 'top', o.i);
  D(k, c, gBot, GROUND + 20, 'bottom', o.i);
  return c;
}

// each drawer: (k, c, y0, y1, side, seedNum). side === 'top' -> the gap is at y1, 'bottom' -> the gap is at y0
function plattenbau(k, c, y0, y1, side, n) {
  const w = 104, len = y1 - y0;
  box(k, c, -w / 2, y0, w, len, '#a9aeb5', { outline: [4, '#5d636b'] });
  const rows = Math.floor((len - 22) / 36);
  for (let r = 0; r < rows; r++) for (let q = 0; q < 3; q++) {
    const lit = (n + r * 2 + q * 3) % 4 === 0, y = side === 'top' ? y1 - 34 - r * 36 : y0 + 24 + r * 36;
    box(k, c, -38 + q * 28, y, 20, 24, lit ? '#ffe08a' : '#5f8097', { outline: [2, '#454c54'] });
  }
  if (side === 'top') box(k, c, -w / 2, y1 - 12, w, 12, '#7a7f86'); else box(k, c, -w / 2, y0, w, 12, '#7a7f86');
  if (side === 'bottom') {   // satellite dish + a plant that gave up
    disc(k, c, -20, y0 - 2, 14, '#f4f4f4', { outline: [3, '#5d636b'] });
    box(k, c, -22, y0 - 2, 4, 14, '#5d636b');
    if (n % 2) label(k, c, '🪴', 26, y0 - 12, { size: 30 });
  } else if (n % 3 === 0) label(k, c, '🧺', 24, y1 + 6, { size: 28 });     // laundry hanging from the upside-down block
}

function fernsehturm(k, c, y0, y1, side) {
  const r = 39, ballY = side === 'top' ? y1 - r : y0 + r;
  box(k, c, -13, y0, 26, y1 - y0, '#c7ccd2', { outline: [3, '#6f7780'] });
  for (let y = y0 + 20; y < y1 - 10; y += 46) box(k, c, -13, y, 26, 8, '#e24a3a');
  disc(k, c, 0, ballY, r, '#dde3e9', { outline: [4, '#6f7780'] });
  disc(k, c, -12, ballY - 14, 9, '#ffffff', { opacity: 0.8 });
  // googly eyes: the tower stares at you
  disc(k, c, -13, ballY + 2, 11, '#ffffff', { outline: [2, '#101010'] }); disc(k, c, 13, ballY + 2, 11, '#ffffff', { outline: [2, '#101010'] });
  disc(k, c, -9, ballY + 5, 5, '#101010'); disc(k, c, 9, ballY + 5, 5, '#101010');
  box(k, c, -12, ballY + 22, 24, 4, '#6f7780', { radius: 2 });
}

function laterne(k, c, y0, y1, side) {
  box(k, c, -7, y0, 14, y1 - y0, '#2f5a45', { outline: [2, '#173026'] });
  const headY = side === 'top' ? y1 - 30 : y0;
  box(k, c, -38, headY, 76, 30, '#2a2f36', { radius: 6, outline: [3, '#101418'] });
  box(k, c, -30, side === 'top' ? headY + 14 : headY + 6, 60, 12, '#ffe58a', { radius: 4 });
  if (side === 'bottom') for (let y = y0 + 80; y < y1 - 20; y += 90) box(k, c, -11, y, 22, 7, '#e6c200');   // reflective tape
  else label(k, c, '🦇', 0, y1 - 54, { size: 26 });
}

function kran(k, c, y0, y1, side, n) {
  if (side === 'bottom') {
    box(k, c, -20, y0 + 26, 40, y1 - y0 - 26, '#f2b705', { outline: [3, '#8a6700'] });
    for (let y = y0 + 40; y < y1 - 10; y += 34) { box(k, c, -20, y, 40, 5, '#8a6700'); box(k, c, 0, y, 4, 34, '#8a6700', { angle: 0 }); }
    box(k, c, -59, y0, 118, 26, '#f2b705', { outline: [3, '#8a6700'] });
    box(k, c, 34, y0 + 2, 22, 22, '#5d636b');                                         // counterweight
    box(k, c, -52, y0 + 6, 22, 14, '#3a6ea5', { radius: 3, outline: [2, '#173050'] });   // cabin
    label(k, c, '👷', -41, y0 - 14, { size: 30 });
  } else {
    const r = 36, by = y1 - r;
    box(k, c, -5, y0, 10, by - y0, '#4a4f57');
    for (let y = y0 + 6; y < by - 12; y += 22) box(k, c, -8, y, 16, 8, '#2b2f35', { radius: 3 });
    disc(k, c, 0, by, r, '#2d2d33', { outline: [4, '#0e0e12'] });
    disc(k, c, -11, by - 4, 9, '#ffffff'); disc(k, c, 11, by - 4, 9, '#ffffff');
    disc(k, c, -9, by - 2, 4, '#101010'); disc(k, c, 13, by - 2, 4, '#101010');
    box(k, c, -22, by - 18, 18, 4, '#101010', { angle: 18, anchor: 'center' }); box(k, c, 22, by - 18, 18, 4, '#101010', { angle: -18, anchor: 'center' });
    box(k, c, -14, by + 14, 28, 5, '#101010', { radius: 2 });
  }
}

function spaeti(k, c, y0, y1, side) {
  const len = y1 - y0;
  if (side === 'bottom') {
    box(k, c, -54, y0 + 28, 108, len - 28, '#eadcb2', { outline: [3, '#8a7a4c'] });
    for (let q = 0; q < 6; q++) box(k, c, -66 + q * 22, y0, 22, 28, q % 2 ? '#ffffff' : '#d33a2c', { outline: [2, '#7a1d14'] });   // awning
    label(k, c, 'SPÄTI', 0, y0 + 56, { size: 24, color: '#2b2b2b' });
    if (len > 150) {
      box(k, c, -34, y0 + 84, 68, len - 90, '#3d6b8a', { outline: [3, '#173050'] });
      label(k, c, '24/7', 0, y0 + 104, { size: 18, color: '#ffe58a' });
      label(k, c, '🍺', 0, y0 + 140, { size: 26 });
    }
  } else {
    const h = 90;
    box(k, c, -4, y0, 8, len - h, '#5d636b');
    disc(k, c, 0, y0 + 10, 9, '#9aa0a8', { outline: [3, '#5d636b'] });                  // hook
    box(k, c, -33, y1 - h, 66, h, '#8b4a2b', { radius: 24, outline: [4, '#4a230f'] });   // the Döner
    for (let y = y1 - h + 18; y < y1 - 14; y += 18) box(k, c, -30, y, 60, 4, '#5a2c14');
    box(k, c, -30, y1 - h + 4, 60, 12, '#6fbf4a', { radius: 6 });                        // salad hat
    label(k, c, '🔥', 0, y1 - 16, { size: 24 });
  }
}

// ---- backdrop ---------------------------------------------------------------------------------------------------

/** a repeating skyline strip of cycle length L (content for x in 0..L + W), scroll it by moving the returned container. */
export function addSkyline(k, parent, L, seedN, color, hMin, hMax, tower) {
  const strip = parent.add([k.pos(0, 0)]);
  for (const off of [0, L]) {
    const r = createRng(seedN);
    let x = 0;
    while (x < L) {
      const w = 56 + Math.floor(r.next() * 80), h = hMin + r.next() * (hMax - hMin);
      box(k, strip, off + x, GROUND - h, w, h + 4, color);
      if (r.next() < 0.3) box(k, strip, off + x + w * 0.3, GROUND - h - 14, 6, 14, color);
      x += w + Math.floor(r.next() * 14);
    }
    if (tower) {
      const tx = off + L * 0.62;
      box(k, strip, tx - 5, GROUND - 330, 10, 330, color);
      disc(k, strip, tx, GROUND - 330, 26, color);
      box(k, strip, tx - 2, GROUND - 400, 4, 70, color);
    }
  }
  return strip;
}

export function addSky(k, parent) {
  const cols = ['#4aa8ec', '#5db4ef', '#72c0f2', '#88cbf4', '#a0d6f6', '#b8e1f8', '#cfeafa', '#e1f3fb'];
  cols.forEach((col, i) => box(k, parent, 0, (i * GROUND) / cols.length, W, GROUND / cols.length + 1, col));
  disc(k, parent, 790, 110, 70, '#fff6c2', { opacity: 0.35 });
  disc(k, parent, 790, 110, 44, '#fff2a8');
}

export function addCloud(k, parent, x, y, s) {
  const c = parent.add([k.pos(x, y)]);
  for (const [dx, dy, r] of [[0, 0, 30], [32, -12, 38], [70, 0, 30], [30, 12, 30]]) disc(k, c, dx * s, dy * s, r * s, '#ffffff', { opacity: 0.92 });
  return c;
}
