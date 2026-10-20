// Ordnungsamt-Flucht: Kaplay client. Draws the latest host snapshots (interpolated); the rules live in sim.js.
import { createRng } from '../../contracts.js';
import { box, disc, label, ease, setText } from '../draw.js';
import { ARENA, C, DURATION_MS, botFrame } from './sim.js';

const BUBBLE = 'Ordnungsamt! Ausweis bitte!';
const HEART = '❤️', BLACK_HEART = '🖤';

export function mountOrdnungsamt(ctx) {
  const { k, root, audio } = ctx;
  const self = ctx.selfSeat;
  const isPlayer = ctx.seats.some((s) => s.index === self);
  const botRng = createRng((ctx.seed ^ Math.imul(self + 1, 0x85EBCA6B)) >>> 0);
  const world = root.add([k.pos(0, 0)]);

  // ---- static scene: a Kiez square (cobblestones, fountain, benches, trees, Späti) ----
  box(k, world, 0, 0, ARENA.w, ARENA.h, '#3d4150');
  box(k, world, ARENA.x0 - 24, ARENA.y0 - 24, ARENA.x1 - ARENA.x0 + 48, ARENA.y1 - ARENA.y0 + 48, '#9a9484', { radius: 18, outline: [6, '#6d685b'] });
  for (let x = ARENA.x0; x < ARENA.x1; x += 60) box(k, world, x, ARENA.y0 - 24, 3, ARENA.y1 - ARENA.y0 + 48, '#8a8475');
  for (let y = ARENA.y0; y < ARENA.y1; y += 60) box(k, world, ARENA.x0 - 24, y, ARENA.x1 - ARENA.x0 + 48, 3, '#8a8475');
  disc(k, world, 640, 390, 64, '#d8d2c0', { outline: [5, '#6d685b'] });
  disc(k, world, 640, 390, 48, '#5aa9c9');
  label(k, world, '⛲', 640, 390, { size: 44 });
  for (const [x, y] of [[220, 150], [1060, 150], [220, 640], [1060, 640]]) box(k, world, x, y, 90, 24, '#7a5230', { radius: 5, outline: [3, '#4d3219'] });
  for (const [x, y] of [[90, 140], [1190, 140], [90, 650], [1190, 650]]) { disc(k, world, x, y, 34, '#3f8f3f', { outline: [4, '#27632b'] }); disc(k, world, x, y, 12, '#7a5230'); }
  box(k, world, 560, 100, 160, 44, '#e8b730', { radius: 6, outline: [4, '#8a6a00'] });
  label(k, world, 'Späti', 640, 122, { size: 26, color: '#2a2200' });
  const bands = world.add([k.pos(0, 0)]);     // van warning lanes
  const crowd = world.add([k.pos(0, 0)]);     // players
  const traffic = world.add([k.pos(0, 0)]);   // vans (above the players, they run you over)
  const fx = world.add([k.pos(0, 0)]);        // popups, puffs, bubbles
  const hud = root.add([k.pos(0, 0)]);
  const banner = label(k, hud, '', 640, 330, { size: 74, color: '#ffffff', outline: [8, '#c0392b'], opacity: 0 });
  const bannerSub = label(k, hud, '', 640, 395, { size: 30, color: '#ffffff', outline: [5, '#1b2a49'], opacity: 0 });
  const timerTxt = label(k, hud, '', 640, 706, { size: 26, color: '#ffffff', outline: [4, '#1b2a49'] });
  if (isPlayer) label(k, hud, 'E / Shift / X: Rempeln', 20, 706, { size: 20, anchor: 'left', color: '#ffffff', outline: [4, '#1b2a49'] });

  // ---- players ----
  const crew = new Map();   // seat -> {seat, av, x, y, mark, bar, chip, hearts, ghost, puffAt}
  const n = ctx.seats.length, chipW = Math.min(206, 1240 / n), chip0 = (ARENA.w - n * chipW) / 2;
  ctx.seats.forEach((seat, i) => {
    const e = { seat: seat.index, x: 640, y: 390, seen: false, puffAt: 0 };
    e.av = ctx.addAvatar(seat.profile, { size: 44, showName: true, parent: crowd });
    e.av.hidden = true;
    e.mark = label(k, crowd, seat.index === self ? '▼' : '', 0, 0, { size: 26, color: '#ffe066', outline: [4, '#1b2a49'] });
    e.bar = box(k, crowd, 0, 0, 40, 6, '#8ce99a', { outline: [2, '#1b2a49'] });
    e.stun = label(k, crowd, '💫', 0, 0, { size: 24 });
    e.ghost = label(k, crowd, '', 0, 0, { size: 20, color: '#dddddd', outline: [3, '#1b2a49'] });
    e.stun.hidden = true; e.ghost.hidden = true; e.mark.hidden = true; e.bar.hidden = true;
    const cx = chip0 + i * chipW;
    box(k, hud, cx + 4, 6, chipW - 8, 62, '#000000', { radius: 8, opacity: 0.45, outline: [3, seat.profile.color] });
    label(k, hud, seat.profile.name, cx + chipW / 2, 24, { size: 20, outline: [3, '#1b2a49'], width: chipW - 20 });
    e.hearts = label(k, hud, '', cx + chipW / 2, 50, { size: 20 });
    crew.set(seat.index, e);
  });

  // ---- snapshot state ----
  let snap = null, snapAt = 0, live = false, lastEv = null, lastSiren = -9, doneShown = false, shake = 0, bannerAge = 9;
  const vans = new Map();   // id -> {obj, band, x, y}
  let netT = 0;

  const popup = (text, x, y, color, size = 30) => {
    const o = label(k, fx, text, x, y, { size, color, outline: [5, '#1b2a49'] });
    o.onUpdate(() => { o.pos = k.vec2(o.pos.x, o.pos.y - 70 * k.dt()); o.opacity -= k.dt() * 0.8; if (o.opacity <= 0) o.destroy(); });
    return o;
  };
  const puff = (x, y, color) => {
    const o = disc(k, fx, x, y, 12, color, { opacity: 0.6 });
    o.onUpdate(() => { o.opacity -= k.dt() * 3; o.radius = Math.max(1, o.radius - k.dt() * 18); if (o.opacity <= 0) o.destroy(); });
  };
  const bubble = (seat) => {
    const e = crew.get(seat);
    const o = fx.add([k.pos(e.x, e.y - 64), k.anchor('center')]);
    box(k, o, 0, 0, 262, 34, '#ffffff', { anchor: 'center', radius: 10, outline: [3, '#1b2a49'] });
    label(k, o, BUBBLE, 0, 0, { size: 17, color: '#1b2a49' });
    let age = 0;
    o.onUpdate(() => { age += k.dt(); o.pos = k.vec2(e.x, e.y - 64 - Math.min(age * 30, 10)); if (age > 1.5) o.destroy(); });
  };
  const showBanner = (text, sub = '') => { banner.text = text; bannerSub.text = sub; bannerAge = 0; };

  function makeVan(v) {
    const horizontal = v.vx !== 0;
    const dir = horizontal ? Math.sign(v.vx) : Math.sign(v.vy);
    const o = traffic.add([k.pos(v.x, v.y), k.rotate(horizontal ? (dir > 0 ? 0 : 180) : (dir > 0 ? 90 : 270))]);
    const L = C.VAN_W, T = C.VAN_T;
    box(k, o, 0, 4, L, T, '#000000', { anchor: 'center', radius: 12, opacity: 0.25 });
    box(k, o, 0, 0, L, T, '#f4f6f8', { anchor: 'center', radius: 12, outline: [4, '#1b2a49'] });
    box(k, o, -8, -T / 2 + 6, L - 36, 5, '#1d6fd6', { anchor: 'center' });
    box(k, o, -8, T / 2 - 6, L - 36, 5, '#d62828', { anchor: 'center' });
    box(k, o, L / 2 - 24, 0, 22, T - 16, '#8ecae6', { anchor: 'center', radius: 5, outline: [2, '#1b2a49'] });
    disc(k, o, L / 2 - 3, -T / 2 + 9, 5, '#ffe066');
    disc(k, o, L / 2 - 3, T / 2 - 9, 5, '#ffe066');
    label(k, o, 'ORDNUNGSAMT', -18, 0, { size: 12, color: '#1b2a49', angle: horizontal && dir < 0 ? 180 : 0 });
    o.siren1 = disc(k, o, 14, -T / 2 + 15, 7, '#ff3b3b', { outline: [2, '#1b2a49'] });
    o.siren2 = disc(k, o, 14, T / 2 - 15, 7, '#3b7bff', { outline: [2, '#1b2a49'] });
    const band = bands.add([k.pos(0, 0)]);
    const stripe = horizontal ? box(k, band, 0, v.y - T / 2, ARENA.w, T, '#ff3b3b', { opacity: 0 }) : box(k, band, v.x - T / 2, 0, T, ARENA.h, '#ff3b3b', { opacity: 0 });
    const bang = label(k, band, '‼', horizontal ? (dir > 0 ? 40 : ARENA.w - 40) : v.x, horizontal ? v.y : (dir > 0 ? 100 : ARENA.h - 30), { size: 44, color: '#ffffff', outline: [5, '#c0392b'], opacity: 0 });
    return { obj: o, stripe, bang, band, x: v.x, y: v.y, horizontal };
  }

  function handleEvents(s) {
    const maxId = s.ev.reduce((m, e) => Math.max(m, e.i), 0);
    if (lastEv === null) { lastEv = maxId; return; }   // first snapshot (also after a remount): nothing to replay
    for (const e of s.ev) {
      if (e.i <= lastEv) continue;
      lastEv = Math.max(lastEv, e.i);
      if (!live) continue;
      const who = crew.get(e.s);
      if (e.k === 's') {
        audio.sfx('bump', { rate: 0.9 + Math.random() * 0.3 });
        popup('BUMM!', e.x, e.y - 30, '#ffe066');
        who?.av.bounce(); crew.get(e.o)?.av.bounce();
        if (e.o === self) shake = 0.25;
      } else if (e.k === 'h') {
        audio.sfx('splat');
        popup('KONTROLLIERT!', e.x, e.y - 40, '#ff8080', 34);
        if (who) bubble(e.s);
        if (e.o >= 0) popup('Kollateralschaden!', e.x, e.y - 76, '#ffe066', 24);
        if (e.s === self) shake = 0.5;
      } else if (e.k === 'o') {
        popup('RAUS!', e.x, e.y - 20, '#ffffff', 40);
        if (e.s === self) audio.sfx('lose');
      } else if (e.k === 'v' && k.time() - lastSiren > 3) {
        lastSiren = k.time();
        audio.sfx('endspurt', { volume: 0.5 });
      }
    }
  }

  function render(dt) {
    if (!snap) return;
    const age = Math.min(0.06, k.time() - snapAt);
    const pull = ease(dt, 18);
    const time = k.time();
    for (const p of snap.ps) {
      const e = crew.get(p.s);
      if (!e) continue;
      const tx = p.x + (p.vx + p.kx) * age, ty = p.y + (p.vy + p.ky) * age;
      if (!e.seen || Math.hypot(tx - e.x, ty - e.y) > 160) { e.x = tx; e.y = ty; e.seen = true; } else { e.x += (tx - e.x) * pull; e.y += (ty - e.y) * pull; }
      const out = p.out !== null;
      e.av.pos = k.vec2(e.x, e.y);
      e.av.hidden = out || (p.inv > 0 && Math.floor(time * 14) % 2 === 0);
      e.av.setFacing(p.fx);
      if (p.dash > 0 && time - e.puffAt > 0.035) { e.puffAt = time; puff(e.x, e.y + 8, '#ffffff'); }
      e.mark.hidden = out || !e.mark.text;
      e.mark.pos = k.vec2(e.x, e.y - 52 + Math.sin(time * 6) * 4);
      e.bar.hidden = out || p.s !== self;
      e.bar.pos = k.vec2(e.x - 20, e.y + 50);
      e.bar.width = 40 * (1 - p.cd / C.COOLDOWN_MS);
      e.stun.hidden = out || p.stun <= 0;
      e.stun.pos = k.vec2(e.x, e.y - 40);
      e.ghost.hidden = !out;
      setText(e.ghost, out ? '📄 kontrolliert' : '');
      e.ghost.pos = k.vec2(e.x, e.y);
      setText(e.hearts, out ? '📄 raus' : HEART.repeat(Math.max(0, p.lives)) + BLACK_HEART.repeat(Math.max(0, C.LIVES - p.lives)));
    }
    // vans: create / move / remove
    const seen = new Set();
    for (const v of snap.vans) {
      seen.add(v.id);
      let e = vans.get(v.id);
      if (!e) { e = makeVan(v); vans.set(v.id, e); }
      const tx = v.x + v.vx * age, ty = v.y + v.vy * age;
      e.x += (tx - e.x) * pull; e.y += (ty - e.y) * pull;
      e.obj.pos = k.vec2(e.x, e.y);
      const flash = Math.floor(time * 8) % 2 === 0;
      e.obj.siren1.color = k.rgb(flash ? '#ff3b3b' : '#6b1a1a');
      e.obj.siren2.color = k.rgb(flash ? '#1a2a6b' : '#3b7bff');
      const outside = e.x < -v.w / 2 || e.x > ARENA.w + v.w / 2 || e.y < -v.h / 2 || e.y > ARENA.h + v.h / 2;
      const pulse = 0.18 + 0.14 * Math.sin(time * 18);
      e.stripe.opacity = outside ? pulse : 0;
      e.bang.opacity = outside ? 1 : 0;
    }
    for (const [id, e] of vans) if (!seen.has(id)) { e.obj.destroy(); e.band.destroy(); vans.delete(id); }
    const left = Math.max(0, Math.ceil((DURATION_MS - snap.t) / 1000));
    setText(timerTxt, snap.done ? 'Feierabend!' : `Noch ${left} s`);
    if (snap.done && !doneShown && live) {
      doneShown = true;
      const alivePs = snap.ps.filter((p) => p.out === null);
      showBanner('FEIERABEND!', alivePs.length === 1 ? 'Nur einer ist dem Ordnungsamt entkommen.' : '');
    }
  }

  root.onUpdate(() => {
    const dt = k.dt();
    netT += dt;
    render(dt);
    bannerAge += dt;
    const a = bannerAge < 0.2 ? bannerAge / 0.2 : bannerAge > 1.8 ? Math.max(0, 1 - (bannerAge - 1.8) / 0.4) : 1;
    banner.opacity = a; bannerSub.opacity = a;
    banner.scale = k.vec2(1 + (1 - Math.min(1, bannerAge / 0.2)) * 0.8);
    shake = Math.max(0, shake - dt);
    world.pos = shake > 0 ? k.vec2((Math.random() - 0.5) * 22 * shake, (Math.random() - 0.5) * 22 * shake) : k.vec2(0, 0);
  });

  return {
    go() {
      live = true;
      audio.sfx('endspurt');
      lastSiren = k.time();
      showBanner('ORDNUNGSAMT!', BUBBLE);
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
