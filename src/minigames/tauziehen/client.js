// Pfand-Tauziehen: Kaplay client. Sends nothing itself (the runner ships the latched button taps to the host); draws the host snapshots + instant local feedback.
import { createRng } from '../../contracts.js';
import { box, disc, label, ease, setText, addHint } from '../draw.js';
import { DURATION_MS, LINE, TEAM_NAMES, TEAM_COLORS, makeBot } from './sim.js';
import LINES from './lines.js';

const W = 1280;
const CRATE_PX = 3.4, SHIFT = 1.4;                   // crate px per pos unit / how far the crews get dragged per pos unit
const HEAD_X = 390, SPACING = 88;                    // the crew member nearest the crate stands this far from the middle (at pos 0)
const FEET_Y = 500, ROPE_Y = 482, AV = 72;
const say = (audio, key) => { const a = LINES[key]; audio.say(a[Math.floor(Math.random() * a.length)]); };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function mountTauziehen(ctx) {
  const { k, root, audio, input } = ctx;
  const self = ctx.selfSeat;
  const isPlayer = ctx.view === 'main' && ctx.seats.some((s) => s.index === self);
  const bot = ctx.isBot ? makeBot(createRng((ctx.seed ^ Math.imul(self + 1, 0x85EBCA6B)) >>> 0)) : null;
  const world = root.add([k.pos(0, 0)]);

  // ---- who is on which team (same fallback split as sim.js) ----
  const seatIds = ctx.seats.map((s) => s.index);
  const teams = ctx.teams && ctx.teams.length === 2 ? ctx.teams : [seatIds.slice(0, Math.ceil(seatIds.length / 2)), seatIds.slice(Math.ceil(seatIds.length / 2))];
  const myTeam = teams.findIndex((t) => t.includes(self));

  // ---- static scene: Hinterhof, Späti, Kopfsteinpflaster, two finish lines ----
  const sky = ['#8fd3f4', '#a5dcf5', '#bce5f6', '#d3eef8'];
  sky.forEach((c, i) => box(k, world, 0, i * 90, W, 92, c));
  disc(k, world, 1080, 90, 46, '#fff3b0', { outline: [6, '#ffe066'] });
  const skyline = [[20, 190, 120, 230, '#8d99ae'], [150, 150, 100, 270, '#7b8794'], [260, 210, 140, 210, '#97a3b6'], [410, 170, 90, 250, '#7b8794'], [840, 200, 130, 220, '#8d99ae'], [980, 140, 110, 280, '#7b8794'], [1100, 190, 160, 230, '#97a3b6']];
  for (const [x, y, w, h, c] of skyline) {
    box(k, world, x, y, w, h, c, { outline: [3, '#5f6b7a'] });
    for (let wy = y + 16; wy < y + h - 40; wy += 34) for (let wx = x + 14; wx < x + w - 20; wx += 30) box(k, world, wx, wy, 14, 18, ((wx + wy) / 8) % 3 < 1 ? '#ffe9a8' : '#4b5566');
  }
  box(k, world, 500, 250, 330, 200, '#e8b730', { radius: 8, outline: [5, '#8a6a00'] });       // Späti
  box(k, world, 500, 250, 330, 44, '#c0392b', { radius: 8, outline: [5, '#7a1f16'] });
  label(k, world, 'SPÄTI', 665, 272, { size: 34, color: '#fff7d6', outline: [4, '#7a1f16'] });
  box(k, world, 530, 320, 130, 100, '#9ad7ee', { radius: 6, outline: [4, '#1b2a49'] });
  label(k, world, '🍺🥤🍫', 595, 372, { size: 34 });
  box(k, world, 690, 320, 110, 130, '#5c3b1e', { radius: 4, outline: [4, '#2e1d0e'] });
  label(k, world, 'OFFEN', 745, 345, { size: 18, color: '#ffe066' });
  box(k, world, 0, 440, W, 54, '#b8b3a6', { outline: [3, '#8a8575'] });                            // Gehweg
  box(k, world, 0, 494, W, 226, '#6f6a5e');                                                        // Kopfsteinpflaster
  for (let y = 494; y < 720; y += 28) for (let x = ((y / 28) % 2) * 20; x < W; x += 40) box(k, world, x + 2, y + 2, 36, 24, ((x + y) / 28) % 3 < 1 ? '#7d776a' : '#767063', { radius: 6 });
  const lineX = [640 - LINE * CRATE_PX, 640 + LINE * CRATE_PX];
  for (let y = 498; y < 548; y += 26) box(k, world, 638, y, 4, 14, '#ffe066');                     // middle
  lineX.forEach((x, t) => {
    box(k, world, x - 3, 400, 6, 240, '#ffffff', { opacity: 0.85 });
    box(k, world, x - 3, 330, 6, 90, '#5f6b7a');
    box(k, world, x - 3, 330, 62 * (t ? -1 : 1), 36, TEAM_COLORS[t], { outline: [3, '#1b2a49'] });
    label(k, world, 'ZIEL', x, 650, { size: 20, color: '#ffffff', outline: [4, '#1b2a49'] });
  });

  // ---- layers ----
  const crowd = world.add([k.pos(0, 0)]);
  const ropeObj = world.add([k.pos(0, 0)]);
  const crate = world.add([k.pos(640, FEET_Y - 35), k.rotate(0), k.scale(1.25)]);
  const fx = world.add([k.pos(0, 0)]);
  const hud = root.add([k.pos(0, 0)]);

  // the crate: a Pfandkasten full of bottles
  box(k, crate, -46, 32, 92, 8, '#000000', { opacity: 0.25, radius: 4 });
  box(k, crate, -50, -28, 100, 56, '#d79a2b', { radius: 6, outline: [4, '#7a4e0f'] });
  box(k, crate, -42, -18, 84, 12, '#b9801c', { radius: 3 });
  box(k, crate, -42, 2, 84, 12, '#b9801c', { radius: 3 });
  label(k, crate, 'PFAND', 0, 18, { size: 16, color: '#4a2d05' });
  label(k, crate, '🍾🍾🍾', 0, -40, { size: 30 });
  label(k, crate, '25 Cent', 0, -1, { size: 12, color: '#4a2d05' });

  // ---- crews ----
  const crew = new Map();    // seat -> entry
  teams.forEach((members, t) => members.forEach((seat, i) => {
    const prof = ctx.seats.find((s) => s.index === seat)?.profile;
    if (!prof) return;
    const dir = t === 0 ? 1 : -1;                     // faces the crate
    const holder = crowd.add([k.pos(0, FEET_Y), k.rotate(0)]);
    const av = ctx.addAvatar(prof, { size: AV, showName: false, parent: holder });
    av.pos = k.vec2(0, -46);
    av.setFacing(dir);
    const mark = label(k, holder, seat === self ? '▼' : '', 0, -118, { size: 26, color: '#ffe066', outline: [4, '#1b2a49'] });
    const tired = label(k, holder, '🥵', 0, -112, { size: 26 });
    tired.hidden = true; mark.hidden = !mark.text;
    const nameTag = label(k, crowd, prof.name ?? '', 0, FEET_Y + 20 + (i % 2) * 22, { size: 17, outline: [4, '#1b2a49'], width: 230, align: 'center' });
    crew.set(seat, { seat, t, i, dir, holder, av, mark, tired, nameTag, color: prof.color, x: 640, base: 0, n: -1, kick: 0, pw: 0, st: 1 });
  }));
  const baseX = (e) => (e.t === 0 ? HEAD_X - e.i * SPACING : W - HEAD_X + e.i * SPACING);
  for (const e of crew.values()) { e.base = baseX(e); e.x = e.base; e.holder.pos = k.vec2(e.x, FEET_Y); e.nameTag.pos = k.vec2(e.x, e.nameTag.pos.y); }

  // ---- HUD ----
  const barX0 = 240, barW = 800, barY = 40;
  box(k, hud, barX0 - 4, barY - 4, barW + 8, 28, '#14182a', { radius: 10, outline: [3, '#ffffff'] });
  const fillL = box(k, hud, barX0, barY, barW / 2, 20, TEAM_COLORS[0], { radius: 6 });
  const fillR = box(k, hud, barX0 + barW / 2, barY, barW / 2, 20, TEAM_COLORS[1], { radius: 6 });
  const marker = disc(k, hud, 640, barY + 10, 14, '#ffffff', { outline: [4, '#14182a'] });
  label(k, hud, TEAM_NAMES[0], barX0, barY - 16, { size: 22, color: '#ffffff', outline: [4, TEAM_COLORS[0]], anchor: 'left' });
  label(k, hud, TEAM_NAMES[1], barX0 + barW, barY - 16, { size: 22, color: '#ffffff', outline: [4, TEAM_COLORS[1]], anchor: 'right' });
  label(k, hud, '←', 210, barY + 10, { size: 30, color: '#ffffff', outline: [4, TEAM_COLORS[0]] });
  label(k, hud, '→', 1070, barY + 10, { size: 30, color: '#ffffff', outline: [4, TEAM_COLORS[1]] });
  const timerTxt = label(k, hud, '', 640, 94, { size: 26, color: '#ffffff', outline: [4, '#1b2a49'] });
  const banner = label(k, hud, '', 640, 220, { size: 76, color: '#ffffff', outline: [8, '#c0392b'], opacity: 0 });
  const bannerSub = label(k, hud, '', 640, 285, { size: 30, color: '#ffffff', outline: [5, '#1b2a49'], opacity: 0 });

  const pads = [];
  let comboTxt = null, staminaFill = null;
  if (isPlayer) {
    label(k, hud, `Du ziehst für ${TEAM_NAMES[myTeam]} ${myTeam === 0 ? '←' : '→'}`, 640, 566, { size: 22, color: '#ffffff', outline: [4, TEAM_COLORS[myTeam]] });
    [['A', '#6bcf63', 590, 'Leertaste / A'], ['X', '#4dabf7', 690, 'E / X']].forEach(([ch, c, x, cap]) => {
      const o = hud.add([k.pos(x, 606), k.scale(1)]);
      disc(k, o, 0, 0, 22, c, { outline: [4, '#14182a'] });
      label(k, o, ch, 0, 1, { size: 24, color: '#14182a' });
      label(k, hud, cap, x, 640, { size: 15, color: '#ffffff', outline: [3, '#14182a'] });
      pads.push(o);
    });
    comboTxt = label(k, hud, '', 800, 606, { size: 26, color: '#ffe066', outline: [4, '#14182a'], anchor: 'left' });
    addHint(k, hud, '{key:Leertaste} / {A} und {key:E} / {X}  abwechselnd hämmern!', 640, 668, { size: 20, outline: [4, '#14182a'] });
    box(k, hud, 510, 692, 260, 14, '#14182a', { radius: 6, outline: [2, '#ffffff'] });
    staminaFill = box(k, hud, 512, 694, 256, 10, '#8ce99a', { radius: 4 });
    label(k, hud, 'Puste', 496, 699, { size: 16, color: '#ffffff', outline: [3, '#14182a'], anchor: 'right' });
  }

  // ---- state ----
  let snap = null, snapAt = 0, live = false, doneShown = false, bannerAge = 9, dispPos = 0, saidPull = false, lastSay = -9, sweatCount = 0;
  let lastBtn = 0, streak = 0, shake = 0;
  const showBanner = (text, sub = '', outline = '#c0392b') => { banner.text = text; banner.outline.color = k.rgb(outline); bannerSub.text = sub; bannerAge = 0; };
  const saySafe = (key) => { if (k.time() - lastSay < 3) return; lastSay = k.time(); say(audio, key); };

  function sweat(e) {
    if (sweatCount > 50) return;
    sweatCount++;
    const o = disc(k, fx, e.x - e.dir * 18 + (Math.random() - 0.5) * 14, FEET_Y - 108, 3 + Math.random() * 2, '#8fd8ff', { outline: [2, '#2b86c5'] });
    let vx = -e.dir * (50 + Math.random() * 90), vy = -(110 + Math.random() * 130), age = 0;
    o.onUpdate(() => {
      const dt = k.dt(); age += dt; vy += 520 * dt;
      o.pos = k.vec2(o.pos.x + vx * dt, o.pos.y + vy * dt);
      o.opacity = clamp(1 - age / 0.7, 0, 1);
      if (age > 0.7) { sweatCount--; o.destroy(); }
    });
  }
  function popup(text, x, y, color, size = 26) {
    const o = label(k, fx, text, x, y, { size, color, outline: [5, '#1b2a49'] });
    o.onUpdate(() => { o.pos = k.vec2(o.pos.x, o.pos.y - 60 * k.dt()); o.opacity -= k.dt() * 1.1; if (o.opacity <= 0) o.destroy(); });
  }
  function confetti(t) {
    for (let i = 0; i < 50; i++) {
      const o = box(k, fx, 640 + (Math.random() - 0.5) * 800, -20, 8, 12, i % 3 ? TEAM_COLORS[t] : '#ffe066', { angle: Math.random() * 360 });
      const vy = 120 + Math.random() * 200, vx = (Math.random() - 0.5) * 120;
      o.onUpdate(() => { o.pos = k.vec2(o.pos.x + vx * k.dt(), o.pos.y + vy * k.dt()); o.angle += 200 * k.dt(); if (o.pos.y > 740) o.destroy(); });
    }
  }

  // ---- my own button mashing: instant feedback (the host counts the taps itself) ----
  function localPress(id) {
    const e = crew.get(self);
    const alt = lastBtn !== 0 && lastBtn !== id;
    streak = alt ? streak + 1 : 0;
    lastBtn = id;
    audio.sfx('mash', { volume: 0.7, rate: (alt ? 1.1 : 0.82) + Math.random() * 0.2 + Math.min(streak, 10) * 0.025 });
    if (pads[id - 1]) pads[id - 1].scale = k.vec2(1.45);
    if (comboTxt) { comboTxt.text = alt ? 'DOPPELT!' : 'nur halb!'; comboTxt.color = k.rgb(alt ? '#8ce99a' : '#ff9f43'); }
    if (e) { e.kick = 1; if (Math.random() < 0.6) sweat(e); }
    shake = Math.min(1, shake + 0.12);
    if (streak > 0 && streak % 10 === 0 && e) popup('Hau rein!', e.x, FEET_Y - 110, '#ffe066', 24);
  }

  function render(dt) {
    if (!snap) return;
    const time = k.time();
    const age = Math.min(0.06, time - snapAt);
    dispPos += ((snap.pos + snap.v * age) - dispPos) * ease(dt, 14);
    const pull = ease(dt, 16);
    // crews
    for (const p of snap.ps) {
      const e = crew.get(p.s);
      if (!e) continue;
      e.pw = p.pw; e.st = p.st;
      const tx = e.base + dispPos * SHIFT;
      e.x += (tx - e.x) * pull;
      e.kick = Math.max(0, e.kick - dt * 5);
      const lean = 5 + Math.min(p.pw, 5) * 3.2 + e.kick * 6;
      e.holder.pos = k.vec2(e.x, FEET_Y - e.kick * 3);
      e.nameTag.pos = k.vec2(e.x, FEET_Y + 20 + (e.i % 2) * 22);
      e.holder.angle = -e.dir * lean + Math.sin(time * 28 + e.i * 2) * Math.min(3, p.pw);
      e.tired.hidden = !(p.st < 0.25);
    }
    // crate
    const cx = 640 + dispPos * CRATE_PX;
    const total = snap.tp[0] + snap.tp[1];
    crate.pos = k.vec2(cx, FEET_Y - 35 + Math.sin(time * 33) * Math.min(2.5, total * 0.25));
    crate.angle = Math.sin(time * 21) * Math.min(4, 0.5 + total * 0.4);
    // meter
    const mx = 640 + clamp(dispPos / LINE, -1, 1) * (barW / 2 - 14);
    marker.pos = k.vec2(mx, barY + 10);
    fillL.width = Math.max(1, mx - barX0); fillR.pos = k.vec2(mx, barY); fillR.width = Math.max(1, barX0 + barW - mx);
    const left = Math.max(0, Math.ceil((DURATION_MS - snap.t) / 1000));
    setText(timerTxt, snap.done ? 'Abgepfiffen!' : `Noch ${left} s`);
    if (staminaFill) {
      const me = snap.ps.find((p) => p.s === self);
      if (me) { staminaFill.width = Math.max(1, 256 * me.st); staminaFill.color = k.rgb(me.st < 0.25 ? '#ff6b6b' : me.st < 0.5 ? '#ffd43b' : '#8ce99a'); }
    }
    if (live && !saidPull && snap.t > 9000 && !snap.done) { saidPull = true; saySafe('pull'); }
    if (snap.done && !doneShown && live) {
      doneShown = true;
      const w = snap.win;
      if (w < 0) showBanner('UNENTSCHIEDEN!', 'Der Kasten bleibt in der Mitte.', '#5f6b7a');
      else {
        showBanner(`${TEAM_NAMES[w].toUpperCase()} GEWINNT!`, snap.pos * (w ? 1 : -1) >= LINE - 0.01 ? 'Der Kasten ist über der Linie!' : 'Der Kasten liegt auf eurer Seite!', TEAM_COLORS[w]);
        confetti(w);
        if (isPlayer && myTeam >= 0) { audio.sfx(myTeam === w ? 'win' : 'lose'); lastSay = -9; saySafe(myTeam === w ? 'win' : 'lose'); }
      }
    }
  }

  root.onUpdate(() => {
    const dt = k.dt();
    if (live && isPlayer) {
      if (input.pressed('jump')) localPress(1);
      if (input.pressed('action')) localPress(2);
    }
    for (const p of pads) { const s = p.scale.x + (1 - p.scale.x) * ease(dt, 16); p.scale = k.vec2(s); }
    shake = Math.max(0, shake - dt * 2);
    render(dt);
    // rope + arms
    bannerAge += dt;
    const a = bannerAge < 0.2 ? bannerAge / 0.2 : bannerAge > 2.4 ? Math.max(0, 1 - (bannerAge - 2.4) / 0.5) : 1;
    banner.opacity = a; bannerSub.opacity = a;
    banner.scale = k.vec2(1 + (1 - Math.min(1, bannerAge / 0.2)) * 0.8);
  });

  ropeObj.onDraw(() => {
    const es = [...crew.values()];
    if (!es.length) return;
    const time = k.time();
    const x0 = Math.min(...es.map((e) => e.x)) - 14, x1 = Math.max(...es.map((e) => e.x)) + 14;
    const amp = clamp(1 + es.reduce((s, e) => s + e.kick, 0) * 2.5 + (snap ? (snap.tp[0] + snap.tp[1]) * 0.5 : 0), 1, 9);
    const pts = [];
    for (let i = 0; i <= 44; i++) {
      const t = i / 44;
      pts.push(k.vec2(x0 + (x1 - x0) * t, ROPE_Y + Math.sin(t * Math.PI) * 5 + Math.sin(t * 14 + time * 40) * amp * Math.sin(t * Math.PI)));
    }
    for (const e of es) {          // arms to the rope
      k.drawLine({ p1: k.vec2(e.x + e.dir * 8, FEET_Y - 54), p2: k.vec2(e.x + e.dir * 22, ROPE_Y), width: 7, color: k.rgb('#1b2a49') });
      k.drawLine({ p1: k.vec2(e.x + e.dir * 8, FEET_Y - 54), p2: k.vec2(e.x + e.dir * 22, ROPE_Y), width: 4, color: k.rgb(e.color) });
    }
    k.drawLines({ pts, width: 11, color: k.rgb('#5a3b17'), join: 'round' });
    k.drawLines({ pts, width: 7, color: k.rgb('#d9b26b'), join: 'round' });
  });

  return {
    go() {
      live = true;
      audio.sfx('go');
      showBanner('ZIEHT!', 'Abwechselnd hämmern zählt doppelt!', '#c0392b');
      saySafe('start');
    },
    update(s) {
      if (!s || !Array.isArray(s.ps)) return;
      const first = snap === null;
      snap = s; snapAt = k.time();
      if (first) dispPos = s.pos;
      let others = false;
      for (const p of s.ps) {
        const e = crew.get(p.s);
        if (!e) continue;
        if (!first && live && p.n > e.n && p.s !== self) { e.kick = 1; others = true; if (Math.random() < 0.5) sweat(e); }
        e.n = p.n;
      }
      if (others) audio.sfx('mash', { volume: 0.16, rate: 0.7 + Math.random() * 0.4 });
    },
    botInput() {
      if (!bot || !isPlayer) return {};
      const b = bot.tick(k.dt() * 1000);
      return b ? { [b]: true } : {};
    },
    destroy() {},   // everything hangs off root (the runner destroys it)
  };
}
