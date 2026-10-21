// Aura-Farming: Kaplay client. Draws the latest host snapshots (interpolated); the rules live in sim.js.
import { createRng } from '../../contracts.js';
import { box, disc, label, ease, setText, addHint } from '../draw.js';
import { ARENA, C, DURATION_MS, botFrame, fmtAura } from './sim.js';
import LINES from './lines.js';

const ORB_COLOR = { 100: '#6ee7ff', 200: '#c084fc' }, GOLD = '#ffd23f';
const orbColor = (o) => (o.g ? GOLD : ORB_COLOR[o.v] ?? '#8ff0c0');
const HUD_W = 1060;   // the chips stay left of this x: the DOM volume control sits in the top right corner

export function mountAura(ctx) {
  const { k, root, audio } = ctx;
  const self = ctx.selfSeat;
  const isPlayer = ctx.seats.some((s) => s.index === self);
  const botRng = createRng((ctx.seed ^ Math.imul(self + 1, 0x85EBCA6B)) >>> 0);
  const world = root.add([k.pos(0, 0)]);

  // ---- static scene: a schoolyard behind the Spaeti (court lines, trees, benches, bike racks) ----
  box(k, world, 0, 0, ARENA.w, ARENA.h, '#3b7d45');
  for (let y = 0; y < ARENA.h; y += 80) box(k, world, 0, y, ARENA.w, 40, '#418a4c');
  box(k, world, ARENA.x0 - 24, ARENA.y0 - 24, ARENA.x1 - ARENA.x0 + 48, ARENA.y1 - ARENA.y0 + 48, '#6e7388', { radius: 18, outline: [6, '#474b5c'] });
  for (let x = ARENA.x0; x < ARENA.x1; x += 80) box(k, world, x, ARENA.y0 - 24, 3, ARENA.y1 - ARENA.y0 + 48, '#62677b');
  for (let y = ARENA.y0; y < ARENA.y1; y += 80) box(k, world, ARENA.x0 - 24, y, ARENA.x1 - ARENA.x0 + 48, 3, '#62677b');
  const line = '#c9cde0';
  for (const [x, y, w, h] of [[200, 170, 880, 4], [200, 606, 880, 4], [200, 170, 4, 440], [1076, 170, 4, 440], [638, 170, 4, 440]]) box(k, world, x, y, w, h, line, { opacity: 0.55 });
  disc(k, world, 640, 390, 84, line, { opacity: 0.55 });
  disc(k, world, 640, 390, 80, '#6e7388');
  label(k, world, 'AURA', 640, 390, { size: 84, color: '#ffffff', opacity: 0.08 });
  for (const [x, y] of [[100, 120], [1180, 120], [100, 660], [1180, 660]]) { disc(k, world, x, y, 36, '#2f7a38', { outline: [4, '#1e5326'] }); disc(k, world, x, y, 12, '#7a5230'); }
  for (const [x, y] of [[420, 118], [860, 118], [420, 664], [860, 664]]) box(k, world, x - 45, y - 12, 90, 24, '#7a5230', { radius: 5, outline: [3, '#4d3219'] });
  const orbs = world.add([k.pos(0, 0)]);     // orbs on the floor
  const crowd = world.add([k.pos(0, 0)]);    // players
  const fx = world.add([k.pos(0, 0)]);       // popups, puffs
  const hud = root.add([k.pos(0, 0)]);
  const banner = label(k, hud, '', 640, 330, { size: 74, color: '#ffffff', outline: [8, '#6d28d9'], opacity: 0 });
  const bannerSub = label(k, hud, '', 640, 395, { size: 30, color: '#ffffff', outline: [5, '#1b2a49'], opacity: 0 });
  const timerTxt = label(k, hud, '', 640, 706, { size: 26, color: '#ffffff', outline: [4, '#1b2a49'] });
  if (isPlayer) addHint(k, hud, '{key:E} / {key:Leertaste} / {A} / {X} Rempeln', 20, 704, { size: 20, anchor: 'left', outline: [4, '#1b2a49'] });

  // ---- players ----
  const crew = new Map();   // seat -> {seat, av, x, y, halo, mark, bar, stun, num, shown, chipNum, crown}
  const n = ctx.seats.length, chipW = Math.min(176, (HUD_W - 20) / n), chip0 = 10 + (HUD_W - 20 - n * chipW) / 2;
  ctx.seats.forEach((seat, i) => {
    const e = { seat: seat.index, x: 640, y: 390, seen: false, puffAt: 0, shown: 0 };
    e.halo = disc(k, crowd, 0, 0, 34, seat.profile.color, { opacity: 0.22 });
    e.av = ctx.addAvatar(seat.profile, { size: 44, showName: true, parent: crowd });
    e.av.hidden = true;
    e.mark = label(k, crowd, seat.index === self ? '▼' : '', 0, 0, { size: 26, color: '#ffe066', outline: [4, '#1b2a49'] });
    e.bar = box(k, crowd, 0, 0, 40, 6, '#c4a1ff', { outline: [2, '#1b2a49'] });
    e.stun = label(k, crowd, '💫', 0, 0, { size: 24 });
    e.num = label(k, crowd, '', 0, 0, { size: 18, color: '#e9d5ff', outline: [4, '#1b2a49'] });
    e.stun.hidden = true; e.mark.hidden = true; e.bar.hidden = true;
    const cx = chip0 + i * chipW;
    box(k, hud, cx + 3, 6, chipW - 6, 62, '#000000', { radius: 8, opacity: 0.5, outline: [3, seat.profile.color] });
    const nm = seat.profile.name;
    label(k, hud, nm.length > 13 ? `${nm.slice(0, 12)}…` : nm, cx + chipW / 2, 23, { size: 16, outline: [3, '#1b2a49'] });
    e.chipNum = label(k, hud, '0', cx + chipW / 2 + 8, 48, { size: 24, color: '#e9d5ff', outline: [4, '#3b1d6e'] });
    label(k, hud, '✨', cx + 18, 48, { size: 18 });
    e.crown = label(k, hud, '👑', cx + chipW - 14, 14, { size: 18 });
    e.crown.hidden = true;
    crew.set(seat.index, e);
  });

  // ---- snapshot state ----
  let snap = null, snapAt = 0, live = false, lastEv = null, doneShown = false, shake = 0, bannerAge = 9, lastSay = -99, combo = 0, comboAt = -9;
  const floor = new Map();   // orb id -> {obj, glow, core, x, y, age, g, v}

  const say = (key) => {
    if (!isPlayer || k.time() - lastSay < 3.5) return;
    lastSay = k.time();
    const arr = LINES[key];
    audio.say(arr[Math.floor(Math.random() * arr.length)]);
  };
  const popup = (text, x, y, color, size = 30) => {
    const o = label(k, fx, text, x, y, { size, color, outline: [5, '#1b2a49'] });
    const half = (o.width || 0) / 2 + 8;   // keep wide popups fully on screen near the arena edges
    o.pos = k.vec2(Math.max(half, Math.min(ARENA.w - half, x)), Math.max(60, y));
    o.onUpdate(() => { o.pos = k.vec2(o.pos.x, o.pos.y - 70 * k.dt()); o.opacity -= k.dt() * 0.85; if (o.opacity <= 0) o.destroy(); });
    return o;
  };
  const puff = (x, y, color, r = 12) => {
    const o = disc(k, fx, x, y, r, color, { opacity: 0.6 });
    o.onUpdate(() => { o.opacity -= k.dt() * 3; o.radius = Math.max(1, o.radius - k.dt() * 18); if (o.opacity <= 0) o.destroy(); });
  };
  const burst = (x, y, color, count) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random(), sp = 90 + Math.random() * 90;
      const o = disc(k, fx, x, y, 5, color, { opacity: 0.9 });
      let life = 0.5;
      o.onUpdate(() => { life -= k.dt(); o.pos = k.vec2(o.pos.x + Math.cos(a) * sp * k.dt(), o.pos.y + Math.sin(a) * sp * k.dt()); o.opacity = Math.max(0, life * 1.8); if (life <= 0) o.destroy(); });
    }
  };
  const showBanner = (text, sub = '') => { banner.text = text; bannerSub.text = sub; bannerAge = 0; };

  function makeOrb(o) {
    const obj = orbs.add([k.pos(o.x, o.y), k.scale(0.01, 0.01)]);
    const col = orbColor(o), r = o.g ? 19 : o.v >= 200 ? 15 : 12;
    const glow = disc(k, obj, 0, 0, r + 14, col, { opacity: 0.25 });
    disc(k, obj, 0, 0, r + 4, '#ffffff', { opacity: 0.35 });
    const core = disc(k, obj, 0, 0, r, col, { outline: [3, o.g ? '#a06a00' : '#3b1d6e'] });
    disc(k, obj, -r * 0.3, -r * 0.35, r * 0.28, '#ffffff', { opacity: 0.8 });
    if (o.g) label(k, obj, 'Σ', 0, 1, { size: 24, color: '#6b4500' });
    return { obj, glow, core, x: o.x, y: o.y, age: 0, g: o.g, v: o.v };
  }

  function handleEvents(s) {
    const maxId = s.ev.reduce((m, e) => Math.max(m, e.i), 0);
    if (lastEv === null) { lastEv = maxId; return; }   // first snapshot (also after a remount): nothing to replay
    for (const e of s.ev) {
      if (e.i <= lastEv) continue;
      lastEv = Math.max(lastEv, e.i);
      if (!live) continue;
      if (e.k === 'p') {
        const mine = e.s === self, col = e.g ? GOLD : '#7be9ff';
        popup(mine || e.g ? `+${e.v} Aura` : `+${e.v}`, e.x, e.y - 20, col, mine ? (e.g ? 40 : 30) : e.g ? 30 : 18);
        burst(e.x, e.y, e.g ? GOLD : col, e.g ? 10 : 4);
        if (mine) {
          combo = k.time() - comboAt < 1.2 ? Math.min(combo + 1, 8) : 0; comboAt = k.time();
          audio.sfx(e.g ? 'star' : 'coinGain', { rate: 0.9 + combo * 0.07, volume: 0.8 });
          if (e.g) say('gold');
        } else if (e.g) audio.sfx('star', { volume: 0.4 });
      } else if (e.k === 'b') {
        crew.get(e.s)?.av.bounce(); crew.get(e.o)?.av.bounce();
        audio.sfx('bump', { rate: 0.9 + Math.random() * 0.3, volume: e.s === self || e.o === self ? 1 : 0.6 });
        burst(e.x, e.y, '#ffffff', 6);
        if (e.l > 0) {
          popup(`-${e.l} Aura`, e.x, e.y - 34, '#ff7a7a', e.o === self ? 38 : 30);
          if (e.o === self) { shake = 0.35; audio.sfx('coinLoss', { volume: 0.7 }); say('hit'); } else if (e.s === self) say('bump');
        } else popup('Abgeprallt!', e.x, e.y - 34, '#ffe066', 22);
      }
    }
  }

  function render(dt) {
    if (!snap) return;
    const age = Math.min(0.06, k.time() - snapAt);
    const pull = ease(dt, 18);
    const time = k.time();
    let top = 0, leader = -1;
    for (const p of snap.ps) if (p.aura > top) { top = p.aura; leader = p.s; }
    for (const p of snap.ps) {
      const e = crew.get(p.s);
      if (!e) continue;
      const tx = p.x + (p.vx + p.kx) * age, ty = p.y + (p.vy + p.ky) * age;
      if (!e.seen || Math.hypot(tx - e.x, ty - e.y) > 160) { e.x = tx; e.y = ty; e.seen = true; } else { e.x += (tx - e.x) * pull; e.y += (ty - e.y) * pull; }
      e.shown += (p.aura - e.shown) * ease(dt, 10);
      if (Math.abs(p.aura - e.shown) < 1) e.shown = p.aura;
      e.av.pos = k.vec2(e.x, e.y);
      e.av.hidden = false;
      e.av.setFacing(p.fx);
      const r = 30 + Math.min(34, p.aura / 50) + Math.sin(time * 5 + p.s) * 2.5;
      e.halo.pos = k.vec2(e.x, e.y); e.halo.radius = r; e.halo.opacity = 0.16 + Math.min(0.24, p.aura / 4000);
      if (p.dash > 0 && time - e.puffAt > 0.035) { e.puffAt = time; puff(e.x, e.y + 8, '#ffffff'); }
      e.mark.hidden = !e.mark.text;
      e.mark.pos = k.vec2(e.x, e.y - 66 + Math.sin(time * 6) * 4);
      e.bar.hidden = p.s !== self;
      e.bar.pos = k.vec2(e.x - 20, e.y + 50);
      e.bar.width = 40 * (1 - p.cd / C.COOLDOWN_MS);
      e.stun.hidden = p.stun <= 0;
      e.stun.pos = k.vec2(e.x, e.y - 40);
      e.num.pos = k.vec2(e.x, e.y - 40 - (p.stun > 0 ? 26 : 0));
      setText(e.num, p.aura > 0 ? fmtAura(Math.round(e.shown)) : '');
      setText(e.chipNum, fmtAura(Math.round(e.shown)));
      e.crown.hidden = !(p.s === leader && top > 0);
    }
    // orbs: create / move / remove
    const seen = new Set();
    for (const o of snap.orbs) {
      seen.add(o.id);
      let e = floor.get(o.id);
      if (!e) { e = makeOrb(o); floor.set(o.id, e); }
      e.age += dt;
      const tx = o.x + o.vx * age, ty = o.y + o.vy * age;
      e.x += (tx - e.x) * pull; e.y += (ty - e.y) * pull;
      const pop = Math.min(1, e.age / 0.18), bob = 1 + Math.sin(time * 6 + o.id) * 0.06;
      e.obj.pos = k.vec2(e.x, e.y + Math.sin(time * 3 + o.id) * 2);
      e.obj.scale = k.vec2(pop * bob * (o.g ? 1.1 : 1));
      e.glow.opacity = 0.18 + 0.12 * Math.sin(time * 7 + o.id);
      const mineLocked = o.ex === self && o.exm > 0;
      const dying = o.g && o.ttl < 2500 && Math.floor(time * 10) % 2 === 0;
      e.core.opacity = dying ? 0.35 : mineLocked ? 0.45 : 1;
    }
    for (const [id, e] of floor) if (!seen.has(id)) { e.obj.destroy(); floor.delete(id); }
    const left = Math.max(0, Math.ceil((DURATION_MS - snap.t) / 1000));
    setText(timerTxt, snap.done ? 'Feierabend!' : `Noch ${left} s`);
    if (snap.done && !doneShown && live) {
      doneShown = true;
      const best = snap.ps.slice().sort((a, b) => b.aura - a.aura)[0];
      const who = best ? ctx.seats.find((s) => s.index === best.s)?.profile.name : '';
      showBanner('AURA-CHECK!', best && best.aura > 0 ? `${who} hat die meiste Aura: ${fmtAura(best.aura)}` : '');
      const mine = snap.ps.find((p) => p.s === self);
      if (mine && best) { lastSay = -99; say(mine.aura >= best.aura && best.aura > 0 ? 'win' : 'lose'); }
    }
  }

  root.onUpdate(() => {
    const dt = k.dt();
    render(dt);
    bannerAge += dt;
    const a = bannerAge < 0.2 ? bannerAge / 0.2 : bannerAge > 1.8 ? Math.max(0, 1 - (bannerAge - 1.8) / 0.4) : 1;
    banner.opacity = a; bannerSub.opacity = a;
    banner.scale = k.vec2(1 + (1 - Math.min(1, bannerAge / 0.2)) * 0.8);
    shake = Math.max(0, shake - dt);
    world.pos = shake > 0 ? k.vec2((Math.random() - 0.5) * 20 * shake, (Math.random() - 0.5) * 20 * shake) : k.vec2(0, 0);
  });

  return {
    go() {
      live = true;
      audio.sfx('go');
      showBanner('AURA FARMEN!', 'Orbs sammeln, Rivalen rempeln');
      say('start');
    },
    update(s) {
      if (!s || !Array.isArray(s.ps)) return;
      snap = s; snapAt = k.time();
      handleEvents(s);
    },
    botInput() {
      if (!snap || !isPlayer) return {};
      const f = botFrame(snap, self, botRng);
      return { move: f.move, action: f.action };
    },
    destroy() {},   // everything hangs off root (the runner destroys it)
  };
}
