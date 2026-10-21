// Only Up: Knaggerturm. Main lane = three.js (world.js), controls/camera/HUD/bot here; thumbnails = cheap Kaplay progress pictures. Physics + course: sim.js.
import { createRng } from '../../contracts.js';
import { mount3D } from '../three3d.js';
import { box, disc, label, decimal, ease, setText } from '../draw.js';
import { C, DURATION_MS, BOT_NOISE, makeCourse, newState, step, botControl, supportBelow, angDiff } from './sim.js';
import { buildWorld, makePlayer, makeOcclusion } from './world.js';
import LINES from './lines.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const px = (v) => `calc(${v} * var(--u))`;
const profileOf = (ctx, seat) => ctx.seats.find((s) => s.index === seat)?.profile ?? { name: '?', color: '#ffb400', hat: 'none' };
const fmtScore = (st, tSec, top) => (st.done
  ? { score: Math.round((1000 + (DURATION_MS / 1000 - tSec)) * 100) / 100, label: `Gipfel! ${decimal(tSec)} s` }
  : { score: Math.round(Math.min(st.best, top) * 10) / 10, label: `${Math.round(st.best)} m` });

export function mountOnlyUp(ctx) {
  return ctx.view === 'thumb' ? mountThumb(ctx) : mountMain(ctx);
}

// ------------------------------------------------------------------ thumbnail: a tower sketch with the player's blob at their height
function mountThumb(ctx) {
  const { k, root } = ctx;
  const course = makeCourse(ctx.rng);
  const top = course.top;
  const profile = profileOf(ctx, ctx.seat);
  const Y0 = 628, Y1 = 96, ypx = (h) => Y0 - (h / top) * (Y0 - Y1);
  const xAt = (h) => {   // the blob slides along the zigzag of the platforms
    const P = course.plats;
    let i = 0;
    while (i < P.length - 1 && P[i + 1].top <= h) i++;
    const a = P[i], b = P[Math.min(i + 1, P.length - 1)];
    const f = b.top > a.top ? Math.max(0, Math.min(1, (h - a.top) / (b.top - a.top))) : 0;
    return 480 + (zig(i) * (1 - f) + zig(i + 1) * f);
  };
  const zig = (i) => Math.sin(i * 1.15) * 105;

  box(k, root, 0, 0, 960, 720, '#8ed1ff');
  box(k, root, 0, 0, 960, 240, '#6fb8f5', { opacity: 0.55 });
  box(k, root, 0, 650, 960, 70, '#4a4e58');
  box(k, root, 0, 646, 960, 8, '#9b9ca3');
  for (const [x, y, r] of [[110, 150, 46], [330, 270, 36], [110, 450, 42]]) { disc(k, root, x, y, r, '#ffffff', { opacity: 0.75 }); disc(k, root, x + r * 0.7, y + 8, r * 0.75, '#ffffff', { opacity: 0.75 }); }
  const cols = ['#d98a1c', '#c4122f', '#2a4fa0', '#e9a53a', '#c26b40', '#ff7a1a', '#f1b84a'];
  course.plats.forEach((p, i) => {
    const last = i === course.plats.length - 1;
    box(k, root, 480 + zig(i), ypx(p.top), last ? 120 : 84, last ? 22 : 14, last ? '#d9dee5' : cols[i % cols.length], { anchor: 'center', radius: 5, outline: [3, '#1b2a49'] });
  });
  label(k, root, '🏁', 480 + zig(course.plats.length - 1), ypx(top) - 40, { size: 48 });
  const bigTxt = label(k, root, '0 m', 790, 340, { size: 110, color: '#ffffff', outline: [8, '#1b2a49'], width: 300 });
  const bestTxt = label(k, root, 'Bestwert 0 m', 790, 430, { size: 32, color: '#ffffff', outline: [5, '#1b2a49'], width: 300 });
  const flagTxt = label(k, root, '', 790, 520, { size: 52, color: '#ffe066', outline: [7, '#1b2a49'], opacity: 0, width: 300 });
  const av = ctx.addAvatar(profile, { size: 66, showName: false });
  let remote = { c: 0, b: 0, d: 0 }, shown = 0, lastBest = 0;
  root.onUpdate(() => {
    const dt = k.dt();
    shown += (remote.c - shown) * ease(dt, 10);
    av.pos = k.vec2(xAt(shown), ypx(shown) - 33);
    setText(bigTxt, `${Math.round(remote.c)} m`);
    setText(bestTxt, `Bestwert ${Math.round(remote.b)} m`);
    if (remote.b > lastBest + 0.5 && remote.c < remote.b - 4) av.bounce();
    lastBest = Math.max(lastBest, remote.b);
    if (remote.d === 2) { flagTxt.text = 'GIPFEL!'; flagTxt.opacity = 1; } else if (remote.d === 1) { flagTxt.text = 'Zeit um'; flagTxt.opacity = 1; }
  });
  return {
    go() {},
    update(p) { if (p && typeof p === 'object') remote = { c: p.c ?? 0, b: p.b ?? 0, d: p.d ?? 0 }; },
    botInput: () => ({}),
    destroy() {},
  };
}

// ------------------------------------------------------------------ main lane
function mountMain(ctx) {
  const { k, root, input, audio } = ctx;
  const course = makeCourse(ctx.rng);
  const st = newState(course);
  const profile = profileOf(ctx, ctx.selfSeat);
  const bot = { rng: createRng((ctx.seed ^ Math.imul(ctx.selfSeat + 1, 0x9E3779B1)) >>> 0) };
  const decorRng = createRng((ctx.seed ^ 0x5EED5EED) >>> 0);

  let t3 = null, live = false, over = false, finished = false, wall0 = 0, tSummit = 0;
  const loading = label(k, root, 'Der Knaggerturm wackelt sich auf…', 480, 360, { size: 34, outline: [5, '#14182a'] });

  // the camera sits OUTSIDE the tower, behind the blob, and follows its angle around the axis. Controls: left / right only (screen-right = clockwise round the
  // tower); the depth axis is automatic (sim.assistMove, applied inside step() for humans and bots alike)
  let camAng = Math.atan2(st.z, st.x);

  let lastKey = '', lastSay = -99, lastFall = -99, saidHalf = false, hintT = 0;
  const say = (key, gap = 3.5) => {
    const now = performance.now() / 1000;
    if (now - lastSay < gap) return;
    lastSay = now;
    audio.say(pick(LINES[key]));
  };

  function finishNow() {
    if (finished) return;
    finished = true; over = true;
    const r = fmtScore(st, tSummit || (performance.now() - wall0) / 1000, course.top);
    if (!st.done) say('late', 0);
    ctx.finish(r);
    progress(true);
  }
  function progress(force) {
    const d = st.done ? 2 : finished ? 1 : 0;
    const c = Math.round(st.y * 10) / 10, b = Math.round(st.best * 10) / 10;
    const key = `${c}|${b}|${d}`;
    if (!force && key === lastKey) return;
    lastKey = key;
    ctx.sendProgress({ c, b, d });
  }

  mount3D(ctx, { fov: 62, near: 0.2, far: 260 }).then((t) => {
    if (!ctx.alive()) { t.destroy(); return; }
    t3 = t;
    loading.destroy();
    const { THREE } = t;
    const world = buildWorld(THREE, t.scene, course, decorRng);
    const me = makePlayer(THREE, profile);
    const occl = makeOcclusion(THREE, t.camera, world.occluders);
    t.scene.add(me.group);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 18), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    t.scene.add(shadow);

    // dust puffs + summit confetti share one small pool of cheap meshes
    const bits = [];
    const puffGeo = new THREE.SphereGeometry(0.16, 8, 6), confGeo = new THREE.BoxGeometry(0.18, 0.04, 0.12);
    for (let i = 0; i < 70; i++) {
      const m = new THREE.Mesh(i < 14 ? puffGeo : confGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
      m.visible = false;
      t.scene.add(m);
      bits.push({ m, life: 0, max: 1, v: new THREE.Vector3(), confetti: i >= 14 });
    }
    const spawn = (confetti, x, y, z, vx, vy, vz, life, color) => {
      const b = bits.find((q) => q.confetti === confetti && q.life <= 0);
      if (!b) return;
      b.life = b.max = life; b.v.set(vx, vy, vz);
      b.m.position.set(x, y, z); b.m.visible = true; b.m.scale.setScalar(1);
      b.m.material.color.set(color); b.m.material.opacity = 1;
    };
    const dust = (x, y, z, n = 5) => { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28; spawn(false, x, y + 0.08, z, Math.cos(a) * 1.6, 0.6 + Math.random() * 0.8, Math.sin(a) * 1.6, 0.45, 0xffffff); } };

    // ---- HUD (DOM overlay, logical lane px)
    const heightEl = t.label('0 m', { x: 26, y: 14, size: 58 });
    const bestEl = t.label('Bestwert 0 m', { x: 28, y: 80, size: 24 });
    const timeEl = t.label('', { x: 480, y: 18, size: 44, align: 'center' });
    const banner = t.label('', { x: 480, y: 250, size: 72, align: 'center', color: '#ffe066' });
    banner.style.opacity = '0';
    const hintEl = t.label('A / D (← →) / Stick: um den Turm laufen  ·  Leertaste / A: Springen', { x: 480, y: 676, size: 22, align: 'center' });
    const bar = document.createElement('div');
    bar.style.cssText = `position:absolute;left:${px(918)};top:${px(110)};width:${px(14)};height:${px(520)};background:rgba(20,24,42,.55);border:${px(3)} solid #fff;border-radius:${px(9)}`;
    const bestTick = document.createElement('div');
    bestTick.style.cssText = `position:absolute;left:${px(-8)};width:${px(30)};height:${px(4)};background:#ffe066;bottom:0`;
    const dot = document.createElement('div');
    dot.style.cssText = `position:absolute;left:${px(-8)};width:${px(30)};height:${px(30)};margin-bottom:${px(-15)};border-radius:50%;background:${profile.color};border:${px(4)} solid #14182a;bottom:0`;
    bar.append(bestTick, dot);
    const flag = t.label('🏁', { x: 925, y: 62, size: 40, align: 'center' });
    t.overlay.append(bar);
    let bannerT = 0;
    const flash = (text, color, secs = 1.5) => { banner.textContent = text; banner.style.color = color; banner.style.opacity = '1'; bannerT = secs; };
    void flag;

    // ---- per-frame
    let time = 0, acc = 0, jumpLatch = false, viewY = st.y, shake = 0, amt = 0, faceA = Math.PI, shownH = -1, shownB = -1, shownT = '';
    const camera = t.camera;
    if (ctx.isBot) globalThis.__onlyup = { THREE, scene: t.scene, camera, st, course, player: me.group, world, occl };   // e2e / debugging only
    t.onFrame((dt) => {
      time += dt;
      // controls: left / right (A/D, arrows, stick X) + jump
      let axis = 0;
      if (live && !over) {
        const m = input.state.move;
        axis = Math.abs(m.x) > 0.12 ? Math.max(-1, Math.min(1, m.x)) : 0;
        if (input.pressed('jump')) jumpLatch = true;
      } else jumpLatch = false;

      if (live && !over) {
        acc += dt;
        let guard = 0;
        while (acc >= C.DT && guard++ < 30) {
          acc -= C.DT;
          const evs = step(st, course, { axis, jump: jumpLatch }, C.DT);
          jumpLatch = false;
          const bestBefore = st.best;
          for (const e of evs) {
            const type = e.type ?? e;
            if (type === 'jump') { audio.sfx('jump', { rate: 0.9 + Math.random() * 0.25, volume: 0.7 }); amt = -0.9; dust(st.x, st.y, st.z, 2); }
            else if (type === 'land' || type === 'splat') {
              amt = type === 'splat' ? 1.6 : 0.8;
              dust(st.x, st.y, st.z, type === 'splat' ? 9 : 4);
              if (st.on >= 0) world.bump(st.on, type === 'splat' ? 0.4 : 0.22);
              if (type === 'splat') {
                audio.sfx('splat'); audio.sfx('boing', { rate: 0.8 });
                shake = 0.5;
                flash(`Autsch! -${Math.round(e.drop)} m`, '#ff8a7a', 1.4);
                const now = performance.now() / 1000;
                if (now - lastFall > 6) { lastFall = now; say('fall', 2); }
              } else if (st.best > bestBefore) audio.sfx('step', { rate: 0.8 + (st.best / course.top) * 0.9, volume: 0.6 });
              else audio.sfx('bump', { volume: 0.3, rate: 1.2 });
              if (!saidHalf && st.best >= course.top * 0.5) { saidHalf = true; say('half'); }
            } else if (type === 'summit') {
              tSummit = (performance.now() - wall0) / 1000;
              audio.sfx('fanfare'); audio.sfx('win');
              flash('GIPFEL!', '#ffe066', 99);
              say('top', 0);
              for (let i = 0; i < 56; i++) spawn(true, st.x + (Math.random() - 0.5) * 2, st.y + 1.5, st.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 6, 5 + Math.random() * 5, (Math.random() - 0.5) * 6, 2.8, [0xff3d5a, 0xffd43b, 0x4dd0e1, 0x8ce99a, 0xffffff][i % 5]);
              finishNow();
              break;
            }
          }
          if (st.done) break;
        }
        if (performance.now() - wall0 >= DURATION_MS - 350) { flash('Zeit um!', '#ffffff', 99); finishNow(); }
      }

      // world + camera follow (basis for the controls is the camera's own, set before the next input read)
      world.update(dt, time);
      const horiz = Math.hypot(st.x, st.z);
      if (horiz > 1.8) camAng += angDiff(Math.atan2(st.z, st.x), camAng) * ease(dt, 3.2);
      if (st.done) camAng += dt * 0.5;
      viewY += (st.y - viewY) * ease(dt, st.vy < -8 ? 7 : 4.5);

      // blob
      const spd = Math.hypot(st.vx, st.vz);
      me.group.position.set(st.x, st.y + (st.done ? Math.abs(Math.sin(time * 7)) * 0.6 : 0), st.z);
      if (spd > 0.4 || st.done) {
        const target = st.done ? faceA + dt * 7 : Math.atan2(st.vx, st.vz);
        faceA += st.done ? dt * 7 : angDiff(target, faceA) * ease(dt, 16);
      }
      me.body.rotation.y = faceA;
      amt *= Math.exp(-dt * 11);
      const air = st.grounded ? 0 : Math.max(-0.18, Math.min(0.22, st.vy * 0.018));
      const sy = 1 - amt * 0.32 + air, sx = 1 + amt * 0.22 - air * 0.5;
      me.squash(sx, sy);
      me.body.position.y = st.grounded && spd > 0.8 ? Math.abs(Math.sin(time * 17)) * 0.08 : 0;
      me.body.rotation.z = st.grounded ? Math.sin(time * 17) * 0.05 * Math.min(1, spd / 4) : 0;
      const floor = supportBelow(course, st.x, st.z, st.y);
      shadow.position.set(st.x, floor + 0.04, st.z);
      shadow.scale.setScalar(Math.max(0.35, 1 - (st.y - floor) * 0.12));
      shadow.material.opacity = Math.max(0.12, 0.42 - (st.y - floor) * 0.05);

      for (const b of bits) {
        if (b.life <= 0) continue;
        b.life -= dt;
        if (b.life <= 0) { b.m.visible = false; continue; }
        const f = b.life / b.max;
        if (b.confetti) { b.v.y -= 9 * dt; b.m.rotation.x += dt * 9; b.m.rotation.z += dt * 7; } else b.m.scale.setScalar(1 + (1 - f) * 2.2);
        b.m.position.addScaledVector(b.v, dt);
        b.m.material.opacity = b.confetti ? Math.min(1, f * 2) : f * 0.8;
      }

      shake = Math.max(0, shake - dt);
      const D = 9.6, sh = shake * 0.35;
      camera.position.set(st.x + Math.cos(camAng) * D + (Math.random() - 0.5) * sh, viewY + 4.9 + (Math.random() - 0.5) * sh, st.z + Math.sin(camAng) * D);
      camera.lookAt(st.x - Math.cos(camAng) * 2.2, viewY + 2.7, st.z - Math.sin(camAng) * 2.2);
      occl.update(dt, me.group.position);   // fade whatever stands between the camera and the blob

      // HUD
      const h = Math.max(0, Math.round(st.y)), b = Math.round(st.best);
      if (h !== shownH) { shownH = h; heightEl.textContent = `${h} m`; }
      if (b !== shownB) { shownB = b; bestEl.textContent = `Bestwert ${b} m`; bestTick.style.bottom = `${Math.min(100, (st.best / course.top) * 100)}%`; }
      dot.style.bottom = `${Math.min(100, Math.max(0, (st.y / course.top) * 100))}%`;
      const left = live ? Math.max(0, Math.ceil((DURATION_MS - (performance.now() - wall0)) / 1000)) : Math.ceil(DURATION_MS / 1000);
      const tt = over ? '' : String(left);
      if (tt !== shownT) { shownT = tt; timeEl.textContent = tt; timeEl.style.color = left <= 10 ? '#ff8a7a' : '#ffffff'; }
      if (bannerT > 0 && bannerT < 90) { bannerT -= dt; banner.style.opacity = String(Math.min(1, bannerT * 2)); }
      if (live) { hintT += dt; if (hintT > 8) hintEl.style.opacity = String(Math.max(0, 1 - (hintT - 8))); }
      progress(false);
    });
  }).catch((e) => {
    if (!ctx.alive()) return;
    console.warn('onlyup: 3D unavailable', e);
    loading.text = '3D geht hier nicht. 🙈';
    finished = true;
    ctx.finish({ score: 0, label: '0 m' });
  });

  return {
    go() { live = true; wall0 = performance.now(); input.takeFrame?.(); say('start', 0); },
    update() {},
    botInput() {
      if (!t3 || !live || over) return {};
      const c = botControl(st, course, bot, BOT_NOISE, k.dt());
      return { move: { x: c.axis, y: 0 }, jump: c.jump };
    },
    destroy() { t3?.destroy(); },
  };
}
