// "Pfandautomat": Kaplay client (main lane + thumbnail). The rules, the seeded item schedule and the press judging live in seq.js.
import { createRng } from '../../contracts.js';
import { box, disc, label, setText, ease, addHint } from '../draw.js';
import LINES from './lines.js';
import { HINT } from '../../ui/glyphs.js';
import {
  DURATION_MS, RAMP_MS, SLOT_X, HALF, speedAt, makeSchedule, judgePress, posAt, halfOf, centsOf, isGood, euro,
} from './seq.js';

const BELT_Y = 452;            // top of the belt = where the items stand
const BELT_END = 650;          // missed items fall off here, the machine face starts right behind
const MACH = { x: 660, y: 70 };
const JAM_S = 0.9;             // lockout in seconds (was 1.6)
const HAMMER_S = 0.2;          // every X press takes this off the lockout (was 0.14)
const MIN_JAM_S = 0.3;        // ...but the machine stays stuck at least this long (was 0.45)
const STRIPE = 48;

const WHY = {
  early: 'Zu früh eingeworfen!',
  late: 'Zu spät eingeworfen!',
  crate: 'Die Kiste muss GANZ rein: mittig!',
  empty: 'Da war gar nichts im Fenster.',
  canNo: 'Dose ohne Pfand-Logo!',
  jar: 'Ein Gurkenglas ist kein Leergut.',
  doener: 'Döner. Der Automat hat Hunger, aber nein.',
  sock: 'Eine Socke. Natürlich.',
};

function buildItem(k, o, kind) {
  const B = { anchor: 'bot' };
  if (kind === 'glass') {
    box(k, o, 0, 0, 34, 58, '#6a3b1a', { ...B, radius: 8 });
    box(k, o, 0, -52, 14, 34, '#6a3b1a', { ...B, radius: 4 });
    box(k, o, 0, -84, 18, 7, '#d9a521', B);
    box(k, o, 0, -12, 26, 22, '#f1e3b5', B);
    box(k, o, -9, -16, 5, 34, '#ffffff', { ...B, opacity: 0.25 });
  } else if (kind === 'pet') {
    box(k, o, 0, 0, 32, 62, '#bfe8f7', { ...B, radius: 9, outline: [2, '#7fb6cc'] });
    box(k, o, 0, -58, 14, 24, '#bfe8f7', { ...B, radius: 3, outline: [2, '#7fb6cc'] });
    box(k, o, 0, -80, 18, 8, '#2ecc40', B);
    box(k, o, 0, -16, 32, 18, '#2f7be0', B);
    box(k, o, -8, -10, 4, 40, '#ffffff', { ...B, opacity: 0.4 });
  } else if (kind === 'can' || kind === 'canNo') {
    box(k, o, 0, 0, 38, 56, '#cfd8dc', { ...B, radius: 6, outline: [2, '#8b979d'] });
    box(k, o, 0, -56, 34, 6, '#9aa5ab', B);
    box(k, o, 0, -12, 38, 14, kind === 'can' ? '#c0392b' : '#2f6fb0', B);
    if (kind === 'can') {   // the Pfand logo is the only difference to the junk can
      disc(k, o, 0, -36, 11, '#1faa3c', { outline: [2, '#ffffff'] });
      label(k, o, 'P', 0, -36, { size: 16 });
    }
  } else if (kind === 'jar') {
    box(k, o, 0, 0, 46, 52, '#dff3ee', { ...B, radius: 8, outline: [2, '#9ec9c0'] });
    box(k, o, 0, -2, 38, 32, '#8fbf4a', { ...B, radius: 6 });
    box(k, o, 0, -52, 48, 9, '#d4a017', { ...B, radius: 3 });
  } else if (kind === 'doener') {
    label(k, o, '🥙', 0, -36, { size: 70 });
  } else if (kind === 'sock') {
    label(k, o, '🧦', 0, -36, { size: 70 });
  } else if (kind === 'crate') {
    for (let i = 0; i < 6; i++) box(k, o, -60 + i * 24, -62, 14, 30, '#3e7a3a', { ...B, radius: 4 });
    box(k, o, 0, 0, 160, 70, '#2d3a45', { ...B, radius: 6, outline: [3, '#1b2a36'] });
    box(k, o, 0, -20, 126, 30, '#f2c500', { ...B, radius: 4 });
    label(k, o, 'MATE-KISTE', 0, -35, { size: 19, color: '#1b2a36' });
    box(k, o, -2, -72, 4, 72, '#ffffff', { ...B, opacity: 0.55 });   // the centre mark: this is where the slot has to meet the crate
  }
}

/** Machine body shared by the lane and the thumbnail. Returns the objects the callers animate. */
function buildMachine(k, parent, x, y) {
  const m = parent.add([k.pos(x, y)]);
  box(k, m, 0, 0, 280, 520, '#2f7d6a', { radius: 10, outline: [5, '#1d4f43'] });
  box(k, m, 10, 10, 260, 40, '#256555', { radius: 6 });
  label(k, m, 'LEERGUT', 100, 31, { size: 26, color: '#ffe066', outline: [3, '#14382f'] });
  const light = disc(k, m, 236, 31, 14, '#2c4a40', { outline: [3, '#14382f'] });
  box(k, m, 20, 62, 240, 74, '#101c2a', { radius: 6, outline: [3, '#0a1220'] });
  const disp = label(k, m, 'Bitte Leergut einwerfen', 140, 99, { size: 20, color: '#9be7ff', width: 220, align: 'center' });
  box(k, m, 20, 148, 240, 78, '#0b1f12', { radius: 6, outline: [3, '#0a1220'] });
  const lcd = label(k, m, '0,00 €', 140, 188, { size: 52, color: '#7cfc8a' });
  box(k, m, 20, 244, 240, 12, '#256555', { radius: 4 });
  for (let i = 0; i < 4; i++) box(k, m, 30 + i * 58, 270, 44, 14, '#256555', { radius: 3 });
  label(k, m, 'Pfand = Cash', 140, 316, { size: 20, color: '#c8f3e3' });
  box(k, m, 0, 330, 34, 126, '#0d0d0d', { radius: 3 });   // the slot (the belt ends right here)
  for (let i = 0; i < 5; i++) box(k, m, 34, 336 + i * 24, 14, 6, '#1b1b1b', { radius: 2 });
  box(k, m, 60, 468, 160, 16, '#0d0d0d', { radius: 3 });   // Bon slot
  label(k, m, 'BON', 140, 500, { size: 16, color: '#c8f3e3' });
  return { m, light, disp, lcd };
}

export function mountPfand(ctx) {
  const { k, root } = ctx;
  const profile = ctx.seats.find((s) => s.index === ctx.seat)?.profile ?? { name: '?', color: '#ffb400', hat: 'none' };
  return ctx.view === 'thumb' ? mountThumb(ctx, profile) : mountMain(ctx, profile);
}

// ---------------------------------------------------------------------------------------------------------------- thumbnail
function mountThumb(ctx, profile) {
  const { k, root } = ctx;
  box(k, root, 0, 0, 960, 720, '#cfe3e8');
  box(k, root, 0, 560, 960, 160, '#8a8f98');
  const { m, light, disp, lcd } = buildMachine(k, root, 340, 80);
  m.scale = k.vec2(1.0, 1.0);
  lcd.textSize = 52;
  const count = label(k, root, '', 480, 640, { size: 56, color: '#2d3a45' });
  const av = ctx.addAvatar(profile, { size: 90, showName: true });
  av.pos = k.vec2(150, 560);
  let remote = { c: 0, j: 0, n: 0, d: 0 }, shown = 0, lastJam = 0, lastN = 0;
  root.onUpdate(() => {
    const dt = k.dt();
    shown += (remote.c - shown) * ease(dt, 10);
    setText(lcd, euro(Math.abs(shown - remote.c) < 1 ? remote.c : Math.round(shown / 5) * 5));   // counts up in 5 ct steps
    setText(count, remote.d ? 'Bon geholt!' : `${remote.n} Stück`);
    if (remote.j) {
      light.color = Math.sin(k.time() * 18) > 0 ? k.rgb('#ff2a1a') : k.rgb('#5a1510');
      setText(disp, 'Leergut wird nicht angenommen');
      disp.color = k.rgb('#ff6b5a');
      m.pos = k.vec2(340 + (Math.random() - 0.5) * 8, 80 + (Math.random() - 0.5) * 6);
      if (!lastJam) av.bounce?.();
    } else {
      light.color = k.rgb('#2c4a40');
      setText(disp, remote.d ? 'Bitte entnehmen Sie Ihren Bon.' : 'Bitte Leergut einwerfen');
      disp.color = k.rgb('#9be7ff');
      m.pos = k.vec2(340, 80);
    }
    if (remote.n > lastN) light.color = k.rgb('#40e060');
    lastJam = remote.j; lastN = remote.n;
  });
  return {
    go() {},
    update(p) { if (p && typeof p === 'object') remote = { c: p.c | 0, j: p.j ? 1 : 0, n: p.n | 0, d: p.d ? 1 : 0 }; },
    botInput: () => ({}),
    destroy() {},
  };
}

// ---------------------------------------------------------------------------------------------------------------- main lane
function mountMain(ctx, profile) {
  const { k, root, input, audio } = ctx;
  const sched = makeSchedule(ctx.rng);
  const items = sched.map((s) => ({ ...s, s: 'belt', obj: null, ticked: false, plan: null }));
  const lastT = sched[sched.length - 1].T;
  const botRng = createRng((ctx.seed ^ Math.imul(ctx.selfSeat + 1, 0x9E3779B1)) >>> 0);

  // ---- static scene ----
  box(k, root, 0, 0, 960, 520, '#cfe3e8');
  for (let x = 0; x < 960; x += 80) box(k, root, x, 0, 3, 520, '#bcd3da');
  for (let y = 80; y < 520; y += 80) box(k, root, 0, y, 960, 3, '#bcd3da');
  box(k, root, 0, 520, 960, 200, '#8a8f98');
  box(k, root, 0, 520, 960, 8, '#6f747c');
  // wall sign + stats
  box(k, root, 30, 36, 440, 64, '#ffe066', { radius: 8, outline: [4, '#b8860b'] });
  label(k, root, 'Pfand gehört daneben!', 250, 68, { size: 30, color: '#3b2a00' });
  box(k, root, 30, 118, 214, 54, '#ffffff', { radius: 8, outline: [3, '#8aa0a8'], opacity: 0.85 });
  label(k, root, 'Takt', 52, 135, { size: 16, color: '#47606a', anchor: 'left' });
  box(k, root, 52, 150, 170, 12, '#dbe6ea', { radius: 4 });
  const tempo = box(k, root, 52, 150, 4, 12, '#ff7043', { radius: 4 });
  const stats = label(k, root, '', 258, 145, { size: 22, color: '#47606a', anchor: 'left' });
  // belt
  box(k, root, 0, BELT_Y, BELT_END, 44, '#3b3f46');
  box(k, root, 0, BELT_Y, BELT_END, 6, '#565b64');
  const stripes = [];
  for (let i = 0; i < 15; i++) stripes.push(box(k, root, 0, BELT_Y + 12, 12, 22, '#2b2e34', { radius: 3 }));
  for (let x = 20; x < BELT_END; x += 110) box(k, root, x, BELT_Y + 44, 14, 66, '#6f747c');
  box(k, root, 0, BELT_Y + 100, BELT_END, 10, '#6f747c');
  // the window
  const wx0 = SLOT_X - HALF.normal;
  const zone = box(k, root, wx0, BELT_Y - 130, HALF.normal * 2, 130, '#40e060', { opacity: 0.22 });
  box(k, root, wx0 - 3, BELT_Y - 130, 4, 130, '#40e060');
  box(k, root, SLOT_X + HALF.normal - 1, BELT_Y - 130, 4, 130, '#40e060');
  root.add([k.pos(SLOT_X, BELT_Y - 142), k.polygon([k.vec2(-14, -10), k.vec2(14, -10), k.vec2(0, 8)]), k.color(k.rgb('#40e060')), k.outline(3, k.rgb('#1b5e2a'))]);
  const itemLayer = root.add([k.pos(0, 0)]);
  // dead-centre marker for the Mate-Kiste: only visible while a crate is near the window, drawn above the items
  const centreMark = box(k, root, SLOT_X - 2, BELT_Y - 130, 4, 130, '#ffffff', { opacity: 0 });
  // machine on top of the items: the fed ones vanish behind its face
  const { m, light, disp, lcd } = buildMachine(k, root, MACH.x, MACH.y);
  const bon = box(k, m, 62, 484, 156, 1, '#ffffff', { outline: [2, '#c9c9c9'], opacity: 0 });
  const bonTxt = label(k, m, '', 140, 520, { size: 22, color: '#222222', opacity: 0 });
  // banner (jam)
  const banner = label(k, root, 'Leergut wird nicht angenommen!', 330, 215, { size: 40, color: '#ff3b30', outline: [7, '#3d0a05'], width: 600, align: 'center', opacity: 0 });
  const bannerSub = label(k, root, '', 330, 290, { size: 24, color: '#ffffff', outline: [5, '#3d0a05'], width: 600, align: 'center', opacity: 0 });
  const jamBarBg = box(k, root, 130, 316, 400, 14, '#3d0a05', { radius: 5, opacity: 0 });
  const jamBar = box(k, root, 130, 316, 400, 14, '#ff3b30', { radius: 5, opacity: 0 });
  const hammerHint = addHint(k, root, '{key:E} / {X} Hämmern!', 330, 352, { size: 26, outline: [4, '#3d0a05'], opacity: 0 });
  const fx = root.add([k.pos(0, 0)]);
  // first-time callouts (once per run, ~2 s, one shared slot above the window)
  const shownCallouts = new Set();
  let callout = null, calloutBg = null, calloutAge = 0;
  const showCallout = (id, text, y = 262) => {
    if (shownCallouts.has(id)) return;
    shownCallouts.add(id);
    callout?.destroy(); calloutBg?.destroy();
    callout = addHint(k, root, text, 400, y, { size: 26, color: '#ffe066' });
    calloutBg = box(k, root, 400 - callout.width / 2 - 16, y - 24, callout.width + 32, 48, '#1b2a49', { radius: 12, opacity: 0.88, outline: [3, '#ffe066'] });
    callout.destroy(); callout = addHint(k, root, text, 400, y, { size: 26, color: '#ffe066' });   // re-added so the text sits above the plate
    calloutAge = 0;
  };
  addHint(k, root, `{key:Leertaste} / {A} Einwerfen   ${HINT.mgBack} Wegwerfen`, 520, 700, { size: 19, outline: [3, '#2d3a45'] });
  const av = ctx.addAvatar(profile, { size: 76, showName: true });
  av.pos = k.vec2(110, 630);

  // ---- state ----
  let live = false, t = 0, cents = 0, fed = 0, streak = 0, jam = 0, jamAge = 0, finished = false, shake = 0, flash = 0, flashColor = '#40e060';
  let travel = 0, dispT = 0, lastSay = -99, lastKey = '', frame = 0, bonAge = 0, done = false, lastStreakSay = 0;
  const say = (key, force = false) => {
    if (!force && k.time() - lastSay < 4.5) return;
    lastSay = k.time();
    const arr = LINES[key];
    audio.say(arr[Math.floor(Math.random() * arr.length)]);
  };
  const popup = (text, x, y, color, size = 30) => {
    const o = label(k, fx, text, x, y, { size, color, outline: [5, '#1b2a49'] });
    o.onUpdate(() => { o.pos = k.vec2(o.pos.x, o.pos.y - 80 * k.dt()); o.opacity -= k.dt() * 0.9; if (o.opacity <= 0) o.destroy(); });
    return o;
  };
  const display = (str, color, secs) => { disp.text = str; disp.color = k.rgb(color); dispT = secs; };

  const open = () => items.filter((i) => i.s === 'belt' && i.obj);

  function setFlash(color) { flash = 0.28; flashColor = color; }

  function jamStart(why, item) {
    jam = JAM_S; jamAge = 0; streak = 0; shake = 0.55;
    banner.text = 'Leergut wird nicht angenommen!';
    bannerSub.text = WHY[why] ?? '';
    display('Leergut wird nicht angenommen', '#ff6b5a', 99);
    audio.sfx('jam'); audio.sfx('error', { volume: 0.6 });
    av.bounce?.();
    setFlash('#ff3b30');
    showCallout('jam', 'Klemmt! Hämmern ({key:E} / {X})!', 395);   // lower than the others: the jam banner sits at y 190-300
    if (item) { item.s = 'spit'; item.vx = -420; item.vy = -700; item.spin = 520; }
    const junkKinds = ['canNo', 'jar', 'doener', 'sock'];
    if (junkKinds.includes(why)) say('junk'); else say('jam');
  }

  function press() {
    const r = judgePress(open(), t);
    if (r.kind === 'feed') {
      const it = r.item;
      it.s = 'fed';
      const c = centsOf(it);
      cents += c; fed++; streak++;
      const crate = it.kind === 'crate';
      audio.sfx('coinGain', { volume: 0.8, rate: 1 + Math.min(streak, 12) * 0.025 });
      audio.sfx('whoosh', { volume: 0.4, rate: 1.3 });
      popup(`+${euro(c)}`, it.obj.pos.x, BELT_Y - 110, crate ? '#ffe066' : '#8ce99a', crate ? 40 : 30);
      if (r.perfect) popup('Perfekt!', it.obj.pos.x, BELT_Y - 150, '#ffffff', 20);
      display(crate ? 'Die ganze Kiste. Danke!' : 'Danke! Pfand erstattet.', '#9be7ff', 0.7);
      setFlash('#40e060');
      shake = Math.max(shake, 0.12);
      if (crate) { audio.sfx('win', { volume: 0.7 }); av.bounce?.(); say('crate'); }
      if (streak > 0 && streak % 8 === 0 && streak > lastStreakSay) { lastStreakSay = streak; say('streak'); }
    } else if (r.kind === 'wrong') jamStart(r.item.kind, r.item);
    else jamStart(r.reason, null);
  }

  function toss() {
    let best = null, bd = Infinity;
    for (const it of open()) {
      const dx = posAt(it, t) - SLOT_X;
      if (dx > -230 && dx < 120 && Math.abs(dx) < bd) { best = it; bd = Math.abs(dx); }
    }
    if (!best) return;
    best.s = 'toss'; best.vx = -180; best.vy = -980; best.spin = -420;
    audio.sfx('whoosh', { volume: 0.5, rate: 0.8 });
    if (isGood(best) || best.kind === 'crate') popup('Das war Pfand!', best.obj.pos.x, BELT_Y - 120, '#ffb4a8', 22);
    else { popup('Weg damit!', best.obj.pos.x, BELT_Y - 120, '#ffffff', 22); streak++; }
  }

  function finishNow() {
    if (finished) return;
    finished = true;
    ctx.finish({ score: cents, label: euro(cents) });
  }

  function progress() {
    const key = `${cents}|${jam > 0}|${fed}|${done}`;
    if (key === lastKey) return;
    lastKey = key;
    ctx.sendProgress({ c: cents, j: jam > 0 ? 1 : 0, n: fed, d: done ? 1 : 0 });
  }

  function itemFrame(it, dt) {
    if (it.s === 'belt') {
      const x = posAt(it, t);
      if (!it.obj && x > -130) {
        it.obj = itemLayer.add([k.pos(x, BELT_Y), k.rotate(0)]);
        buildItem(k, it.obj, it.kind);
      }
      if (!it.obj) return;
      it.obj.pos = k.vec2(x, BELT_Y);
      if (!it.ticked && t >= it.T) { it.ticked = true; audio.sfx('tick', { volume: 0.22 }); }
      if (x - SLOT_X > halfOf(it)) {   // sailed through the window untouched
        it.s = 'missed'; it.vy = 0;
        if (isGood(it) || it.kind === 'crate') streak = 0; else streak++;
      }
      return;
    }
    if (!it.obj) return;
    const o = it.obj;
    if (it.s === 'fed') {
      o.pos = k.vec2(o.pos.x + 1300 * dt, BELT_Y);
      if (o.pos.x > MACH.x + 60) { o.destroy(); it.obj = null; it.s = 'gone'; }
    } else if (it.s === 'missed') {
      if (o.pos.x < BELT_END - 10) o.pos = k.vec2(o.pos.x + it.v * dt, BELT_Y);
      else { it.vy += 1800 * dt; o.pos = k.vec2(o.pos.x + 60 * dt, o.pos.y + it.vy * dt); o.angle += 160 * dt; }
      if (o.pos.y > 800) { o.destroy(); it.obj = null; it.s = 'gone'; }
    } else if (it.s === 'spit' || it.s === 'toss') {
      it.vy += 2200 * dt;
      o.pos = k.vec2(o.pos.x + it.vx * dt, o.pos.y + it.vy * dt);
      o.angle += it.spin * dt;
      if (o.pos.y > 820) { o.destroy(); it.obj = null; it.s = 'gone'; }
    }
  }

  root.onUpdate(() => {
    const dt = k.dt();
    frame++;
    if (live && !done) {
      t += dt * 1000;
      if (jam > 0) {
        jamAge += dt;
        jam -= dt;
        if (input.pressed('action')) {
          shake = Math.max(shake, 0.25);
          audio.sfx('bump', { volume: 0.5, rate: 0.8 + Math.random() * 0.5 });
          if (jamAge > MIN_JAM_S) jam -= HAMMER_S;
        }
        if (jam <= 0) {
          jam = 0;
          audio.sfx('boing', { volume: 0.7 });
          display('Läuft wieder.', '#9be7ff', 0.8);
          setFlash('#40e060');
        }
      } else if (input.pressed('confirm') || input.pressed('jump')) press();
      else if (input.pressed('back')) toss();
    }
    for (const it of items) itemFrame(it, dt);
    if (live && !done) {
      let crateNear = false;
      for (const it of items) {
        if (it.s !== 'belt' || !it.obj) continue;
        const dx = posAt(it, t) - SLOT_X;
        if (dx > -330 && dx < HALF.normal) {
          if (it.kind === 'crate') showCallout('crate', 'Mate-Kiste: genau mittig! 1 €');
          else if (!isGood(it)) showCallout('junk', `Müll: Wegwerfen (${HINT.mgBack})`);
        }
        if (it.kind === 'crate' && dx > -HALF.normal - 120 && dx < HALF.normal + 20) crateNear = true;
      }
      centreMark.opacity = crateNear ? 0.9 : 0;
    }
    if (callout) {
      calloutAge += dt;
      const a = calloutAge < 1.5 ? 1 : Math.max(0, 1 - (calloutAge - 1.5) / 0.5);
      callout.setOpacity(a); calloutBg.opacity = 0.88 * a;
      if (calloutAge >= 2) { callout.destroy(); calloutBg.destroy(); callout = calloutBg = null; }
    }
    if (live && !done && (t >= lastT + 900 || t >= DURATION_MS - 350)) {
      done = true; bonAge = 0;
      audio.sfx('stamp'); audio.sfx('fanfare', { volume: 0.5 });
      display('Bitte entnehmen Sie Ihren Bon.', '#9be7ff', 99);
      say('done', true);
      finishNow();
    }
    // ---- visuals ----
    travel += (live ? speedAt(t) : 150) * dt;
    stripes.forEach((s, i) => { s.pos = k.vec2(((i * STRIPE + travel) % (15 * STRIPE)) - 24, BELT_Y + 12); });
    tempo.width = Math.max(4, 170 * Math.min(1, t / RAMP_MS));
    setText(stats, `${fed} Stück  Serie ${streak}`);
    setText(lcd, euro(cents));
    if (dispT > 0 && jam <= 0) { dispT -= dt; if (dispT <= 0 && !done) display('Bitte Leergut einwerfen', '#9be7ff', 0); }
    flash = Math.max(0, flash - dt);
    zone.color = flash > 0 ? k.rgb(flashColor) : k.rgb('#40e060');
    zone.opacity = flash > 0 ? 0.55 : 0.22 + 0.06 * Math.sin(k.time() * 6);
    shake = Math.max(0, shake - dt);
    m.pos = shake > 0 ? k.vec2(MACH.x + (Math.random() - 0.5) * 18 * shake, MACH.y + (Math.random() - 0.5) * 12 * shake) : k.vec2(MACH.x, MACH.y);
    const jammed = jam > 0;
    light.color = jammed ? (Math.sin(k.time() * 18) > 0 ? k.rgb('#ff2a1a') : k.rgb('#5a1510')) : flash > 0 ? k.rgb('#40e060') : k.rgb('#2c4a40');
    const blink = jammed ? (Math.sin(k.time() * 14) > -0.3 ? 1 : 0.35) : 0;
    banner.opacity = blink; bannerSub.opacity = jammed ? 1 : 0;
    jamBarBg.opacity = jammed ? 0.8 : 0; jamBar.opacity = jammed ? 1 : 0;
    jamBar.width = Math.max(1, 400 * Math.min(1, jam / JAM_S));
    hammerHint.setOpacity?.(jammed ? 1 : 0);
    if (done) {
      bonAge += dt;
      bon.opacity = 1;
      bon.height = Math.min(150, bonAge * 260);
      bonTxt.opacity = bonAge > 0.5 ? 1 : 0;
      setText(bonTxt, euro(cents));
      bonTxt.pos = k.vec2(140, 484 + Math.min(150, bonAge * 260) / 2);
    }
    progress();
  });

  return {
    go() { if (!live) { live = true; input.takeFrame?.(); say('start', true); } },
    update() {},
    botInput() {
      if (!live || done) return {};
      if (jam > 0) return frame & 1 ? { action: true } : {};   // thump the machine
      const lead = k.dt() * 2.2;                              // inject() reaches the game ~2 frames late: press early by that
      for (const it of items) {
        if (it.s !== 'belt' || !it.obj) continue;
        const dx = posAt(it, t) - SLOT_X;
        if (dx > halfOf(it)) continue;
        if (!it.plan) {
          const good = isGood(it) || it.kind === 'crate';
          const sigma = it.kind === 'crate' ? 18 : 36 + (it.v - 240) * 0.04;   // scaled with the doubled window (was 9 / 19 + (v-300)*0.02)
          const noise = (botRng.next() + botRng.next() + botRng.next() - 1.5) * 2 * sigma;
          const slip = botRng.next() < 0.07 ? (botRng.next() < 0.5 ? -1 : 1) * (HALF.normal + 12) : 0;   // now and then it just mistimes
          it.plan = {
            press: good ? botRng.next() > 0.07 : botRng.next() < 0.14,   // sometimes skips a bottle, sometimes feeds a sock
            toss: !good && botRng.next() < 0.3,
            aim: noise + slip, done: false,
          };
        }
        const pl = it.plan;
        if (pl.done) continue;
        if (pl.press) {
          if (dx + it.v * lead >= pl.aim) { pl.done = true; return { confirm: true }; }
        } else if (pl.toss && dx > -190) { pl.done = true; return { back: true }; }
      }
      return {};
    },
    destroy() {},   // everything hangs off root (the runner destroys it)
  };
}
