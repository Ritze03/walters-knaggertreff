// Flappy Taube: Kaplay client (main lane). Rules/physics: sim.js (fixed 60 Hz step, same course for everybody), bot: bot.js, thumbnail: thumb.js.
import { createRng } from '../../contracts.js';
import { box, label, setText, addHint } from '../draw.js';
import { makeCourse, createRun, step, score, labelOf, STEP, GROUND, PX, W, KINDS, DURATION_MS, speedAt } from './sim.js';
import { createBot } from './bot.js';
import { addPigeon, addGull, buildObstacle, addSky, addSkyline, addCloud } from './art.js';
import { mountThumb } from './thumb.js';
import lines from './lines.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const CRASH_TEXT = {
  plattenbau: 'Plattenbau gewinnt. Wie immer.',
  fernsehturm: 'Fernsehturm: 1, Taube: 0',
  laterne: 'Die Laterne hatte Vorfahrt.',
  kran: 'Die Abrissbirne sagt Hallo.',
  spaeti: 'Der Späti hatte schon zu.',
  ground: 'Der Boden ist Lava. Und Pfand.',
};

export function mountTaube(ctx) {
  if (ctx.view === 'thumb') return mountThumb(ctx);
  const { k, root, input, audio } = ctx;
  const profile = ctx.seats.find((s) => s.index === ctx.seat)?.profile ?? { name: '?', color: '#ffb400', hat: 'none' };
  const course = makeCourse(ctx.rng);
  const st = createRun(course);
  const bot = createBot(createRng((ctx.seed ^ Math.imul(ctx.selfSeat + 1, 0x9E3779B1)) >>> 0));

  // ---- scene ----
  const world = root.add([k.pos(0, 0)]);   // shaken on a crash
  addSky(k, world);
  const clouds = [addCloud(k, world, 100, 120, 1), addCloud(k, world, 520, 70, 0.8), addCloud(k, world, 860, 190, 1.2)];
  const far = addSkyline(k, world, 1200, 11, '#9ec4de', 120, 250, true);
  const near = addSkyline(k, world, 1200, 23, '#84acc9', 70, 170, false);
  const obsLayer = world.add([k.pos(0, 0)]);
  const crumbLayer = world.add([k.pos(0, 0)]);
  // ground: pavement with moving joints
  box(k, world, 0, GROUND, W, 80, '#5a5f66');
  box(k, world, 0, GROUND, W, 12, '#8b9097');
  const joints = Array.from({ length: 10 }, (_, i) => box(k, world, i * 120, GROUND + 40, 60, 6, '#474c52'));
  const pig = addPigeon(k, world, profile.color);
  const tag = label(k, world, profile.name, PX, 0, { size: 20, color: profile.color, outline: [5, '#101010'] });
  const fx = world.add([k.pos(0, 0)]);
  const gull = addGull(k, world);
  gull.obj.pos = k.vec2(-300, 150);

  // ---- hud ----
  const scoreTxt = label(k, root, '0', 480, 62, { size: 100, outline: [8, '#1b2a49'] });
  scoreTxt.use(k.scale(1));
  label(k, root, 'Lücken', 480, 128, { size: 28, outline: [5, '#1b2a49'] });
  label(k, root, '🍞', 804, 52, { size: 46 });
  const crumbTxt = label(k, root, '0', 862, 54, { size: 52, anchor: 'left', outline: [6, '#1b2a49'] });
  const timeTxt = label(k, root, '30', 92, 54, { size: 52, outline: [6, '#1b2a49'] });
  label(k, root, 'Sek.', 92, 94, { size: 20, outline: [4, '#1b2a49'] });
  const av = ctx.addAvatar(profile, { size: 64, showName: true });
  av.pos = k.vec2(100, 672);
  const hint = addHint(k, root, '{key:Leertaste} / {key:Enter} / {A} Flattern', 540, 680, { size: 22, outline: [4, '#1b2a49'] });
  const dim = box(k, root, 0, 0, W, 720, '#101018', { opacity: 0 });
  const deadTitle = label(k, root, 'PLATSCH!', 480, 270, { size: 120, color: '#ff5a4a', outline: [10, '#101010'], angle: -5, opacity: 0 });
  deadTitle.use(k.scale(1));
  const deadSub = label(k, root, '', 480, 372, { size: 36, outline: [6, '#101010'], opacity: 0 });
  const deadNote = label(k, root, 'Jetzt wird zugeschaut …', 480, 430, { size: 26, color: '#dddddd', outline: [5, '#101010'], opacity: 0 });
  const flash = box(k, root, 0, 0, W, 720, '#ff3b30', { opacity: 0 });

  // ---- state ----
  let live = false, finished = false, acc = 0, pendingFlap = false, shake = 0, deadAge = 0, lastSay = -99, clock = 0, wob = 0;
  let sendT = 0, lastKey = '', gullT = 7, gullOn = false, gullSaid = false, lastMilestone = 0, crumbSaid = false;
  const builtObs = new Map(), builtCrumbs = new Map();
  const parts = [];   // particles: { o, vx, vy, g, life, max, rot }

  const say = (key, force = false) => {
    if (!force && clock - lastSay < 3.2) return;
    lastSay = clock;
    audio.say(pick(lines[key]));
  };
  function puff(x, y, n, colors, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random());
      const o = box(k, fx, x, y, 14, 6, colors[i % colors.length], { anchor: 'center', angle: Math.random() * 360 });
      parts.push({ o, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, g: 380, life: 0, max: 0.9 + Math.random() * 0.7, rot: (Math.random() - 0.5) * 600 });
    }
  }
  function pop(text, x, y, color) {
    const o = label(k, fx, text, x, y, { size: 36, color, outline: [5, '#101010'] });
    parts.push({ o, x, y, vx: 0, vy: -90, g: 0, life: 0, max: 0.8, rot: 0 });
  }

  function finishNow() {
    if (finished) return;
    finished = true;
    ctx.finish({ score: score(st), label: labelOf(st) });
  }

  function onEvents(ev) {
    for (const e of ev) {
      if (e === 'gap') {
        audio.sfx('tick', { volume: 0.5, rate: 1 + Math.min(0.5, st.gaps * 0.02) });
        scoreTxt.scale = k.vec2(1.35);
        if (st.gaps - lastMilestone >= 6) { lastMilestone = st.gaps; say('milestone'); }
      } else if (e === 'crumb') {
        audio.sfx('coinGain', { volume: 0.6 });
        pop('+1', PX + 30, st.y - 30, '#ffd43b');
        if (!crumbSaid && st.crumbs >= 2) { crumbSaid = true; say('crumb'); }
      } else if (e === 'crash') {
        audio.sfx('splat'); audio.sfx('bump', { volume: 0.7 });
        puff(PX, st.y, 22, ['#ffffff', '#dfe6ec', '#9aa7b4'], 340);
        shake = 0.5; flash.opacity = 0.55; av.bounce?.();
        deadSub.text = CRASH_TEXT[st.hit >= 0 ? KINDS[st.hit].id : 'ground'];
        say('crash', true);
        finishNow();
      } else if (e === 'end') {
        audio.sfx('win', { volume: 0.7 });
        deadTitle.text = 'GESCHAFFT!'; deadTitle.color = k.rgb('#ffd43b');
        deadSub.text = 'Die ganze Strecke überlebt. Aura +1000.';
        deadNote.text = 'Jetzt wird zugeschaut …';
        deadAge = 0;
        say('end', true);
        finishNow();
      }
    }
  }

  function syncObjects() {
    const sx = (wx) => wx - st.dist;
    for (const o of course.obs) {
      const x = sx(o.x);
      if (x > W + 200) break;
      if (x < -200) { const c = builtObs.get(o.i); if (c) { c.destroy(); builtObs.delete(o.i); } continue; }
      let c = builtObs.get(o.i);
      if (!c) { c = buildObstacle(k, obsLayer, o); builtObs.set(o.i, c); }
      c.pos = k.vec2(x, 0);
    }
    course.crumbs.forEach((cr, i) => {
      const x = sx(cr.x);
      let l = builtCrumbs.get(i);
      if (x > W + 100 || x < -100 || st.got.has(i)) { if (l) { l.destroy(); builtCrumbs.delete(i); } return; }
      if (!l) { l = label(k, crumbLayer, '🍞', 0, 0, { size: 44 }); builtCrumbs.set(i, l); }
      l.pos = k.vec2(x, cr.y + Math.sin(clock * 4 + i) * 4);
    });
  }

  root.onUpdate(() => {
    const dt = Math.min(0.1, k.dt());
    clock += dt;
    const flapKey = input.pressed('jump') || input.pressed('confirm') || input.pressed('action');
    let flapped = false;
    if (live && !st.dead && !st.done) {
      if (flapKey) pendingFlap = true;
      acc += dt;
      while (acc >= STEP) {
        acc -= STEP;
        if (pendingFlap) { flapped = true; audio.sfx('jump', { volume: 0.35, rate: 1.2 + Math.random() * 0.4 }); }
        const ev = step(st, pendingFlap, STEP);
        pendingFlap = false;
        if (ev.length) onEvents(ev);
        if (st.dead || st.done) break;
      }
    } else if ((st.dead || st.done) && st.y < GROUND - 15) {   // the corpse keeps falling
      acc += dt;
      while (acc >= STEP) { acc -= STEP; step(st, false, STEP); }
    }
    if (flapped) {
      pig.flap();
      if (Math.random() < 0.4) puff(PX - 24, st.y + 6, 1, ['#ffffff', '#dfe6ec'], 60);
    }
    // pigeon
    wob = live ? 0 : Math.sin(clock * 5) * 10;
    pig.obj.pos = k.vec2(PX, st.y + wob);
    pig.setPose(st.vy, dt, st.dead);
    tag.pos = k.vec2(PX, st.y + wob - 54);
    tag.opacity = st.dead ? 0 : 1;
    // world scroll
    const d = st.dist;
    far.pos = k.vec2(-((d * 0.25) % 1200), 0);
    near.pos = k.vec2(-((d * 0.5) % 1200), 0);
    clouds.forEach((c, i) => { c.pos = k.vec2(((c.pos.x - (12 + i * 5) * dt * (live && !st.dead ? 1 : 0.3)) + 220) % (W + 440) - 220, c.pos.y); });
    joints.forEach((j, i) => { j.pos = k.vec2((((i * 120 - d) % 1200) + 1200) % 1200 - 120, j.pos.y); });
    syncObjects();
    // seagull (cosmetic rival, never steals anything but the show)
    gullT -= dt;
    if (!gullOn && gullT <= 0 && live && !st.dead && !st.done) { gullOn = true; gull.obj.pos = k.vec2(W + 80, 70 + Math.random() * 200); if (!gullSaid) { gullSaid = true; say('gull', true); } else if (Math.random() < 0.4) say('gull'); }
    if (gullOn) {
      gull.obj.pos = k.vec2(gull.obj.pos.x - 430 * dt, gull.obj.pos.y + Math.sin(clock * 3) * 0.6);
      gull.setWing(clock * 14);
      if (gull.obj.pos.x < -120) { gullOn = false; gullT = 8 + Math.random() * 6; }
    }
    // particles
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.o.pos = k.vec2(p.x, p.y); p.o.opacity = Math.max(0, 1 - p.life / p.max);
      if (p.rot) p.o.angle += p.rot * dt;
      if (p.life >= p.max) { p.o.destroy(); parts.splice(i, 1); }
    }
    // hud
    setText(scoreTxt, String(st.gaps));
    scoreTxt.scale = k.vec2(1 + (scoreTxt.scale.x - 1) * Math.exp(-dt * 12));
    setText(crumbTxt, String(st.crumbs));
    setText(timeTxt, String(Math.max(0, Math.ceil(DURATION_MS / 1000 - st.t))));
    hint.setOpacity?.(live && st.t < 5 && !st.dead ? 1 : live ? 0 : 1);
    shake = Math.max(0, shake - dt);
    world.pos = shake > 0 ? k.vec2((Math.random() - 0.5) * 30 * shake, (Math.random() - 0.5) * 24 * shake) : k.vec2(0, 0);
    flash.opacity = Math.max(0, flash.opacity - dt * 1.4);
    if (st.dead || st.done) {
      deadAge += dt;
      const a = Math.min(1, deadAge * 2.5);
      dim.opacity = 0.35 * a;
      deadTitle.opacity = a; deadSub.opacity = a; deadNote.opacity = Math.min(1, Math.max(0, deadAge - 0.6) * 2);
      deadTitle.scale = k.vec2(1 + (1 - a) * 1.2);
      if (st.done && !st.dead) deadTitle.text = 'GESCHAFFT!';
    }
    // progress for the thumbnails of the others (changes only; the runner throttles to 10 Hz)
    sendT -= dt;
    const key = `${st.gaps}|${st.crumbs}|${st.dead ? 1 : st.done ? 2 : 0}`;
    if (sendT <= 0 || key !== lastKey) {
      sendT = 0.09; lastKey = key;
      ctx.sendProgress({ x: Math.round(st.dist), y: Math.round(st.y), g: st.gaps, c: st.crumbs, d: st.dead ? 1 : st.done ? 2 : 0, v: Math.round(speedAt(st.t)) });
    }
  });

  return {
    go() { if (!live) { live = true; st.vy = -250; input.takeFrame?.(); say('start', true); } },
    update() {},
    botInput() {
      if (!live || st.dead || st.done) return {};
      return bot(st, k.dt()) ? { jump: true } : {};
    },
    destroy() {},   // everything hangs off root (the runner destroys it)
  };
}
