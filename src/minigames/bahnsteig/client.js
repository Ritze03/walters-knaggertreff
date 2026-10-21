// Bahnsteig-Chaos: client. Draws the latest host snapshots (interpolated) in three.js (loaded lazily through mount3D, never imported here); the rules live in sim.js.
import { createRng } from '../../contracts.js';
import { mount3D } from '../three3d.js';
import { label, setText, ease } from '../draw.js';
import { C, GW, GH, T, HALF_W, HALF_H, TRACK_Z, DURATION_MS, tileCenter, botFrame } from './sim.js';
import lines from './lines.js';

const BED_Y = C.FLOOR_Y;
const TILE_H = 0.6;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fmtSec = (ms) => (ms / 1000).toFixed(1).replace('.', ',');

export function mountBahnsteig(ctx) {
  const { k, root, audio } = ctx;
  const self = ctx.selfSeat;
  const isPlayer = ctx.seats.some((s) => s.index === self);
  const botRng = createRng((ctx.seed ^ Math.imul(self + 1, 0x85EBCA6B)) >>> 0);

  let snap = null, snapAt = 0, time = 0, live = false, view = null;

  const inst = {
    go() { live = true; view?.onGo(); },
    update(s) {
      if (!s || !Array.isArray(s.ps)) return;
      snap = s; snapAt = time;
      view?.onSnap(s);
    },
    botInput() {
      if (!snap || !isPlayer) return {};
      const f = botFrame(snap, self, botRng);
      return { move: f.move, action: f.action };
    },
    destroy() { view?.t3.destroy(); },
  };

  mount3D(ctx, { fov: 40, near: 1, far: 220, background: 0x9fd0ee })
    .then((t3) => {
      if (t3.destroyed) return;
      view = buildView(t3);
      if (snap) view.onSnap(snap);
      if (live) view.onGo();
    })
    .catch((e) => {
      console.warn('[bahnsteig] 3D unavailable', e);
      root.add([k.pos(0, 0), k.rect(ctx.logical.w, ctx.logical.h), k.color(k.rgb('#14307a'))]);
      label(k, root, 'Bahnsteig-Chaos', ctx.logical.w / 2, ctx.logical.h / 2 - 30, { size: 56, outline: [6, '#1b2a49'] });
      const sub = label(k, root, 'Kein WebGL: du fährst im Hintergrund mit.', ctx.logical.w / 2, ctx.logical.h / 2 + 30, { size: 28 });
      const prev = inst.update;
      inst.update = (s) => { prev(s); if (s?.ps) setText(sub, `Noch ${s.ps.filter((p) => p.out === null).length} auf dem Bahnsteig`); };
    });

  return inst;

  // ------------------------------------------------------------------------------------------------------------------------------------------
  function buildView(t3) {
    const THREE = t3.THREE, { scene, camera } = t3;
    const W = ctx.logical.w, H = ctx.logical.h;
    scene.fog = new THREE.Fog(0x9fd0ee, 60, 150);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f9c, 1.55));
    const sun = new THREE.DirectionalLight(0xfff2d6, 1.9);
    sun.position.set(-9, 18, 10);
    scene.add(sun);
    const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
    const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, ...extra });
    const mesh = (geo, material, parent = scene) => { const m = new THREE.Mesh(geo, material); parent.add(m); return m; };
    const BOX = new THREE.BoxGeometry(1, 1, 1);
    const box = (sx, sy, sz, material, x, y, z, parent = scene) => { const m = mesh(BOX, material, parent); m.scale.set(sx, sy, sz); m.position.set(x, y, z); return m; };

    // ---- track bed, tracks, sleepers, scenery ----
    const bed = mesh(new THREE.PlaneGeometry(260, 200), mat(0x77705f));
    bed.rotation.x = -Math.PI / 2; bed.position.y = BED_Y;
    const railMat = mat(0x9aa0a8), sleeperMat = mat(0x5b4631), pitMat = mat(0x4a463c);
    for (const side of [-1, 1]) {
      const z = side * TRACK_Z;
      box(120, 0.12, 2.6, pitMat, 0, BED_Y + 0.06, z);
      for (let x = -58; x <= 58; x += 0.95) box(0.3, 0.14, 2.1, sleeperMat, x, BED_Y + 0.17, z);
      for (const o of [-0.72, 0.72]) box(120, 0.2, 0.14, railMat, 0, BED_Y + 0.34, z + o);
    }
    for (let x = -HALF_W; x <= HALF_W; x += 0.95) box(0.3, 0.12, GH * T + 1, sleeperMat, x, BED_Y + 0.11, 0);   // sleepers show through the holes
    // station sign "GLEIS 3" on a pole behind the platform, a few lamp posts and low-poly houses on the horizon
    const signCv = document.createElement('canvas');
    signCv.width = 512; signCv.height = 160;
    const sg = signCv.getContext('2d');
    sg.fillStyle = '#14307a'; sg.fillRect(0, 0, 512, 160);
    sg.strokeStyle = '#ffffff'; sg.lineWidth = 8; sg.strokeRect(8, 8, 496, 144);
    sg.fillStyle = '#ffffff'; sg.font = 'bold 84px system-ui, sans-serif'; sg.textAlign = 'center'; sg.textBaseline = 'middle';
    sg.fillText('Gleis 3', 256, 62);
    sg.font = 'bold 34px system-ui, sans-serif'; sg.fillStyle = '#ffd23f';
    sg.fillText('Bahnsteig fällt aus', 256, 124);
    const signTex = new THREE.CanvasTexture(signCv);
    signTex.colorSpace = THREE.SRGBColorSpace;
    const sign = mesh(new THREE.PlaneGeometry(9, 2.8), basic(0xffffff, { map: signTex }));
    sign.position.set(-5, 4.6, -HALF_H - 3.6 - 6); sign.rotation.x = -0.08;
    box(0.25, 5, 0.25, mat(0x555a66), -5, 2.2, -HALF_H - 9.7);
    for (const x of [-14, 14]) {
      box(0.22, 5, 0.22, mat(0x40454f), x, 2.3, -HALF_H - 0.8);
      const lamp = mesh(new THREE.SphereGeometry(0.4, 10, 8), basic(0xfff3b0)); lamp.position.set(x, 4.9, -HALF_H - 0.8);
    }
    const rngDeco = createRng(ctx.seed >>> 0);
    for (let i = 0; i < 18; i++) {
      const w = 5 + rngDeco.next() * 7, h = 4 + rngDeco.next() * 12;
      const bx = -62 + i * 7.2 + rngDeco.next() * 3, bz = -48 - rngDeco.next() * 14;
      box(w, h, 5 + rngDeco.next() * 4, mat(rngDeco.pick([0xc9a98a, 0xb88f7a, 0xa9b7c4, 0xd6ccb4, 0xb5a3b8])), bx, h / 2 + BED_Y, bz);
    }

    // ---- the platform: one box per tile ----
    const concreteA = mat(0xdad7cf), concreteB = mat(0xc8c5bb), warnRed = mat(0xff4b3e, { emissive: 0x551008 }), warnYel = mat(0xffd23f, { emissive: 0x4a3a00 });
    const lineMat = mat(0xffd23f, { emissive: 0x6a5200 });
    const tileGeo = new THREE.BoxGeometry(T - 0.07, TILE_H, T - 0.07);
    const tiles = [];
    for (let i = 0; i < GW * GH; i++) {
      const c = tileCenter(i), col = i % GW, row = Math.floor(i / GW);
      const base = (col + row) % 2 ? concreteB : concreteA;
      const m = mesh(tileGeo, base);
      m.position.set(c.x, -TILE_H / 2, c.z);
      // yellow safety line on every outer side of an edge tile
      const stripe = (sx, sz, x, z) => box(sx, 0.03, sz, lineMat, x, TILE_H / 2 + 0.012, z, m);
      if (row === GH - 1) stripe(T - 0.07, 0.2, 0, (T - 0.07) / 2 - 0.3);
      if (row === 0) stripe(T - 0.07, 0.2, 0, -(T - 0.07) / 2 + 0.3);
      if (col === 0) stripe(0.2, T - 0.07, -(T - 0.07) / 2 + 0.3, 0);
      if (col === GW - 1) stripe(0.2, T - 0.07, (T - 0.07) / 2 - 0.3, 0);
      tiles.push({ m, base, y: -TILE_H / 2, fall: null, gone: false });
    }
    // ICE warning band along the edge next to its track
    const band = box(GW * T, 0.06, 1.1, basic(0xff3b3b, { transparent: true, opacity: 0.0 }), 0, 0.06, 0);
    band.visible = false;
    const warnLamps = [-1, 1].map((side) => {
      const l = mesh(new THREE.SphereGeometry(0.5, 10, 8), basic(0xff3b3b)); l.position.set(HALF_W + 3, BED_Y + 2.4, side * (TRACK_Z - 2));
      box(0.2, 2.6, 0.2, mat(0x40454f), HALF_W + 3, BED_Y + 1.2, side * (TRACK_Z - 2));
      return l;
    });

    // ---- the ICE ----
    const ice = new THREE.Group();
    scene.add(ice);
    const iceWhite = mat(0xf4f6f8), iceRed = mat(0xd62828), iceGlass = mat(0x1d2f55), iceDark = mat(0x3a3f4b);
    const CAR = 7.2, CARS = 5;
    for (let c = 0; c < CARS; c++) {
      const x0 = -c * (CAR + 0.25) + (CARS - 1) * (CAR + 0.25) / 2;
      box(CAR, 2.3, 2.5, iceWhite, x0, 0.0, 0, ice);
      box(CAR + 0.02, 0.38, 2.52, iceRed, x0, -0.55, 0, ice);
      box(CAR - 1.0, 0.62, 2.54, iceGlass, x0, 0.55, 0, ice);
      box(2.2, 0.5, 2.0, iceDark, x0 - 2.2, -1.25, 0, ice);
      box(2.2, 0.5, 2.0, iceDark, x0 + 2.2, -1.25, 0, ice);
    }
    const nose = mesh(new THREE.SphereGeometry(1.25, 14, 10), iceWhite, ice);
    nose.scale.set(2.2, 0.95, 1.0); nose.position.set((CARS - 1) * (CAR + 0.25) / 2 + CAR / 2 - 0.2, -0.1, 0);
    box(0.2, 0.5, 1.8, mat(0xfff3b0, { emissive: 0xffe066 }), (CARS - 1) * (CAR + 0.25) / 2 + CAR / 2 + 1.9, -0.1, 0, ice);
    ice.position.y = BED_Y + 1.55;
    ice.visible = false;
    // suction streaks
    const streakMat = basic(0xffffff, { transparent: true, opacity: 0.6 });
    const streaks = Array.from({ length: 22 }, (_, i) => {
      const m = box(0.06, 0.04, 2.2, streakMat, 0, 0, 0);
      m.userData.seed = [((i * 7919) % 100) / 100, ((i * 104729) % 100) / 100, ((i * 1299709) % 100) / 100];
      m.visible = false;
      return m;
    });

    // ---- particles (a small pool) ----
    const pGeo = new THREE.SphereGeometry(1, 8, 6);
    const parts = Array.from({ length: 48 }, () => {
      const m = mesh(pGeo, basic(0xffffff, { transparent: true, opacity: 1 }));
      m.visible = false; m.userData = { life: 0, max: 1, v: new THREE.Vector3(), r0: 0.1, g: 0 };
      return m;
    });
    let pIdx = 0;
    const puff = (x, y, z, color, r = 0.2, life = 0.5, vel = [0, 0.5, 0], g = 0) => {
      const m = parts[pIdx++ % parts.length];
      m.visible = true; m.position.set(x, y, z); m.material.color.set(color); m.material.opacity = 0.9;
      Object.assign(m.userData, { life, max: life, r0: r, g });
      m.userData.v.set(vel[0], vel[1], vel[2]);
      m.scale.setScalar(r);
    };
    const burst = (x, y, z, color, n = 8, speed = 4) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random();
        puff(x, y, z, color, 0.14, 0.55, [Math.cos(a) * speed * (0.5 + Math.random() * 0.6), 2 + Math.random() * 2.5, Math.sin(a) * speed * (0.5 + Math.random() * 0.6)], 9);
      }
    };

    // ---- players ----
    const crew = new Map();
    const bodyGeo = new THREE.SphereGeometry(0.5, 18, 14), eyeGeo = new THREE.SphereGeometry(0.15, 10, 8), pupilGeo = new THREE.SphereGeometry(0.075, 8, 6);
    const white = mat(0xffffff), black = mat(0x14182a);
    const shadowGeo = new THREE.CircleGeometry(0.52, 18), shadowMat = basic(0x000000, { transparent: true, opacity: 0.28 });
    const arrowGeo = new THREE.ConeGeometry(0.28, 0.55, 4);
    const arrowMat = mat(0xffe066, { emissive: 0x806000 });
    function hatFor(kind, body) {
      const g = new THREE.Group();
      g.position.set(0, 0.52, 0);
      const add = (geo, color, x, y, z) => { const m = mesh(geo, mat(color), g); m.position.set(x, y, z); return m; };
      if (kind === 'cap') {
        add(new THREE.SphereGeometry(0.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xd62828, 0, 0.0, 0);
        add(new THREE.BoxGeometry(0.5, 0.05, 0.4), 0xb02020, 0, 0.02, 0.5);
      } else if (kind === 'cowboy') {
        add(new THREE.CylinderGeometry(0.3, 0.34, 0.3, 12), 0x8a5a2b, 0, 0.14, 0);
        add(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 16), 0x8a5a2b, 0, 0.0, 0);
      } else if (kind === 'crown') {
        add(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 12), 0xffc83d, 0, 0.1, 0);
        for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; add(new THREE.ConeGeometry(0.09, 0.22, 5), 0xffc83d, Math.cos(a) * 0.3, 0.32, Math.sin(a) * 0.3); }
      } else if (kind === 'tophat') {
        add(new THREE.CylinderGeometry(0.3, 0.3, 0.55, 14), 0x1d1d26, 0, 0.27, 0);
        add(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 16), 0x1d1d26, 0, 0.0, 0);
        add(new THREE.CylinderGeometry(0.31, 0.31, 0.1, 14), 0xd62828, 0, 0.08, 0);
      } else if (kind === 'hotdog') {
        const bun = add(new THREE.CapsuleGeometry(0.2, 0.62, 4, 10), 0xe3b062, 0, 0.14, 0); bun.rotation.z = Math.PI / 2;
        const wurst = add(new THREE.CapsuleGeometry(0.13, 0.8, 4, 10), 0xc0392b, 0, 0.3, 0); wurst.rotation.z = Math.PI / 2;
      } else if (kind === 'cucumber') {
        const g2 = add(new THREE.CapsuleGeometry(0.17, 0.5, 4, 10), 0x4caf50, 0.05, 0.3, 0); g2.rotation.z = 0.25;
      } else if (kind === 'propeller') {
        add(new THREE.CylinderGeometry(0.04, 0.04, 0.25, 6), 0x555a66, 0, 0.1, 0);
        const rot = new THREE.Group(); rot.position.set(0, 0.25, 0); g.add(rot);
        box(0.9, 0.04, 0.14, mat(0xe74c3c), 0, 0, 0, rot); box(0.14, 0.04, 0.9, mat(0x3b7bff), 0, 0.01, 0, rot);
        g.userData.prop = rot;
      } else return null;
      body.add(g);
      return g;
    }
    ctx.seats.forEach((seat) => {
      const color = new THREE.Color(seat.profile.color);
      const group = new THREE.Group();
      const body = new THREE.Group();
      group.add(body);
      body.position.y = 0.58;
      const blob = mesh(bodyGeo, mat(color), body); blob.scale.set(1, 1.15, 1);
      for (const sx of [-1, 1]) {
        const eye = mesh(eyeGeo, white, body); eye.position.set(sx * 0.19, 0.2, 0.4);
        const pupil = mesh(pupilGeo, black, body); pupil.position.set(sx * 0.19, 0.2, 0.52);
      }
      const hat = hatFor(seat.profile.hat, body);
      const shadow = mesh(shadowGeo, shadowMat); shadow.rotation.x = -Math.PI / 2;
      let arrow = null;
      if (seat.index === self) { arrow = mesh(arrowGeo, arrowMat); arrow.rotation.x = Math.PI; }
      group.scale.setScalar(1.15);
      scene.add(group);
      const nameEl = t3.label(seat.profile.name, { x: 0, y: 0, size: 21, color: seat.index === self ? '#ffe066' : '#ffffff', align: 'center' });
      crew.set(seat.index, { seat: seat.index, group, body, hat, shadow, arrow, nameEl, x: 0, y: 0, z: 0, seen: false, lastOut: false, landed: false, spin: 0, puffAt: 0, color: seat.profile.color });
    });

    // ---- HUD (DOM overlay, logical px) ----
    const timerEl = t3.label('', { x: W / 2, y: 14, size: 34, align: 'center' });
    const bigEl = t3.label('', { x: W / 2, y: 270, size: 84, align: 'center', color: '#ffffff' });
    bigEl.style.opacity = '0';
    const hintEl = isPlayer ? t3.label('WASD / Stick: Laufen   ·   Leertaste / E / A / X: Schubsen', { x: 20, y: H - 44, size: 20 }) : null;
    if (hintEl) hintEl.style.opacity = '0.9';
    const cdEl = isPlayer ? t3.label('', { x: W - 20, y: H - 44, size: 22, align: 'right' }) : null;
    const chipEls = new Map();
    ctx.seats.forEach((seat, i) => {
      const el = t3.label(seat.profile.name, { x: 20, y: 14 + i * 29, size: 22, color: seat.profile.color });
      chipEls.set(seat.index, el);
    });

    // ---- helpers ----
    const v3 = new THREE.Vector3();
    const proj = (x, y, z) => { v3.set(x, y, z).project(camera); return [(v3.x * 0.5 + 0.5) * W, (-v3.y * 0.5 + 0.5) * H, v3.z]; };
    const put = (el, x, y) => { el.style.left = `calc(${x.toFixed(1)} * var(--u))`; el.style.top = `calc(${y.toFixed(1)} * var(--u))`; };
    const popups = [];
    const popup = (text, x, y, z, color = '#ffffff', size = 36) => {
      const el = t3.label(text, { x: 0, y: 0, size, color, align: 'center' });
      popups.push({ el, x, y, z, age: 0 });
    };
    let shake = 0, bigAge = 9, lastEv = null, iceWas = null, lastSay = -9, lastFallSfx = -9, doneShown = false, firstSnap = true;
    const say = (text, gap = 0) => { if (time - lastSay >= gap) { lastSay = time; audio.say(text); } };
    const showBig = (text, color = '#ffffff') => { bigEl.textContent = text; bigEl.style.color = color; bigAge = 0; };

    // camera: fixed, angled overhead
    const CAM = { x: 0, y: 15.6, z: 14.0, lx: 0, ly: -0.8, lz: -0.4 };
    const placeCam = (dx = 0, dy = 0) => { camera.position.set(CAM.x + dx, CAM.y + dy, CAM.z); camera.lookAt(CAM.lx, CAM.ly, CAM.lz); };
    placeCam();

    function onGo() {
      showBig('ABFAHRT!', '#ffe066');
      audio.sfx('go', { volume: 0.5 });
      say(pick(lines.start));
    }

    function handleEvents(s) {
      const maxId = s.ev.reduce((m, e) => Math.max(m, e.i), 0);
      if (lastEv === null) { lastEv = maxId; return; }   // first snapshot (also after a remount): nothing to replay
      for (const e of s.ev) {
        if (e.i <= lastEv) continue;
        lastEv = Math.max(lastEv, e.i);
        if (!live) continue;
        const who = crew.get(e.s);
        if (e.k === 'a') {
          const arr = lines[e.p] ?? lines.rand;
          const text = arr[e.i % arr.length];
          audio.sfx('bahnDing', { volume: 0.7 });
          say(text);
          lastSay = time + 1;
        } else if (e.k === 'i') {
          const text = lines.ice[e.i % lines.ice.length];
          audio.sfx('endspurt', { volume: 0.6 });
          showBig('ACHTUNG, ICE!', '#ff8a80');
          say(text);
        } else if (e.k === 'g') {
          audio.sfx('whoosh', { volume: 1, rate: 0.45 });
          showBig('SOG!', '#cfe8ff');
          if (e.side * (crew.get(self)?.z ?? 0) > 0) shake = 0.5; else shake = 0.25;
        } else if (e.k === 'd') {
          if (who) audio.sfx('whoosh', { volume: e.s === self ? 0.5 : 0.25, rate: 1.5 });
        } else if (e.k === 's') {
          audio.sfx('bump', { rate: 0.85 + Math.random() * 0.35 });
          popup('BUMM!', e.x, 1.6, e.z, '#ffe066', 38);
          burst(e.x, 0.9, e.z, 0xffe066, 8, 4.5);
          if (e.o === self) shake = Math.max(shake, 0.4);
          if (e.s === self && Math.random() < 0.35) say(pick(lines.shove), 4);
        } else if (e.k === 'o') {
          audio.sfx('splat', { volume: e.s === self ? 1 : 0.55, rate: 0.9 + Math.random() * 0.3 });
          popup(e.by >= 0 ? 'RAUSGESCHUBST!' : 'ABGEFAHREN!', e.x, 1.8, e.z, e.by >= 0 ? '#ff9f80' : '#ffffff', 40);
          if (e.s === self) { shake = Math.max(shake, 0.5); say(pick(lines.out), 2); }
        }
      }
    }

    function onSnap(s) {
      handleEvents(s);
      if (firstSnap) {
        firstSnap = false;
        s.tw.forEach((w, i) => { if (w === -1) { tiles[i].gone = true; tiles[i].m.visible = false; } });
      }
    }

    // ---- per-frame ----
    t3.onFrame((dt) => {
      time += dt;
      const s = snap;
      const age = Math.min(0.06, time - snapAt);
      const pull = ease(dt, 18);

      if (s) {
        // tiles
        const wb = Math.max(1, s.wb);
        for (let i = 0; i < tiles.length; i++) {
          const t = tiles[i], w = s.tw[i];
          if (w === -1 && !t.gone) { t.gone = true; t.fall = { vy: 0, spin: [Math.random() - 0.5, Math.random() - 0.5] }; t.m.material = t.base; if (live && time - lastFallSfx > 0.18) { lastFallSfx = time; audio.sfx('bump', { volume: 0.25, rate: 0.5 + Math.random() * 0.2 }); } }
          if (t.fall) {
            t.fall.vy -= 26 * dt;
            t.m.position.y += t.fall.vy * dt;
            t.m.rotation.x += t.fall.spin[0] * dt * 4; t.m.rotation.z += t.fall.spin[1] * dt * 4;
            if (t.m.position.y < BED_Y - 0.3) {
              burst(t.m.position.x, BED_Y + 0.3, t.m.position.z, 0xb5ae9b, 5, 2.6);
              t.m.visible = false; t.fall = null;
            }
          } else if (w > 0) {
            const prog = 1 - w / wb;
            const f = 5 + prog * 11;
            t.m.material = Math.floor(time * f * 2) % 2 ? warnYel : warnRed;
            t.m.position.y = t.y + Math.sin(time * 45 + i) * 0.03 * (0.5 + prog);
            t.m.rotation.z = Math.sin(time * 38 + i * 1.7) * 0.035 * (0.5 + prog);
            t.m.rotation.x = Math.cos(time * 33 + i) * 0.03 * (0.5 + prog);
          } else if (!t.gone) {
            t.m.material = t.base; t.m.position.y = t.y; t.m.rotation.set(0, 0, 0);
          }
        }

        // ICE
        const ic = s.ice;
        for (const l of warnLamps) l.visible = !!ic && ic.w === 0 && Math.floor(time * 6) % 2 === 0;
        band.visible = !!ic && ic.w === 0;
        if (ic) {
          band.position.z = ic.side * (HALF_H - 0.55);
          band.material.opacity = 0.5 + 0.3 * Math.sin(time * 14);
          ice.visible = ic.w === 1;
          ice.position.x = ic.x + ic.dir * C.ICE_SPEED * age;
          ice.position.z = ic.side * TRACK_Z;
          ice.rotation.y = ic.dir > 0 ? 0 : Math.PI;
          const env = ic.w === 1 ? Math.max(0, 1 - Math.abs(ic.x) / (HALF_W + 16)) : 0;
          streakMat.opacity = 0.65 * Math.min(1, env * 2.5);
          for (const m of streaks) {
            const [a, b, c] = m.userData.seed;
            m.visible = env > 0.02;
            const zz = ((a * 18 - 9 + ic.side * (time * 16 + b * 40)) % 18 + 27) % 18 - 9;
            m.position.set(-HALF_W + 1 + c * (GW * T - 2), 0.4 + b * 2.4, zz);
          }
        } else { ice.visible = false; for (const m of streaks) m.visible = false; }

        // players
        for (const p of s.ps) {
          const e = crew.get(p.s);
          if (!e) continue;
          const out = p.out !== null;
          const tx = p.x + (p.vx + p.kx) * age, tz = p.z + (p.vz + p.kz) * age, ty = p.y + (out ? p.vy * age : 0);
          if (!e.seen || Math.hypot(tx - e.x, tz - e.z) > 4) { e.x = tx; e.y = ty; e.z = tz; e.seen = true; }
          else { e.x += (tx - e.x) * pull; e.z += (tz - e.z) * pull; e.y += (ty - e.y) * (out ? 1 : pull); }
          const sp = Math.hypot(p.vx + p.kx, p.vz + p.kz);
          e.group.position.set(e.x, e.y, e.z);
          const want = Math.atan2(p.fx, p.fz);
          let dr = want - e.group.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
          e.group.rotation.y += dr * ease(dt, 16);
          const b = e.body;
          if (out) {
            if (e.y > BED_Y + 0.02) { e.spin += dt * 7; b.rotation.x += dt * 6; b.rotation.z += dt * 3; b.scale.set(1, 1, 1); }
            else {
              if (!e.landed) { e.landed = true; burst(e.x, BED_Y + 0.3, e.z, 0xb5ae9b, 8, 3); }
              b.rotation.set(0, 0, 0); b.scale.set(1.5, 0.16, 1.5); b.position.y = 0.1;
            }
            e.shadow.visible = false;
          } else {
            const bob = Math.sin(time * 15 + p.s) * 0.07 * Math.min(1, sp / 5);
            let sy = 1 + bob, sxz = 1 - bob * 0.6, sz = sxz;
            if (p.dash > 0) { sz = 1.5; sy = 0.82; sxz = 0.9; }
            if (p.air > 0) { sy = 1.15; sxz = 0.9; sz = 0.9; }
            b.scale.set(sxz, sy, sz);
            b.position.y = 0.58 * sy;
            b.rotation.set(p.dash > 0 ? 0.45 : 0, 0, p.stun > 0 ? Math.sin(time * 30) * 0.28 : 0);
            e.shadow.visible = true;
            e.shadow.position.set(e.x, 0.02, e.z);
            e.shadow.scale.setScalar(p.air > 0 ? 0.7 : 1);
            if (p.dash > 0 && time - e.puffAt > 0.03) { e.puffAt = time; puff(e.x - p.fx * 0.4, 0.3, e.z - p.fz * 0.4, 0xffffff, 0.28, 0.4, [0, 0.4, 0]); }
            else if (sp > 4.2 && time - e.puffAt > 0.16) { e.puffAt = time; puff(e.x - p.fx * 0.3, 0.1, e.z - p.fz * 0.3, 0xd9d6cf, 0.12, 0.35, [0, 0.3, 0]); }
          }
          if (e.hat?.userData.prop) e.hat.userData.prop.rotation.y += dt * 18;
          if (e.arrow) {
            e.arrow.visible = !out;
            e.arrow.position.set(e.x, e.y + 2.15 + Math.sin(time * 6) * 0.12, e.z);
            e.arrow.rotation.y += dt * 3;
          }
          // name label follows the head
          const [lx, ly, lz] = proj(e.x, e.y + (out ? 1.1 : 1.95), e.z);
          put(e.nameEl, lx, ly - 26);
          e.nameEl.style.opacity = out ? '0.4' : '1';
          e.nameEl.style.display = lz < 1 ? '' : 'none';
        }

        // HUD
        const left = Math.max(0, Math.ceil((DURATION_MS - s.t) / 1000));
        const liveCount = s.ps.filter((p) => p.out === null).length;
        setText2(timerEl, s.done ? 'Endstation!' : `Noch ${left} s  ·  ${liveCount} auf dem Bahnsteig`);
        for (const p of s.ps) {
          const el = chipEls.get(p.s);
          if (!el) continue;
          const name = ctx.seats.find((x) => x.index === p.s)?.profile.name ?? '';
          const txt = p.out === null ? `● ${name}` : `✖ ${name}  ${fmtSec(p.out)} s`;
          setText2(el, txt);
          el.style.opacity = p.out === null ? '1' : '0.5';
          el.style.textDecoration = p.out === null ? 'none' : 'line-through';
        }
        const me = s.ps.find((p) => p.s === self);
        if (cdEl && me) {
          const ready = me.cd === 0 && me.out === null;
          setText2(cdEl, me.out !== null ? 'Du bist abgefahren' : ready ? 'Schubser bereit' : `Schubser ${(me.cd / 1000).toFixed(1).replace('.', ',')} s`);
          cdEl.style.color = ready ? '#8ce99a' : '#ffffff';
          cdEl.style.opacity = ready ? '1' : '0.6';
        }
        if (s.done && !doneShown && live) {
          doneShown = true;
          const alive = s.ps.filter((p) => p.out === null);
          showBig(alive.length === 1 ? 'LETZTER ZUG!' : 'ENDSTATION!', '#ffe066');
          if (alive.length === 1 && alive[0].s === self) say(pick(lines.win), 0);
        }
      }

      // popups, particles, banners, shake
      for (let i = popups.length - 1; i >= 0; i--) {
        const pp = popups[i];
        pp.age += dt;
        const [px, py] = proj(pp.x, pp.y + pp.age * 1.2, pp.z);
        const half = 120;
        put(pp.el, Math.max(half, Math.min(W - half, px)), py);
        pp.el.style.opacity = String(Math.max(0, 1 - Math.max(0, pp.age - 0.5) / 0.7));
        pp.el.style.transform = `translateX(-50%) scale(${1 + Math.max(0, 0.25 - pp.age) * 2})`;
        if (pp.age > 1.2) { pp.el.remove(); popups.splice(i, 1); }
      }
      for (const m of parts) {
        const u = m.userData;
        if (!m.visible) continue;
        u.life -= dt;
        if (u.life <= 0) { m.visible = false; continue; }
        u.v.y -= u.g * dt;
        m.position.addScaledVector(u.v, dt);
        m.material.opacity = Math.min(1, u.life / u.max * 1.4);
        m.scale.setScalar(u.r0 * (1 + (1 - u.life / u.max) * 0.8));
      }
      bigAge += dt;
      bigEl.style.opacity = String(bigAge < 0.15 ? bigAge / 0.15 : bigAge > 1.3 ? Math.max(0, 1 - (bigAge - 1.3) / 0.4) : 1);
      bigEl.style.transform = `translateX(-50%) scale(${1 + Math.max(0, 1 - bigAge / 0.2) * 0.6})`;
      shake = Math.max(0, shake - dt);
      placeCam(shake > 0 ? (Math.random() - 0.5) * 0.7 * shake : 0, shake > 0 ? (Math.random() - 0.5) * 0.5 * shake : 0);
    });

    return { t3, onSnap, onGo };
  }

  function setText2(el, str) { if (el.textContent !== str) el.textContent = str; }
}
