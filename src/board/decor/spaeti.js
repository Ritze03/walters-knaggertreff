// Visuals for board "spaeti" (Späti-Kiez), D17: only Kaplay shapes + text + emoji. Berlin night: Spree, Plattenbau, Fernsehturm,
// two Spätis, a Döner stand, the broken Pfandautomat, an Ordnungsamt van on patrol and the Müllabfuhr parked in the Hinterhof.
import { makeDraw, rngFor, shade } from '../draw.js';

export const eventIcons = { pfandautomat: '🏧', doener: '🥙', mittwoch: '🐸', ordnungsamt: '👮', rabatt: '🏷️', muellabfuhr: '🗑️' };
/** names for the 'path' prompt, by the first space of each branch */
export const pathLabels = { s06: 'Hauptstraße', h1: 'Hinterhof (Müllabfuhr!)', s21: 'Spreeufer', t1: 'Spätkauf-Passage' };

const BUILDINGS = [
  [500, 520, 230, 170, '#6f6c96'], [500, 735, 190, 135, '#7a6f94'], [770, 580, 170, 140, '#5f6e96'],
  [1250, 600, 200, 180, '#7c6a8f'], [1500, 520, 210, 170, '#6a7095'], [1490, 735, 180, 140, '#74708f'], [1260, 815, 170, 90, '#6a6c8d'],
];

export default function buildDecor({ k, back, board, anim }) {
  const d = makeDraw(k);
  const at = (id) => board.spaces.find((s) => s.id === id);
  const rng = rngFor(4711);

  // static random bits, built once
  const twinkle = Array.from({ length: 18 }, () => ({ x: rng.int(20, 2180), y: rng.int(8, 112), p: rng.next() * 6, s: rng.int(2, 4) }));
  const windows = BUILDINGS.map(([x, y, w, h]) => {
    const out = [];
    for (let wy = y + 34; wy < y + h - 24; wy += 34) for (let wx = x + 16; wx < x + w - 24; wx += 36) out.push({ x: wx, y: wy, lit: rng.next() < 0.55, warm: rng.next() < 0.7 });
    return out;
  });
  const bottles = Array.from({ length: 16 }, () => ({ x: rng.int(140, 2060), y: rng.int(230, 1340), a: rng.int(-70, 70), s: rng.int(20, 28) }));
  const lamps = board.spaces.filter((_, i) => i % 4 === 1).map((s, i) => ({ x: s.x + (s.y > 700 ? 0 : 0) + (i % 2 ? 46 : -46), y: s.y - 52, p: i * 1.3 }));

  const van = { x: 300, y: 1345, dir: 1, mode: 'patrol', flash: 0 };
  const truck = { x: 880, y: 915, mode: 'parked', angle: 0, blink: 0 };

  back.onUpdate(() => {
    const dt = k.dt();
    van.flash += dt;
    truck.blink += dt;
    if (van.mode === 'patrol') {
      van.x += van.dir * 90 * dt;
      if (van.x > 2050) van.dir = -1;
      if (van.x < 160) van.dir = 1;
    }
  });

  /** everything that never moves; baked once into a texture by the scene (see scene.js) */
  function drawStatic() {
    const W = board.world.w, H = board.world.h;
    // sky + moon
    d.rect(-400, -300, W + 800, 430, '#1d1740');
    d.circle(1950, 62, 34, '#fff3c4'); d.circle(1964, 54, 30, '#1d1740');
    // Spree
    d.rect(-400, 118, W + 800, 90, '#27508f');
    d.text('~ Spree ~', 1650, 175, 26, '#a9d0ff', { a: 0.6, line: 0 });
    d.rect(-400, 200, W + 800, 10, '#1d1a38');
    // Kiez ground
    d.rect(-400, 208, W + 800, H - 208 + 500, '#3d3566');   // generously oversized: the camera may look past the edges
    d.rect(70, 215, W - 140, H - 250, '#4a4177', { r: 60 });
    d.rect(110, 235, W - 220, H - 320, '#443b70', { r: 50 });
    // Hinterhof + Passage patches
    d.rect(840, 900, 600, 230, '#4c5a45', { r: 40 });
    d.text('HINTERHOF', 1140, 1105, 30, '#d4e8c0', { a: 0.55, line: 0 });
    d.rect(800, 300, 540, 190, '#5d5780', { r: 36 });
    d.text('SPÄTKAUF-PASSAGE', 1070, 335, 26, '#e8e0ff', { a: 0.5, line: 0 });
    // Plattenbauten
    BUILDINGS.forEach(([x, y, w, h, c], bi) => {
      d.rect(x + 12, y + 14, w, h, '#000000', { a: 0.25 });
      d.rect(x, y, w, h, c, { line: 4 });
      d.rect(x, y, w, 20, shade(c, 0.3), { line: 0 });
      for (const wd of windows[bi]) d.rect(wd.x, wd.y, 22, 20, wd.lit ? (wd.warm ? '#ffd86b' : '#9ee7ff') : '#2a2748', { line: 2 });
    });
    d.text('PLATTENBAU', 615, 497, 18, '#c9c4ff', { a: 0.5, line: 0 });
    // Fernsehturm
    const tx = 1090, ty = 950;
    d.ellipse(tx, ty + 6, 70, 18, '#000000', { a: 0.3 });
    d.poly([[tx - 36, ty], [tx + 36, ty], [tx + 9, 780], [tx - 9, 780]], '#b8bcd6', { line: 3 });
    d.rect(tx - 5, 560, 10, 230, '#9ca1c4', { line: 2 });
    d.circle(tx, 730, 52, '#c9ccdf', { line: 4 });
    d.circle(tx - 14, 718, 14, '#ffffff', { a: 0.55 });
    d.rect(tx - 50, 722, 100, 14, '#6e8fd6', { line: 2 });
    d.line(tx, 560, tx, 480, 6, '#9ca1c4');
    // Pfandautomat (kaputt)
    const pa = at('s03');
    d.rect(pa.x - 36, pa.y + 76, 72, 80, '#8e96a8', { r: 8, line: 4 });
    d.rect(pa.x - 22, pa.y + 86, 44, 18, '#2b2f3d', { r: 4 });
    d.text('KAPUTT', pa.x, pa.y + 142, 14, '#ffe08a', { line: 2 });
    // Spätis: Markise, Leuchtschild, Flaschenregal
    for (const id of ['s07', 't2']) {
      const s = at(id);
      const x = s.x - 110, y = s.y + 62;
      d.rect(x + 8, y + 10, 220, 112, '#000000', { a: 0.25 });
      d.rect(x, y, 220, 112, '#d9c7a0', { r: 6, line: 4 });
      for (let i = 0; i < 8; i++) d.rect(x + i * 27.5, y - 4, 27.5, 30, i % 2 ? '#ffffff' : '#e03c3c', { line: 2 });
      d.rect(x + 14, y + 38, 192, 60, '#2c3a58', { r: 4, line: 3 });
      for (let i = 0; i < 6; i++) d.text('🍾', x + 36 + i * 30, y + 62, 24, '#fff', { line: 0 });
      d.text('SPÄTI', x + 110, y - 22, 28, '#6cf86c', { line: 4, lineColor: '#0c2a0c' });
      d.text('24/7', x + 110, y + 106, 16, '#ffd34d', { line: 2 });
    }
    // Döner-Bude
    const dn = at('s12');
    const dx = dn.x + 110, dy = dn.y - 20;
    d.rect(dx - 52, dy - 10, 104, 90, '#d94e3a', { r: 8, line: 4 });
    d.rect(dx - 44, dy + 6, 88, 34, '#fff2c9', { r: 4, line: 2 });
    d.rect(dx - 62, dy - 30, 124, 26, '#27a85a', { r: 6, line: 3 });
    d.text('DÖNER', dx, dy - 17, 18, '#ffffff', { line: 3 });
    d.rect(dx - 3, dy + 40, 6, 36, '#aaa', { line: 0 });
    // Lampen
    for (const l of lamps) {
      d.line(l.x, l.y, l.x, l.y + 46, 5, '#262238');
      d.circle(l.x, l.y - 2, 22, '#ffe9a0', { a: 0.14 });
      d.circle(l.x, l.y - 2, 9, '#ffe9a0');
    }
    for (const b of bottles) d.text('🍾', b.x, b.y, b.s, '#fff', { angle: b.a, line: 0, a: 0.8 });
    sign(d, 'Karl-Marx-Allee', 2020, 760, 90);
    sign(d, 'Kastanienallee', 150, 700, -90);
    sign(d, 'Hauptstraße', 560, 1320, 0);
  }

  /** the few things that animate every frame (kept tiny: each draw call costs) */
  back.onDraw(() => {
    const t = k.time();
    for (const s of twinkle) d.circle(s.x, s.y, s.s * (0.6 + 0.4 * Math.sin(t * 2 + s.p)), '#fff6c8', { a: 0.5 + 0.5 * Math.sin(t * 2 + s.p) });
    for (let i = 0; i < 6; i++) {
      const wx = ((i * 380 + t * 24) % 2400) - 100;
      d.line(wx, 150 + (i % 4) * 14, wx + 70, 150 + (i % 4) * 14, 4, '#6fa8e8', { a: 0.6 });
    }
    d.circle(1090, 478, 7 + 2 * Math.sin(t * 6), Math.sin(t * 3) > 0 ? '#ff4d4d' : '#6b1c1c');
    const pa = at('s03');
    d.circle(pa.x + 18, pa.y + 120, 6, Math.sin(t * 8) > 0 ? '#ff3b3b' : '#601818');
    const dn = at('s12');
    const wob = Math.sin(t * 4) * 3;
    for (let i = 0; i < 5; i++) d.ellipse(dn.x + 110 + wob * (i % 2 ? 1 : -1) * 0.3, dn.y + 26 + i * 7, 18 - Math.abs(i - 2) * 3, 6, i % 2 ? '#a4572a' : '#c27a43');
    drawVan(d, van, t);
    drawTruck(d, truck, t);
  });

  // ---- special event animations (return a promise) ----
  async function ordnungsamt(spaceId) {
    const s = at(spaceId);
    const home = { x: van.x, y: van.y };
    van.mode = 'goto';
    van.dir = s.x >= van.x ? 1 : -1;
    const fromX = van.x;
    const toX = s.x + 130, toY = s.y + 74;
    await anim.tween(0.7, (p) => { van.x = fromX + (toX - fromX) * p; van.y = home.y + (toY - home.y) * p; }, anim.ease.easeOutCubic);
    van.dir = -1;
    await anim.wait(1.0);
    await anim.tween(0.6, (p) => { van.x = toX + (home.x - toX) * p; van.y = toY + (home.y - toY) * p; }, anim.ease.easeInQuad);
    van.dir = 1;
    van.mode = 'patrol';
  }

  async function muellabfuhr() {
    const route = ['h1', 'h2', 'h3', 'h4'].map(at);
    const park = { x: truck.x, y: truck.y };
    truck.mode = 'driving';
    const pts = [{ x: route[0].x - 160, y: route[0].y - 70 }, ...route.map((s) => ({ x: s.x, y: s.y - 60 })), { x: route[3].x + 200, y: route[3].y - 60 }];
    let cur = { x: park.x, y: park.y };
    for (const p of pts) {
      const from = cur;
      await anim.tween(0.38, (q) => { truck.x = from.x + (p.x - from.x) * q; truck.y = from.y + (p.y - from.y) * q; });
      cur = p;
    }
    await anim.tween(0.5, (q) => { truck.x = cur.x + (park.x - cur.x) * q; truck.y = cur.y + (park.y - cur.y) * q; }, anim.ease.easeInOutQuad);
    truck.mode = 'parked';
  }

  return {
    eventIcons,
    pathLabels,
    drawStatic,
    /** extra visuals for an event space; resolves when the show is over (never needed to be awaited for correctness) */
    event(eventId, spaceId) {
      if (eventId === 'ordnungsamt') return ordnungsamt(spaceId);
      if (eventId === 'muellabfuhr') return muellabfuhr();
      return null;
    },
  };
}

function sign(d, text, x, y, angle) {
  d.rect(x, y, 150, 34, '#1f4f9a', { anchor: 'center', r: 5, line: 3, angle, lineColor: '#ffffff' });
  d.text(text, x, y, 16, '#ffffff', { angle, line: 0 });
}

function drawVan(d, van, t) {
  const { x, y, dir } = van;
  const f = dir;
  d.ellipse(x, y + 28, 60, 10, '#000000', { a: 0.3 });
  d.rect(x - 56, y - 20, 112, 42, '#f4f4f4', { r: 8, line: 4 });
  d.rect(x - 56, y + 2, 112, 10, '#22b54a');
  d.rect(x + f * 14, y - 36, 40 * f, 24, '#f4f4f4', { r: 6, line: 4 });
  d.rect(x + f * 22, y - 32, 24 * f, 14, '#79c7ff', { r: 3 });
  d.text('ORDNUNGSAMT', x - f * 12, y - 8, 11, '#1b6e33', { line: 0 });
  const on = Math.sin(van.flash * 12) > 0;
  d.rect(x - 14, y - 28, 16, 8, on ? '#2f7bff' : '#1d3a7a', { r: 3, line: 2 });
  d.rect(x + 6, y - 28, 16, 8, on ? '#7a1d1d' : '#ff3b3b', { r: 3, line: 2 });
  if (van.mode === 'goto') d.circle(x, y - 24, 40 + 10 * Math.sin(t * 20), on ? '#2f7bff' : '#ff3b3b', { a: 0.22 });
  for (const wx of [-34, 34]) d.circle(x + wx, y + 22, 10, '#222', { line: 3, lineColor: '#888' });
}

function drawTruck(d, tr, t) {
  const { x, y } = tr;
  const moving = tr.mode === 'driving';
  const bob = moving ? Math.sin(t * 30) * 2 : 0;
  d.ellipse(x, y + 34, 74, 11, '#000000', { a: 0.3 });
  d.rect(x - 70, y - 38 + bob, 100, 62, '#e8791e', { r: 8, line: 4 });
  d.rect(x + 30, y - 22 + bob, 44, 46, '#f0a040', { r: 8, line: 4 });
  d.rect(x + 44, y - 16 + bob, 24, 16, '#79c7ff', { r: 3 });
  d.text('♻', x - 20, y - 8 + bob, 34, '#ffffff', { line: 3 });
  d.text('BSR', x - 20, y + 16 + bob, 14, '#fff3d6', { line: 2 });
  d.circle(x + 66, y - 42 + bob, 6, moving || Math.sin(tr.blink * 6) > 0 ? '#ffd23a' : '#7a5a10', { line: 2 });
  for (const wx of [-44, -8, 50]) d.circle(x + wx, y + 26 + bob, 11, '#222', { line: 3, lineColor: '#999' });
  if (moving) for (let i = 0; i < 3; i++) d.text('🗑️', x - 90 - i * 26, y - 14 + Math.sin(t * 18 + i) * 6, 22, '#fff', { line: 0, a: 0.8 - i * 0.2 });
}
