// Sitzplatz-Krieg im ICE: Kaplay client. Draws the latest host snapshots (interpolated); the rules live in sim.js.
import { createRng } from '../../contracts.js';
import { box, disc, label, ease, setText, addHint, bubble as speechBubble } from '../draw.js';
import { ARENA, AISLE, SEAT, SEATS, SEAT_COUNT, TABLES, TABLE, C, DURATION_MS, TEAM_NAMES, TEAM_COLORS, counts, botFrame } from './sim.js';
import LINES from './lines.js';

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const SEAT_FREE = hex('#a9b1c2');
const TEAM_RGB = TEAM_COLORS.map(hex);
const DARK = (rgb) => rgb.map((v) => Math.round(v * 0.68));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function mountSitzplatz(ctx) {
  const { k, root, audio } = ctx;
  const self = ctx.selfSeat;
  const isPlayer = ctx.seats.some((s) => s.index === self);
  const botRng = createRng((ctx.seed ^ Math.imul(self + 1, 0x85EBCA6B)) >>> 0);
  const botMem = {};
  const world = root.add([k.pos(0, 0)]);
  const rgb = (a) => k.rgb(a[0], a[1], a[2]);
  const myTeam = () => {
    const t = ctx.teams?.findIndex((m) => m.includes(self));
    if (t >= 0) return t;
    return snap?.ps.find((p) => p.s === self)?.tm ?? -1;
  };

  // ---- static scene: an ICE carriage seen from above ----
  box(k, world, 0, 0, ARENA.w, ARENA.h, '#232733');
  // scenery rushing past behind the windows (the wall panels below hide what is not window)
  const scenery = world.add([k.pos(0, 0)]);
  box(k, scenery, 0, 0, ARENA.w, 96, '#8fd0f0');
  box(k, scenery, 0, 62, ARENA.w, 34, '#6cc06a');
  const trees = [];
  for (let i = 0; i < 14; i++) {
    const t = scenery.add([k.pos(i * 100, 66)]);
    disc(k, t, 0, 0, 14, '#2f8f46', { outline: [3, '#1f6a33'] });
    box(k, t, -3, 8, 6, 14, '#7a5230');
    trees.push(t);
  }
  const clouds = [[120, 24], [520, 36], [900, 20], [1180, 40]].map(([x, y]) => {
    const c = scenery.add([k.pos(x, y)]);
    disc(k, c, 0, 0, 16, '#ffffff', { opacity: 0.85 }); disc(k, c, 18, 4, 12, '#ffffff', { opacity: 0.85 }); disc(k, c, -16, 5, 11, '#ffffff', { opacity: 0.85 });
    return c;
  });
  // wall: panels between the windows
  const WIN = [[26, 170], [214, 170], [440, 400, true], [906, 170], [1094, 160]];   // x, w   (the middle one hides behind the LED display)
  box(k, world, 0, 0, ARENA.w, 12, '#e9edf3');
  box(k, world, 0, 84, ARENA.w, 12, '#e9edf3');
  let px = 0;
  for (const [wx, ww, solid] of WIN) {
    box(k, world, px, 12, wx - px, 72, '#e9edf3');
    if (solid) box(k, world, wx, 12, ww, 72, '#e9edf3');
    px = wx + ww;
  }
  box(k, world, px, 12, ARENA.w - px, 72, '#e9edf3');
  box(k, world, 0, 94, ARENA.w, 4, '#b7c0d0');
  // floor
  box(k, world, 0, 98, ARENA.w, 560, '#33405f');
  for (let x = 0; x < ARENA.w; x += 64) box(k, world, x, 98, 2, 560, '#3a4869');
  box(k, world, 0, AISLE.y0, ARENA.w, AISLE.y1 - AISLE.y0, '#5a2d3b');
  for (let x = 20; x < ARENA.w; x += 80) box(k, world, x, AISLE.cy - 3, 38, 6, '#7a4456', { radius: 3 });
  box(k, world, 0, AISLE.y0 - 4, ARENA.w, 4, '#1c2030');
  box(k, world, 0, AISLE.y1, ARENA.w, 4, '#1c2030');
  box(k, world, 0, 652, ARENA.w, 68, '#1c2030');
  box(k, world, 0, 652, ARENA.w, 5, '#b7c0d0');

  // seats
  const seatObjs = SEATS.map((s, i) => {
    const o = world.add([k.pos(s.x, s.y)]);
    box(k, o, -SEAT.w / 2 + 2, -SEAT.h / 2 + 5, SEAT.w, SEAT.h, '#000000', { radius: 12, opacity: 0.3 });
    const base = box(k, o, -SEAT.w / 2, -SEAT.h / 2, SEAT.w, SEAT.h, rgb(SEAT_FREE), { radius: 12, outline: [3, '#1c2030'] });
    const backTop = s.row === 0 || s.row === 2;
    const back = box(k, o, -SEAT.w / 2 + 4, backTop ? -SEAT.h / 2 + 3 : SEAT.h / 2 - 14, SEAT.w - 8, 11, rgb(DARK(SEAT_FREE)), { radius: 5 });
    const lock = label(k, o, '🔒', 0, 2, { size: 24 });
    lock.hidden = true;
    return { o, base, back, lock, cur: -2, flash: 0, rgb: SEAT_FREE.slice() };
  });
  // tables
  for (const t of TABLES) {
    box(k, world, t.x - TABLE.w / 2 + 2, t.y - TABLE.h / 2 + 4, TABLE.w, TABLE.h, '#000000', { radius: 5, opacity: 0.3 });
    box(k, world, t.x - TABLE.w / 2, t.y - TABLE.h / 2, TABLE.w, TABLE.h, '#d9d2c3', { radius: 5, outline: [3, '#8a8170'] });
  }
  label(k, world, '☕', TABLES[0].x, TABLES[0].y, { size: 16 });
  label(k, world, '🥨', TABLES[3].x, TABLES[3].y, { size: 16 });
  label(k, world, '🍺', TABLES[6].x, TABLES[6].y + 14, { size: 16 });
  label(k, world, '🍌', TABLES[9].x, TABLES[9].y, { size: 16 });
  label(k, world, 'WAGEN 7', 640, AISLE.cy - 1, { size: 26, color: '#ffffff', opacity: 0.12 });

  const fx0 = world.add([k.pos(0, 0)]);       // seat flashes / puffs (under the players)
  const crowd = world.add([k.pos(0, 0)]);     // players + Schaffner
  const fx = world.add([k.pos(0, 0)]);        // popups, bubbles
  const hud = root.add([k.pos(0, 0)]);

  // the "Reserviert" LED display
  box(k, hud, 400, 8, 480, 78, '#0a0a0e', { radius: 10, outline: [4, '#555b6b'] });
  label(k, hud, 'RESERVIERT', 640, 24, { size: 17, color: '#ffb02e' });
  const scoreL = label(k, hud, '0', 520, 56, { size: 42, color: TEAM_COLORS[0], outline: [4, '#0a0a0e'] });
  const scoreR = label(k, hud, '0', 760, 56, { size: 42, color: TEAM_COLORS[1], outline: [4, '#0a0a0e'] });
  label(k, hud, ':', 640, 54, { size: 36, color: '#ffb02e' });
  label(k, hud, 'ROT', 440, 56, { size: 18, color: TEAM_COLORS[0] });
  label(k, hud, 'BLAU', 842, 56, { size: 18, color: TEAM_COLORS[1] });
  const barW = 150;
  box(k, hud, 565, 74, barW, 6, '#222633', { radius: 3 });
  box(k, hud, 565 + barW, 74, barW, 6, '#222633', { radius: 3 });
  const barL = box(k, hud, 565 + barW, 74, 0, 6, TEAM_COLORS[0], { radius: 3, anchor: 'topright' });
  const barR = box(k, hud, 565 + barW, 74, 0, 6, TEAM_COLORS[1], { radius: 3 });
  const banner = label(k, hud, '', 640, 330, { size: 70, color: '#ffffff', outline: [8, '#c0392b'], opacity: 0 });
  const bannerSub = label(k, hud, '', 640, 400, { size: 28, color: '#ffffff', outline: [5, '#1b2a49'], opacity: 0 });
  const timerTxt = label(k, hud, '', 1240, 686, { size: 26, color: '#ffffff', outline: [4, '#1b2a49'], anchor: 'right' });
  const teamTxt = label(k, hud, '', 640, 686, { size: 24, color: '#ffffff', outline: [4, '#1b2a49'] });
  if (isPlayer) addHint(k, hud, '{key:WASD} / {LS} Laufen  {key:E} / {key:Shift} / {X} Jacke werfen', 20, 686, { size: 19, anchor: 'left', outline: [4, '#1b2a49'] });

  // ---- players + Schaffner ----
  const crew = new Map();   // seat -> {x, y, av, ring, mark, bar, stun, seen}
  ctx.seats.forEach((seat) => {
    const e = { seat: seat.index, x: 640, y: AISLE.cy, seen: false };
    e.ring = disc(k, crowd, 0, 0, 29, '#ffffff', { opacity: 0.55, outline: [4, '#ffffff'] });
    e.av = ctx.addAvatar(seat.profile, { size: 44, showName: true, parent: crowd });
    e.av.hidden = true; e.ring.hidden = true;
    e.mark = label(k, crowd, seat.index === self ? '▼' : '', 0, 0, { size: 26, color: '#ffe066', outline: [4, '#1b2a49'] });
    e.bar = box(k, crowd, 0, 0, 40, 6, '#8ce99a', { outline: [2, '#1b2a49'] });
    e.stun = label(k, crowd, '💫', 0, 0, { size: 24 });
    e.mark.hidden = true; e.bar.hidden = true; e.stun.hidden = true;
    crew.set(seat.index, e);
  });
  const sch = crowd.add([k.pos(640, AISLE.cy)]);
  disc(k, sch, 2, 6, 30, '#000000', { opacity: 0.25 });
  disc(k, sch, 0, 0, 29, '#1d2f6f', { outline: [4, '#0e1740'] });
  box(k, sch, -9, 4, 18, 22, '#c0141f', { radius: 4 });   // red tie / sash
  disc(k, sch, 0, -10, 14, '#f2c9a0', { outline: [3, '#8a6a4a'] });
  box(k, sch, -17, -34, 34, 13, '#c0141f', { radius: 5, outline: [3, '#7a0c13'] });   // cap
  box(k, sch, -20, -23, 40, 5, '#0e1740', { radius: 2 });
  disc(k, sch, -5, -10, 2.4, '#222222'); disc(k, sch, 5, -10, 2.4, '#222222');
  label(k, sch, 'Schaffner', 0, 42, { size: 15, color: '#ffffff', outline: [3, '#0e1740'] });
  const schPos = { x: 640, y: AISLE.cy, seen: false };

  // ---- snapshot state ----
  let snap = null, snapAt = 0, live = false, lastEv = null, doneShown = false, bannerAge = 9, shake = 0, lastSay = -99, lastClaimSfx = 0;
  let prevO = null;
  const say = (key, gap = 6) => { if (k.time() - lastSay < gap) return; lastSay = k.time(); audio.say(pick(LINES[key])); };
  const showBanner = (text, sub = '') => { banner.text = text; bannerSub.text = sub; bannerAge = 0; };

  const popup = (text, x, y, color, size = 30) => {
    const o = label(k, fx, text, x, y, { size, color, outline: [5, '#1b2a49'] });
    const half = (o.width || 0) / 2 + 8;
    o.pos = k.vec2(Math.max(half, Math.min(ARENA.w - half, x)), y);
    o.onUpdate(() => { o.pos = k.vec2(o.pos.x, o.pos.y - 70 * k.dt()); o.opacity -= k.dt() * 0.8; if (o.opacity <= 0) o.destroy(); });
  };
  const puff = (x, y, color, r = 14) => {
    const o = disc(k, fx0, x, y, r, color, { opacity: 0.6 });
    o.onUpdate(() => { o.opacity -= k.dt() * 2.4; o.radius += k.dt() * 40; if (o.opacity <= 0) o.destroy(); });
  };
  const sayBubble = (text, x, y) => {
    const b = speechBubble(k, fx, text, { size: 17, bounds: { x0: 6, y0: 100, x1: ARENA.w - 6, y1: ARENA.h - 6 } });
    let age = 0;
    b.place(x, y);
    b.obj.onUpdate(() => { age += k.dt(); b.place(x, y - Math.min(age * 30, 10)); if (age > 1.6) b.obj.destroy(); });
  };

  function handleEvents(s) {
    const maxId = s.ev.reduce((m, e) => Math.max(m, e.i), 0);
    if (lastEv === null) { lastEv = maxId; return; }
    for (const e of s.ev) {
      if (e.i <= lastEv) continue;
      lastEv = Math.max(lastEv, e.i);
      if (!live) continue;
      if (e.k === 'j') {
        audio.sfx('item', { rate: 0.9 + Math.random() * 0.3 });
        popup('Reserviert!', e.x, e.y - 40, '#ffe066', 30);
        const coat = label(k, fx0, '🧥', e.x, e.y, { size: 30 });
        coat.onUpdate(() => { coat.opacity -= k.dt() * 0.5; if (coat.opacity <= 0) coat.destroy(); });
        crew.get(e.s)?.av.bounce();
        if (e.s === self) say('jacket', 4);
      } else if (e.k === 'b') {
        audio.sfx('bump', { rate: 0.8 + Math.random() * 0.3 });
        popup('Autsch!', e.x, e.y - 40, '#ff8080', 30);
        crew.get(e.s)?.av.bounce();
        if (e.s === self) shake = 0.4;
      } else if (e.k === 'z') {
        audio.sfx('bahnDing', { volume: 0.6 });
        sayBubble('Fahrscheine bitte!', e.x, e.y - 50);
        say('conductor', 9);
      }
    }
  }

  function applySeats(s, dt) {
    const claimed = [];
    for (let i = 0; i < SEAT_COUNT; i++) {
      const so = seatObjs[i], o = s.o[i];
      if (so.cur !== o) {
        if (so.cur !== -2 && live && o >= 0) { so.flash = 1; claimed.push(i); }
        so.cur = o;
      }
      so.flash = Math.max(0, so.flash - dt * 3.5);
      const base = o >= 0 ? TEAM_RGB[o] : SEAT_FREE;
      const c = so.flash > 0 ? mix(base, [255, 255, 255], so.flash * 0.75) : base;
      if (c[0] !== so.rgb[0] || c[1] !== so.rgb[1] || c[2] !== so.rgb[2]) {
        so.rgb = c;
        so.base.color = rgb(c);
        so.back.color = rgb(DARK(c));
      }
      so.lock.hidden = !(s.lk[i] > 0);
      if (s.lk[i] > 0) so.lock.opacity = s.lk[i] < 800 ? 0.5 + 0.5 * Math.sin(k.time() * 24) : 1;
    }
    if (claimed.length) {
      for (const i of claimed.slice(0, 6)) puff(SEATS[i].x, SEATS[i].y, rgb(TEAM_RGB[s.o[i]]), 18);
      if (k.time() - lastClaimSfx > 0.09) { lastClaimSfx = k.time(); audio.sfx('splat', { volume: 0.35, rate: 1.2 + Math.random() * 0.4 }); }
      // one of "my" seats just got stolen => complain
      const mine = myTeam();
      if (mine >= 0 && prevO && claimed.some((i) => prevO[i] === mine && s.o[i] !== mine)) say('claim', 7);
    }
    prevO = s.o.slice();
  }

  function render(dt) {
    if (!snap) return;
    const age = Math.min(0.06, k.time() - snapAt);
    const pull = ease(dt, 18);
    const time = k.time();
    applySeats(snap, dt);
    for (const p of snap.ps) {
      const e = crew.get(p.s);
      if (!e) continue;
      const tx = p.x + (p.vx + p.kx) * age, ty = p.y + (p.vy + p.ky) * age;
      if (!e.seen || Math.hypot(tx - e.x, ty - e.y) > 160) { e.x = tx; e.y = ty; e.seen = true; } else { e.x += (tx - e.x) * pull; e.y += (ty - e.y) * pull; }
      e.av.hidden = false; e.ring.hidden = false;
      e.av.pos = k.vec2(e.x, e.y);
      e.av.setFacing(p.fx);
      e.ring.pos = k.vec2(e.x, e.y + 4);
      e.ring.outline.color = rgb(TEAM_RGB[p.tm]);
      e.ring.color = rgb(TEAM_RGB[p.tm]);
      e.mark.hidden = !e.mark.text;
      e.mark.pos = k.vec2(e.x, e.y - 52 + Math.sin(time * 6) * 4);
      e.bar.hidden = p.s !== self;
      e.bar.pos = k.vec2(e.x - 20, e.y + 50);
      e.bar.width = Math.max(0.1, 40 * (1 - p.cd / C.JACKET_CD_MS));
      e.stun.hidden = p.stun <= 0;
      e.stun.pos = k.vec2(e.x, e.y - 40);
    }
    // Schaffner
    const sx = snap.sc.x + snap.sc.d * (snap.sc.pz > 0 ? 0 : C.SCH_SPEED) * age, sy = snap.sc.y;
    if (!schPos.seen) { schPos.x = sx; schPos.y = sy; schPos.seen = true; } else { schPos.x += (sx - schPos.x) * pull; schPos.y += (sy - schPos.y) * pull; }
    sch.pos = k.vec2(schPos.x, schPos.y + Math.sin(time * 9) * (snap.sc.pz > 0 ? 0 : 2));

    // HUD
    const [a, b] = counts(snap);
    setText(scoreL, String(a)); setText(scoreR, String(b));
    barL.width = Math.max(0.1, barW * (a / SEAT_COUNT)); barR.width = Math.max(0.1, barW * (b / SEAT_COUNT));
    const mine = myTeam();
    if (mine >= 0) { setText(teamTxt, `Du bist ${TEAM_NAMES[mine]}`); teamTxt.color = rgb(mix(TEAM_RGB[mine], [255, 255, 255], 0.35)); }
    const left = Math.max(0, Math.ceil((DURATION_MS - snap.t) / 1000));
    setText(timerTxt, snap.done ? 'Endstation!' : `Noch ${left} s`);
    if (snap.done && !doneShown && live) {
      doneShown = true;
      const win = a === b ? -1 : a > b ? 0 : 1;
      showBanner('ENDSTATION!', win < 0 ? 'Unentschieden: alle stehen.' : `${TEAM_NAMES[win]} hat die meisten Sitzplätze!`);
      if (mine >= 0 && win >= 0) say(win === mine ? 'win' : 'lose', 0);
    }
  }

  root.onUpdate(() => {
    const dt = k.dt();
    render(dt);
    const t = k.time();
    trees.forEach((tr, i) => { tr.pos = k.vec2((((i * 100 - t * 260) % 1400) + 1400) % 1400 - 60, 66); });
    clouds.forEach((c, i) => { c.pos = k.vec2((((i * 330 + 120 - t * 30) % 1380) + 1380) % 1380 - 50, c.pos.y); });
    bannerAge += dt;
    const a = bannerAge < 0.2 ? bannerAge / 0.2 : bannerAge > 1.9 ? Math.max(0, 1 - (bannerAge - 1.9) / 0.4) : 1;
    banner.opacity = a; bannerSub.opacity = a;
    banner.scale = k.vec2(1 + (1 - Math.min(1, bannerAge / 0.2)) * 0.8);
    shake = Math.max(0, shake - dt);
    world.pos = shake > 0 ? k.vec2((Math.random() - 0.5) * 18 * shake, (Math.random() - 0.5) * 18 * shake) : k.vec2(0, 0);
  });

  return {
    go() {
      live = true;
      audio.sfx('bahnDing');
      const mine = myTeam();
      showBanner('SITZPLATZ-KRIEG!', mine >= 0 ? `Du bist ${TEAM_NAMES[mine]}: färbe die Sitze!` : 'Färbt die Sitze!');
      say('start', 0);
    },
    update(s) {
      if (!s || !Array.isArray(s.ps)) return;
      snap = s; snapAt = k.time();
      handleEvents(s);
    },
    botInput() {
      if (!snap || !isPlayer) return {};
      const f = botFrame(snap, self, botRng, botMem);
      return { move: f.move, action: f.action };
    },
    destroy() {},   // everything hangs off root (the runner destroys it)
  };
}
