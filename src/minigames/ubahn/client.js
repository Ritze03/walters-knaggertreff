// "U-Bahn-Surfers": client. Main view = a 3D chase-cam runner (three.js via mount3D, scene in world.js), thumbnail = Kaplay 2D strip (thumb.js).
// Every client runs the same track (shared seed) with its own runner; rules and bot in sim.js / bot.js (pure).
import { createRng } from '../../contracts.js';
import { mount3D } from '../three3d.js';
import { label } from '../draw.js';
import { makeTrack, createRun, advance, score, DURATION_MS, BOTTLE_BONUS } from './sim.js';
import { createBot } from './bot.js';
import { buildWorld, isStation } from './world.js';
import { mountThumb } from './thumb.js';
import lines from './lines.js';

const SEG = 24;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function mountUbahn(ctx) {
  if (ctx.view === 'thumb') return mountThumb(ctx);
  const { k, root, input, audio } = ctx;
  const profile = ctx.seats.find((s) => s.index === ctx.seat)?.profile ?? { name: '?', color: '#ffb400', hat: 'none' };
  const track = makeTrack(ctx.rng);
  const st = createRun(track);
  const bot = createBot(createRng((ctx.seed ^ Math.imul(ctx.selfSeat + 1, 0x9E3779B1)) >>> 0));

  // Kaplay layer below the WebGL canvas: only visible while three.js loads, or when WebGL fails
  root.add([k.pos(0, 0), k.rect(960, 720), k.color(k.rgb('#151a29'))]);
  const status = label(k, root, 'Die U-Bahn fährt ein…', 480, 360, { size: 40 });

  let live = false, finished = false, failed = false, elapsed = 0, lastSay = -99, lastBottleSfx = -9, lastHorn = -9, combo = 0, announced = -1, said15 = false;
  let world = null, t3 = null, hud = null;
  let events = [];

  const say = (key, force = false) => {
    if (!force && elapsed - lastSay < 3.6) return;
    lastSay = elapsed;
    audio.say(pick(lines[key]));
  };

  mount3D(ctx, { fov: 62, far: 300, background: 0x151a29 }).then((t) => {
    t3 = t;
    world = buildWorld(t, profile, track);
    ctx.onEnd(() => world?.dispose());
    const L = ctx.logical;
    hud = {
      score: t.label('0 m', { x: 28, y: 18, size: 64 }),
      bottles: t.label('🍾 0', { x: L.w - 28, y: 22, size: 52, align: 'right' }),
      time: t.label('35', { x: L.w / 2, y: 20, size: 52, align: 'center' }),
      big: t.label('', { x: L.w / 2, y: 230, size: 84, align: 'center', color: '#ffe066' }),
      hint: t.label('← →  Spur wechseln      Leertaste / A  Springen      ↓  Rutschen', { x: L.w / 2, y: L.h - 110, size: 26, align: 'center' }),
      flash: document.createElement('div'),
    };
    hud.flash.style.cssText = 'position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at center,rgba(255,40,30,0) 40%,rgba(255,40,30,0.75) 100%)';
    t.overlay.prepend(hud.flash);
    hud.big.style.opacity = '0';
    status.opacity = 0;
    t.onFrame((dt) => {
      world.update(st, dt, events);
      events = [];
      frameHud(dt);
    });
  }).catch((e) => {
    console.warn('ubahn: no 3D', e);
    failed = true;
    status.text = 'Kein WebGL – die U-Bahn fällt heute aus.';
  });

  let bigT = 0, flashT = 0;
  function frameHud(dt) {
    if (!hud) return;
    const sc = score(st);
    const s1 = `${sc} m`;
    if (hud.score.textContent !== s1) hud.score.textContent = s1;
    const b1 = `🍾 ${st.bottles}`;
    if (hud.bottles.textContent !== b1) hud.bottles.textContent = b1;
    const left = Math.max(0, Math.ceil(DURATION_MS / 1000 - st.t));
    const t1 = String(left);
    if (hud.time.textContent !== t1) hud.time.textContent = t1;
    bigT = Math.max(0, bigT - dt);
    hud.big.style.opacity = String(Math.min(1, bigT * 2.5));
    hud.big.style.transform = `translateX(-50%) scale(${1 + (1 - Math.min(1, bigT * 1.5)) * 0.25})`;
    flashT = Math.max(0, flashT - dt);
    hud.flash.style.opacity = String(Math.min(1, flashT * 2.2));
    hud.hint.style.opacity = String(Math.max(0, Math.min(1, (7 - elapsed) / 1.5)));
  }
  const banner = (text, color = '#ffe066') => { if (!hud) return; hud.big.textContent = text; hud.big.style.color = color; bigT = 0.9; };

  function react(evs) {
    for (const e of evs) {
      if (e.k === 'jump') audio.sfx('jump', { volume: 0.5, rate: 1.1 });
      else if (e.k === 'slide') audio.sfx('whoosh', { volume: 0.4, rate: 0.8 });
      else if (e.k === 'train') {   // an oncoming train just appeared at the far end: horn (louder when it is coming for our lane)
        if (elapsed - lastHorn > 0.9) { lastHorn = elapsed; audio.sfx('go', { volume: e.lane === st.lane ? 0.4 : 0.22, rate: 0.5 + Math.random() * 0.06 }); }
      } else if (e.k === 'lane') audio.sfx('whoosh', { volume: 0.18, rate: 1.4 + Math.random() * 0.3 });
      else if (e.k === 'bottle') {
        if (elapsed - lastBottleSfx > 0.7) combo = 0;
        combo = Math.min(combo + 1, 12);
        if (elapsed - lastBottleSfx > 0.1) audio.sfx('coinGain', { volume: 0.3, rate: 0.9 + combo * 0.05 });
        lastBottleSfx = elapsed;
        if (!said15 && st.bottles >= 15) { said15 = true; say('pfand'); }
      } else if (e.k === 'hit') {
        audio.sfx('bump', { volume: 0.9 });
        audio.sfx(e.type === 'scooter' ? 'boing' : 'splat', { volume: 0.6 });
        flashT = 0.5;
        banner(e.type === 'controller' ? 'ERWISCHT!' : 'AUTSCH!', '#ff7a6b');
        say(e.type === 'controller' ? 'controller' : e.type === 'scooter' ? 'scooter' : 'crash');
      }
    }
  }

  function finishNow() {
    if (finished) return;
    finished = true;
    const sc = failed ? 0 : score(st);
    say('end', true);
    ctx.finish({ score: sc, label: `${sc} m` });
  }

  root.onUpdate(() => {
    if (!live || finished || ctx.view === 'thumb') return;
    const dt = k.dt();
    elapsed += dt;
    if (failed) { finishNow(); return; }
    if (!world) return;   // three.js still loading: the clock runs, the runner waits at the start
    const inp = {};
    if (input.pressedDir('left')) inp.dx = -1;
    if (input.pressedDir('right')) inp.dx = inp.dx ? 0 : 1;
    if (input.pressed('jump') || input.pressedDir('up')) inp.jump = true;
    if (input.pressedDir('down') || input.pressed('action')) inp.slide = true;
    const evs = advance(st, dt, inp);
    if (evs.length) { events.push(...evs); react(evs); }
    const seg = Math.floor(st.dist / SEG);
    if (seg !== announced) {
      if (isStation(seg) && !isStation(announced)) audio.sfx('bahnDing', { volume: 0.6 });
      announced = seg;
    }
    ctx.sendProgress({ d: Math.round(st.dist * 10) / 10, l: st.lane, b: st.bottles, h: st.hits, s: st.stumble > 0 ? 1 : 0, sc: score(st) });
    if (st.done || elapsed >= DURATION_MS / 1000 - 0.15) { st.done = true; frameHud(0); finishNow(); }
  });

  return {
    go() {
      live = true;
      input.takeFrame?.();
      say('start', true);
    },
    update() {},
    botInput() {
      if (!live || finished || !world) return {};
      const a = bot.act(st, k.dt(), k.dt() * 2.2 + 0.03);
      if (!a) return {};
      const out = {};
      if (a.dx) out.move = { x: a.dx, y: 0 };
      if (a.jump) out.jump = true;
      if (a.slide) out.move = { x: 0, y: 1 };
      return out;
    },
    destroy() { world?.dispose(); t3?.destroy(); },
  };
}

export { BOTTLE_BONUS };
