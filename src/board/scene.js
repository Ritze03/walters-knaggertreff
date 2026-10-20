// The board world: ground/decor, roads, space tiles, star, traps, tokens, camera. Pure view -- everything is driven by calls from index.js.
import { addAvatar } from '../avatar/index.js';
import { SCREEN } from '../contracts.js';
import { makeDraw, shade } from './draw.js';

const TILE = {
  start: { c: '#f5f0e6', icon: '🏁', r: 46 },
  blue: { c: '#3fa9f5', icon: '🍾', r: 36 },
  red: { c: '#ef4b5a', icon: '💸', r: 36 },
  event: { c: '#ffc233', icon: '❓', r: 38 },
  shop: { c: '#3ecf7a', icon: '🏪', r: 50 },
};
const FOLLOW_ZOOM = 0.8;
const TOKEN_SIZE = 54;
const NAME_SIZE = 17;
/** token offsets for 2..4 players on one space: a small fan/grid, the lower ones drawn in front */
const FAN = {
  2: [[-30, 0], [30, 0]],
  3: [[-31, 12], [31, 12], [0, -20]],
  4: [[-31, -22], [31, -22], [-31, 16], [31, 16]],
};

export function createScene({ k, root, board, anim, decorBuild }) {
  const W = k.width?.() || SCREEN.w, H = k.height?.() || SCREEN.h;
  const d = makeDraw(k);
  const spaces = new Map(board.spaces.map((s) => [s.id, s]));
  const spacePos = (id) => { const s = spaces.get(id); return s ? { x: s.x, y: s.y } : { x: board.world.w / 2, y: board.world.h / 2 }; };

  const world = root.add([k.pos(0, 0), k.scale(1)]);
  const back = world.add([k.pos(0, 0)]);
  back.onDraw(() => { decor.drawStatic(); drawRoads(); drawTiles(); });   // static art first, decor's own animated bits after
  const decor = decorBuild({ k, back, board, anim });
  const tiles = world.add([k.pos(0, 0)]);
  const props = world.add([k.pos(0, 0)]);   // star + traps
  const tokenLayer = world.add([k.pos(0, 0)]);
  const nameLayer = world.add([k.pos(0, 0)]);   // name pills above every token (drawn after them, so never hidden)
  const overlay = world.add([k.pos(0, 0)]);  // markers, turn arrow, step badge
  const fxLayer = world.add([k.pos(0, 0)]);

  const view = { endspurt: false, turnSeat: null, badge: null, markers: [], preview: null, starTint: 0 };

  // ---------- roads ----------
  const segs = board.spaces.flatMap((s) => s.next.map((n) => {
    const e = spaces.get(n);
    const len = Math.hypot(e.x - s.x, e.y - s.y);
    return { x1: s.x, y1: s.y, x2: e.x, y2: e.y, len, ux: (e.x - s.x) / len, uy: (e.y - s.y) / len, fork: s.next.length > 1 };
  }));
  const drawRoads = () => {
    for (const g of segs) d.line(g.x1, g.y1, g.x2, g.y2, 54, g.fork ? '#1d1933' : '#25203d');
    for (const g of segs) d.line(g.x1, g.y1, g.x2, g.y2, 44, '#312b52');
    for (const g of segs) {
      for (let a = 36; a < g.len - 36; a += 28) d.line(g.x1 + g.ux * a, g.y1 + g.uy * a, g.x1 + g.ux * (a + 12), g.y1 + g.uy * (a + 12), 4, '#8a82b8', { a: 0.7 });
      // direction chevron
      const mx = g.x1 + g.ux * g.len * 0.5, my = g.y1 + g.uy * g.len * 0.5;
      d.poly([[mx + g.ux * 12, my + g.uy * 12], [mx - g.ux * 8 - g.uy * 11, my - g.uy * 8 + g.ux * 11], [mx - g.ux * 8 + g.uy * 11, my - g.uy * 8 - g.ux * 11]], '#ffffff', { a: 0.55 });
    }
  };

  // ---------- tiles ----------
  const drawTiles = () => {
    board.spaces.forEach((sp) => {
      const T = TILE[sp.type];
      const icon = sp.type === 'event' ? (decor.eventIcons[sp.eventId] ?? T.icon) : T.icon;
      d.ellipse(sp.x + 3, sp.y + T.r * 0.55, T.r * 1.02, T.r * 0.5, '#000000', { a: 0.35 });
      d.circle(sp.x, sp.y, T.r + 5, '#1e1a2e');
      d.circle(sp.x, sp.y, T.r, T.c);
      d.circle(sp.x, sp.y, T.r * 0.78, shade(T.c, 0.28));
      d.text(icon, sp.x, sp.y, T.r * 0.95, '#ffffff', { line: 0 });
      if (sp.label) d.text(sp.label, sp.x, sp.type === 'event' ? sp.y + T.r + 17 : sp.y - T.r - 18, 19, '#ffffff', { line: 5 });
    });
  };
  // static art (decor + roads + tiles) is drawn ONCE into a texture: immediate-mode shapes with outlines are too slow to redraw every frame
  tiles.onDraw(() => {
    if (!view.endspurt) return;
    const t = k.time();
    for (const sp of board.spaces) {
      if (sp.type !== 'blue' && sp.type !== 'red') continue;
      d.circle(sp.x + 28, sp.y - 30, 19 + Math.sin(t * 8) * 2, '#ff5a1f', { line: 4 });
      d.dtext('x2', sp.x + 28, sp.y - 30, 20, '#ffffff', { line: 0 });
    }
  });

  // ---------- star ----------
  const star = { x: 0, y: 0, lift: 0, scale: 1, spin: 0, visible: false, spaceId: null };
  props.onDraw(() => {
    const t = k.time();
    if (star.visible) {
      const x = star.x, y = star.y - 74 - star.lift + Math.sin(t * 3) * 8;
      const s = star.scale * (1 + Math.sin(t * 5) * 0.06);
      d.circle(x, y, (70 + Math.sin(t * 4) * 8) * s, '#ffe14d', { a: 0.16 });
      d.circle(x, y, (48 + Math.sin(t * 4 + 1) * 5) * s, '#fff2a0', { a: 0.25 });
      for (let i = 0; i < 4; i++) {
        const a = t * 1.5 + (i * Math.PI) / 2;
        d.text('✨', x + Math.cos(a) * 54 * s, y + Math.sin(a) * 44 * s, 22 * s, '#ffffff', { line: 0 });
      }
      d.text('⭐', x, y, 72 * s, '#ffffff', { line: 0, angle: Math.sin(t * 2) * 8 + star.spin });
    }
    for (const [id, tr] of traps) {
      const p = spaceAt(id);
      d.text('🪤', p.x, p.y - 8 - tr.dy, 40, '#ffffff', { line: 0 });
      d.circle(p.x + 22, p.y - 26 - tr.dy, 9, tr.color, { line: 3 });
    }
  });
  const spaceAt = (id) => spaces.get(id) ?? { x: 0, y: 0 };
  const traps = new Map();   // spaceId -> { owner, color, dy }

  // ---------- tokens ----------
  const tokens = [];
  const profileColor = {};
  const names = {};
  function ensureTokens(seats) {
    for (const seat of seats) {
      if (tokens[seat.index]) continue;
      profileColor[seat.index] = seat.profile.color;
      names[seat.index] = String(seat.profile.name ?? '').replace(/[[\]]/g, '');   // [ ] are Kaplay style tags
      const tk = tokenLayer.add([k.pos(0, 0), k.scale(1), k.rotate(0)]);
      const av = addAvatar(k, tk, seat.profile, { size: TOKEN_SIZE });
      tokens[seat.index] = { seat: seat.index, tk, av, pos: { x: 0, y: 0 }, off: { x: 0, y: 0 }, offT: { x: 0, y: 0 }, lift: 0, spaceId: null, pop: 1, spin: 0, front: false };
    }
  }
  tokenLayer.onUpdate(() => {
    const dt = Math.min(k.dt(), 0.25);
    const f = 1 - Math.exp(-dt * 10);
    for (const t of tokens) {
      if (!t) continue;
      t.off.x += (t.offT.x - t.off.x) * f;
      t.off.y += (t.offT.y - t.off.y) * f;
      t.tk.pos = k.vec2(t.pos.x + t.off.x, t.pos.y + t.off.y - 30 - t.lift);
      t.tk.scale = k.vec2(t.pop, t.pop);
      t.tk.angle = t.spin;
      t.tk.z = (t.front ? 10000 : 0) + t.pos.y + t.off.y;
    }
  });
  function placeToken(seat, spaceId) {
    const t = tokens[seat];
    if (!t) return;
    t.spaceId = spaceId;
    t.pos = spacePos(spaceId);
  }
  /** spread tokens that share a space on a small ring (targets only; they glide there) */
  function layoutTokens(groups) {
    const bySpace = new Map();
    for (const t of tokens) if (t) { if (!bySpace.has(t.spaceId)) bySpace.set(t.spaceId, []); bySpace.get(t.spaceId).push(t); }
    for (const list of bySpace.values()) {
      list.forEach((t, i) => {
        const fan = FAN[list.length];
        if (fan) { t.offT = { x: fan[i][0], y: fan[i][1] }; return; }
        if (list.length === 1) { t.offT = { x: 0, y: 0 }; return; }
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / list.length + 0.4;   // more than 4 (not in the rules): a ring
        t.offT = { x: Math.cos(a) * 40, y: Math.sin(a) * 24 };
      });
    }
  }

  // ---------- name pills ----------
  // A lone token gets its name right under it; tokens sharing a space list their names in a column under the space, so the names of a
  // stack never overlap each other or hide under the other avatars / the white start disc.
  const nameW = new Map();
  const pill = (name, x, y, color) => {
    let w = nameW.get(name);
    if (w === undefined) nameW.set(name, (w = k.formatText({ text: name, size: NAME_SIZE }).width));
    d.rect(x, y, w + 18, NAME_SIZE + 9, '#1e1a2e', { anchor: 'center', r: (NAME_SIZE + 9) / 2, a: 0.85, line: 2, lineColor: color });
    d.dtext(name, x, y + 1, NAME_SIZE, '#ffffff', { line: 0 });
  };
  nameLayer.onDraw(() => {
    const groups = new Map();
    for (const t of tokens) {
      if (!t) continue;
      if (t.front || t.lift > 0) { pill(names[t.seat], t.pos.x + t.off.x, t.pos.y + t.off.y + 14 - t.lift, profileColor[t.seat]); continue; }
      if (!groups.has(t.spaceId)) groups.set(t.spaceId, []);
      groups.get(t.spaceId).push(t);
    }
    for (const list of groups.values()) {
      if (list.length === 1) { const t = list[0]; pill(names[t.seat], t.pos.x + t.off.x, t.pos.y + t.off.y + 14, profileColor[t.seat]); continue; }
      const p = list[0].pos;
      list.forEach((t, i) => pill(names[t.seat], p.x, p.y + 44 + i * (NAME_SIZE + 12), profileColor[t.seat]));
    }
  });

  const widths = new Map();
  const textW = (s, size) => { const key = `${size}|${s}`; let w = widths.get(key); if (w === undefined) widths.set(key, (w = k.formatText({ text: s, size }).width)); return w; };

  // ---------- turn arrow + step badge + prompt markers ----------
  overlay.onDraw(() => {
    const t = k.time();
    const tk = view.turnSeat != null ? tokens[view.turnSeat] : null;
    if (tk) {
      const x = tk.pos.x + tk.off.x, y = tk.pos.y + tk.off.y - 30 - tk.lift - TOKEN_SIZE * 0.95 - 22 + Math.sin(t * 6) * 5;
      d.poly([[x - 14, y - 16], [x + 14, y - 16], [x, y + 8]], profileColor[view.turnSeat] ?? '#ffffff', { line: 4 });
      if (view.badge != null && view.badge > 0) {
        const bx = x + 34, by = y - 6;
        d.circle(bx, by, 27, '#2a2340'); d.circle(bx, by, 22, '#ffffff');
        d.dtext(String(view.badge), bx, by + 1, 30, '#2a2340', { line: 0 });
      }
    }
    for (const m of view.markers) {
      const bounce = Math.sin(t * 7) * 6;
      const pulse = m.sel ? 1 + Math.sin(t * 8) * 0.08 : 0.85;
      d.circle(m.x, m.y, 62 * pulse, m.color ?? '#ffe14d', { a: m.sel ? 0.35 : 0.15 });
      if (m.arrow) d.poly([[m.x - 20, m.y - 112 + bounce], [m.x + 20, m.y - 112 + bounce], [m.x, m.y - 82 + bounce]], m.color ?? '#ffe14d', { line: 4 });
      if (m.label) {
        const w = textW(m.label, 22) + 34;
        d.rect(m.x, m.y - 138 + bounce, w, 36, m.sel ? '#2a2340' : '#2a2340', { anchor: 'center', r: 18, line: m.sel ? 5 : 3, lineColor: m.color ?? '#ffe14d', a: m.sel ? 1 : 0.7 });
        d.dtext(m.label, m.x, m.y - 138 + bounce, 22, '#ffffff', { line: 0 });
      }
    }
  });

  // path prompt preview: dots along the route and a cyan landing ring + pin + tag on the space where the move would end
  overlay.onDraw(() => {
    const pv = view.preview;
    if (!pv) return;
    const t = k.time();
    const C = '#35d0ff';
    pv.route.forEach((p, i) => {
      const wob = 1 + Math.sin(t * 6 - i * 0.9) * 0.18;
      d.circle(p.x, p.y, 11 * wob, C, { line: 4 });
    });
    const g = pv.target;
    const pulse = 1 + Math.sin(t * 7) * 0.1;
    d.circle(g.x, g.y, 56 * pulse, C, { a: 0.28 });
    for (let i = 0; i < 14; i++) {   // dotted ring that slowly turns
      const a = (i / 14) * Math.PI * 2 + t * 1.5;
      d.circle(g.x + Math.cos(a) * 52 * pulse, g.y + Math.sin(a) * 52 * pulse, 5, C, { line: 2 });
    }
    const bounce = Math.abs(Math.sin(t * 6)) * 14;
    if (!pv.near) d.poly([[g.x - 26, g.y - 120 - bounce], [g.x + 26, g.y - 120 - bounce], [g.x, g.y - 72 - bounce]], C, { line: 5 });
    const label = pv.label;
    const w = textW(label, 24) + 40;
    d.rect(g.x, g.y + 92, w, 44, '#2a2340', { anchor: 'center', r: 22, line: 5, lineColor: C });
    d.dtext(label, g.x, g.y + 93, 24, '#ffffff', { line: 0 });
  });

  // ---------- camera ----------
  const cam = { x: board.world.w / 2, y: board.world.h / 2, zoom: FOLLOW_ZOOM, target: null, shakeAmp: 0, shakeT: 0, sx: 0, sy: 0 };
  const overviewZoom = Math.min(W / board.world.w, H / board.world.h) * 0.96;
  const clampCam = (x, y, z) => {
    const hw = W / 2 / z, hh = H / 2 / z, m = 40, mb = 200;   // extra room below the world so the bottom row can sit above the prompt panel
    const cx = board.world.w + 2 * m <= 2 * hw ? board.world.w / 2 : Math.min(board.world.w - hw + m, Math.max(hw - m, x));
    const cy = board.world.h + m + mb <= 2 * hh ? board.world.h / 2 + (mb - m) / 2 : Math.min(board.world.h - hh + mb, Math.max(hh - m, y));
    return [cx, cy];
  };
  const resolveTarget = () => {
    const tg = cam.target;
    if (!tg) return { x: cam.x, y: cam.y, zoom: cam.zoom };
    if (tg.seat != null) {
      const t = tokens[tg.seat];
      if (!t) return { x: cam.x, y: cam.y, zoom: cam.zoom };
      return { x: t.pos.x + t.off.x, y: t.pos.y - t.lift * 0.3 + 55 / (tg.zoom ?? FOLLOW_ZOOM), zoom: tg.zoom ?? FOLLOW_ZOOM };
    }
    return { x: tg.x, y: tg.y, zoom: tg.zoom ?? FOLLOW_ZOOM };
  };
  function applyCam() {
    const z = cam.zoom;
    const [cx, cy] = clampCam(cam.x, cam.y, z);
    world.scale = k.vec2(z, z);
    world.pos = k.vec2(W / 2 - cx * z + cam.sx, H / 2 - cy * z + cam.sy);
  }
  root.onUpdate(() => {
    const dt = Math.min(k.dt(), 0.25);
    const tg = resolveTarget();
    const f = 1 - Math.exp(-dt * 5);
    cam.x += (tg.x - cam.x) * f;
    cam.y += (tg.y - cam.y) * f;
    cam.zoom += (tg.zoom - cam.zoom) * (1 - Math.exp(-dt * 4));
    if (cam.shakeT > 0) {
      cam.shakeT -= dt;
      const a = cam.shakeAmp * Math.max(0, cam.shakeT) / Math.max(0.0001, cam.shakeDur);
      cam.sx = (Math.random() - 0.5) * 2 * a;
      cam.sy = (Math.random() - 0.5) * 2 * a;
    } else { cam.sx = 0; cam.sy = 0; }
    applyCam();
  });
  const camApi = {
    follow: (seat, zoom) => { cam.target = { seat, zoom }; },
    look: (x, y, zoom) => { cam.target = { x, y, zoom }; },
    overview: () => { cam.target = { x: board.world.w / 2, y: board.world.h / 2, zoom: overviewZoom }; },
    snap: () => { const tg = resolveTarget(); cam.x = tg.x; cam.y = tg.y; cam.zoom = tg.zoom; applyCam(); },
    shake: (amp = 12, dur = 0.35) => { cam.shakeAmp = amp; cam.shakeDur = dur; cam.shakeT = dur; },
    /** zoom so that all given points are visible */
    fit: (pts, pad = 220, maxZoom = 1) => {
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad + 120;
      cam.target = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom: Math.min(maxZoom, W / (x1 - x0), H / (y1 - y0)) };
    },
  };

  // ---------- fx in world space ----------
  const tokenTop = (seat) => {
    const t = tokens[seat];
    return t ? { x: t.pos.x + t.off.x, y: t.pos.y + t.off.y - 30 - t.lift - TOKEN_SIZE } : { x: board.world.w / 2, y: board.world.h / 2 };
  };
  const stack = {};
  function popup(at, text, { color = '#ffffff', size = 40, rise = 90, hold = 0.9 } = {}) {
    const base = typeof at === 'number' ? tokenTop(at) : at;
    const key = typeof at === 'number' ? at : 'x';
    const n = (stack[key] = ((stack[key] ?? 0) + 1) % 4);
    const o = fxLayer.add([k.pos(base.x, base.y - 20 - n * 34), k.anchor('center'), k.scale(0.2), k.opacity(1), k.text(text, { size }), k.color(d.col(color)), k.outline(6, d.col('#1e1a2e'))]);
    anim.tween(hold, (p) => {
      o.pos = k.vec2(base.x, base.y - 20 - n * 34 - rise * p);
      o.scale = k.vec2(Math.min(1, p * 6) * 1.1 + (p < 0.2 ? 0 : 0), Math.min(1, p * 6) * 1.1);
      o.opacity = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
    }, anim.ease.easeOutCubic).then(() => o.destroy());
  }
  /** emoji particles flying from a to b (b optional: just burst outwards) */
  function burst(from, emoji, n = 8, { to = null, spread = 140, size = 30, dur = 0.8 } = {}) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      const o = fxLayer.add([k.pos(from.x, from.y), k.anchor('center'), k.opacity(1), k.rotate(0), k.text(emoji, { size: size * (0.8 + Math.random() * 0.5) })]);
      const dest = to ? { x: to.x + (Math.random() - 0.5) * 30, y: to.y + (Math.random() - 0.5) * 30 } : { x: from.x + Math.cos(a) * spread * (0.5 + Math.random() * 0.6), y: from.y + Math.sin(a) * spread * (0.5 + Math.random() * 0.6) - 40 };
      const delay = to ? i * 0.04 : 0;
      out.push(anim.tween(dur + delay, (p) => {
        const q = Math.max(0, (p * (dur + delay) - delay) / dur);
        o.pos = k.vec2(from.x + (dest.x - from.x) * q, from.y + (dest.y - from.y) * q - Math.sin(q * Math.PI) * (to ? 60 : 0) + (to ? 0 : q * q * 80));
        o.angle = q * 360;
        o.opacity = to ? 1 : 1 - q * q;
      }, anim.ease.easeOutQuad).then(() => o.destroy()));
    }
    return Promise.all(out);
  }

  // ---------- state-driven setters ----------
  function setStar(spaceId) {
    star.spaceId = spaceId;
    star.visible = !!spaceId;
    if (spaceId) { const p = spacePos(spaceId); star.x = p.x; star.y = p.y; }
  }
  function setTraps(map, seatColor) {
    const want = new Set(Object.keys(map || {}));
    for (const id of [...traps.keys()]) if (!want.has(id)) traps.delete(id);
    for (const id of want) if (!traps.has(id)) traps.set(id, { owner: map[id], color: seatColor(map[id]), dy: 0 });
  }

  return {
    board, k, W, H, d, world, fxLayer, decor, cam: camApi, tokens, traps, star, view, spacePos, spaces, ensureTokens, placeToken, layoutTokens,
    popup, burst, tokenTop, setStar, setTraps, TOKEN_SIZE,
    setEndspurt: (on) => { view.endspurt = !!on; },
    setTurn: (seat) => { view.turnSeat = seat; },
    setBadge: (n) => { view.badge = n; },
    setMarkers: (m) => { view.markers = m; },
    setPreview: (p) => { view.preview = p; },
  };
}
