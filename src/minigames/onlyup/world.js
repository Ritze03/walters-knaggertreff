// three.js scene for the Knaggerturm. NEVER imports three: every function gets the THREE namespace from mount3D (t3.THREE), so the main bundle stays free of it.
// Low-poly, flat colours, no shadows (cheap), everything built from primitives.

const SKY_TOP = '#3f8fe8', SKY_MID = '#9fd0ff', SKY_LOW = '#e6f3ff';
export const FOG_COLOR = 0xdcecfb;

/** a sprite showing text (or an emoji) drawn on a canvas. opts: {w,h,font,color,stroke,crop} (crop = keep only the upper fraction, for hats) */
export function textSprite(THREE, str, { w = 256, h = 64, font = 44, color = '#ffffff', stroke = '#14182a', crop = 0, scale = 1 } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = crop ? Math.round(h * crop) : h;
  const g = cv.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `800 ${font}px system-ui, "Segoe UI", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  if (crop) {
    g.fillText(str, w / 2, h * 0.52);   // the full glyph, clipped by the canvas height: only the hat part of a face emoji remains
  } else {
    g.lineWidth = font * 0.22; g.lineJoin = 'round'; g.strokeStyle = stroke; g.strokeText(str, w / 2, h / 2);
    g.fillStyle = color; g.fillText(str, w / 2, h / 2);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  spr.scale.set((w / h) * scale, (cv.height / h) * scale, 1);
  return spr;
}

const HAT = { cap: '🧢', cowboy: '🤠', crown: '👑', tophat: '🎩', hotdog: '🌭', cucumber: '🥒', propeller: '🚁' };

/** the player's blob: a group with its origin at the FEET. Returns { group, body, setFacing(fx, fz), squash(sx, sy) } */
export function makePlayer(THREE, profile, { name = true } = {}) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const mat = new THREE.MeshLambertMaterial({ color: profile.color });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.5, 22, 16), mat);
  sphere.position.y = 0.5;
  body.add(sphere);
  const white = new THREE.MeshLambertMaterial({ color: 0xffffff }), ink = new THREE.MeshLambertMaterial({ color: 0x1e1e28 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), white);
    eye.position.set(s * 0.19, 0.64, 0.38);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), ink);
    pupil.position.set(s * 0.19, 0.64, 0.51);
    body.add(eye, pupil);
  }
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.05), ink);
  mouth.position.set(0, 0.34, 0.48);
  body.add(mouth);
  if (HAT[profile.hat]) {
    const hat = textSprite(THREE, HAT[profile.hat], { w: 128, h: 128, font: 110, crop: profile.hat === 'cowboy' ? 0.5 : 0, scale: 0.95 });
    if (profile.hat === 'cowboy') hat.scale.set(0.95, 0.475, 1);
    hat.position.set(0, profile.hat === 'cowboy' ? 1.12 : 1.18, 0);
    body.add(hat);
  }
  if (name && profile.name) {
    const tag = textSprite(THREE, profile.name, { w: 320, h: 64, font: 46, scale: 0.55 });
    tag.position.set(0, 1.75, 0);
    group.add(tag);
  }
  return {
    group, body,
    setFacing(fx, fz) { body.rotation.y = Math.atan2(fx, fz); },
    squash(sx, sy) { body.scale.set(sx, sy, sx); },
  };
}

/** a vertical sky gradient as the scene background */
function skyTexture(THREE) {
  const cv = document.createElement('canvas');
  cv.width = 4; cv.height = 256;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, SKY_TOP); grad.addColorStop(0.55, SKY_MID); grad.addColorStop(1, SKY_LOW);
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function facadeTexture(THREE) {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#b9b6ae'; g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#5d7a96';
  for (let y = 8; y < 128; y += 20) for (let x = 6; x < 64; x += 20) g.fillRect(x, y, 12, 11);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Builds the whole world into `scene`. Returns { plat: [{ group, dip, i }], update(dt, time), bump(i) }.
 * rng: a plain seeded rng for decoration only (position of clouds / blocks), not gameplay.
 */
export function buildWorld(THREE, scene, course, rng) {
  const lam = (color, o = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...o });
  const box = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; };
  const cyl = (rt, rb, h, mat, seg = 20, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y, z); return m; };

  scene.background = skyTexture(THREE);
  scene.fog = new THREE.Fog(FOG_COLOR, 50, 190);
  scene.add(new THREE.HemisphereLight(0xe2f1ff, 0x707687, 1.55));
  const sun = new THREE.DirectionalLight(0xfff0cf, 1.5);
  sun.position.set(30, 70, 25);
  scene.add(sun);

  // ---- the street (Berlin-ish): asphalt, a paved plaza around the tower, kerb ring, lane dashes
  const asphalt = new THREE.Mesh(new THREE.CircleGeometry(95, 40), lam(0x4a4e58));
  asphalt.rotation.x = -Math.PI / 2;
  scene.add(asphalt);
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(15, 40), lam(0x9b9ca3));
  plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.02;
  scene.add(plaza);
  const kerb = new THREE.Mesh(new THREE.RingGeometry(15, 15.8, 40), lam(0xd5d3cb));
  kerb.rotation.x = -Math.PI / 2; kerb.position.y = 0.03;
  scene.add(kerb);
  const dash = lam(0xf4f1e6);
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const d = box(2.4, 0.02, 0.45, dash, Math.cos(a) * 25.5, 0.03, Math.sin(a) * 25.5);
    d.rotation.y = -a + Math.PI / 2;
    scene.add(d);
  }
  // Pflastersteine-ish patches on the plaza
  const patch = lam(0x888a91);
  for (let i = 0; i < 16; i++) {
    const a = rng.next() * Math.PI * 2, r = 3 + rng.next() * 10;
    const m = box(1.6 + rng.next(), 0.02, 1.2 + rng.next(), patch, Math.cos(a) * r, 0.035, Math.sin(a) * r);
    m.rotation.y = rng.next() * 3;
    scene.add(m);
  }

  // ---- skyline: Plattenbau blocks with window rows, a Fernsehturm
  const facade = facadeTexture(THREE);
  const blockMats = [0xc9c4b8, 0xb7b9c2, 0xd1c1a6, 0xa9b4b0].map((c) => new THREE.MeshLambertMaterial({ color: c, map: facade }));
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rng.next() * 0.2, r = 52 + rng.next() * 24;
    const w = 12 + rng.next() * 10, h = 22 + rng.next() * 30, dd = 9 + rng.next() * 6;
    const m = box(w, h, dd, blockMats[i % blockMats.length], Math.cos(a) * r, h / 2, Math.sin(a) * r);
    m.rotation.y = -a + Math.PI / 2;
    scene.add(m);
  }
  const silver = lam(0xcfd6de);
  const tvx = -40, tvz = -58;
  scene.add(cyl(0.8, 2.6, 78, silver, 12, tvx, 39, tvz));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(6.2, 16, 12), lam(0xe3e8ee)));
  const ball = scene.children[scene.children.length - 1];
  ball.position.set(tvx, 78, tvz);
  scene.add(cyl(0.12, 0.5, 26, lam(0xd9453b), 8, tvx, 97, tvz));

  // ---- Spaeti + U-Bahn sign on the plaza
  const sp = new THREE.Group();
  sp.position.set(Math.cos(course.plats[0].ang + 1.5) * 12, 0, Math.sin(course.plats[0].ang + 1.5) * 12);
  sp.rotation.y = -(course.plats[0].ang + 1.5) + Math.PI / 2;
  sp.add(box(7, 3.4, 3.4, lam(0xe9dcc2), 0, 1.7, 0), box(7.4, 0.5, 4.2, lam(0xe8b730), 0, 3.6, 0.3));
  sp.add(box(5.4, 1.9, 0.12, lam(0x9fd0e8), 0, 1.5, 1.75));
  const sign = textSprite(THREE, 'SPÄTI', { w: 256, h: 96, font: 70, color: '#ffd84a', scale: 2.6 });
  sign.position.set(0, 4.7, 0.8);
  sp.add(sign);
  scene.add(sp);
  const ub = new THREE.Group();
  const ua = course.plats[0].ang - 1.4;
  ub.position.set(Math.cos(ua) * 12.5, 0, Math.sin(ua) * 12.5);
  ub.add(cyl(0.1, 0.1, 4, lam(0x555a66), 8, 0, 2, 0), box(1.3, 1.3, 0.12, lam(0x1b5fb5), 0, 4.2, 0));
  const u = textSprite(THREE, 'U', { w: 64, h: 64, font: 56, scale: 1.1 });
  u.position.set(0, 4.2, 0.12);
  ub.add(u);
  scene.add(ub);

  // ---- clouds (drifting)
  const cloudMat = lam(0xffffff, { transparent: true, opacity: 0.92 });
  const clouds = [];
  for (let i = 0; i < 16; i++) {
    const g = new THREE.Group();
    const n = 3 + Math.floor(rng.next() * 3);
    for (let j = 0; j < n; j++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(1.8 + rng.next() * 1.8, 10, 8), cloudMat);
      s.position.set(j * 2.4 - n, rng.next() * 0.8, (rng.next() - 0.5) * 2);
      s.scale.y = 0.6;
      g.add(s);
    }
    const a = rng.next() * Math.PI * 2, r = 22 + rng.next() * 55;
    g.position.set(Math.cos(a) * r, 6 + rng.next() * 62, Math.sin(a) * r);
    g.userData.speed = 0.4 + rng.next() * 0.7;
    scene.add(g);
    clouds.push(g);
  }

  // ---- the platforms
  const plat = [];
  for (const p of course.plats) {
    const g = new THREE.Group();
    g.position.set(p.x, p.top, p.z);
    g.rotation.y = p.yaw;
    const tint = (c) => new THREE.Color(c).offsetHSL(((p.i % 5) - 2) * 0.008, 0, ((p.i % 3) - 1) * 0.025);
    const body = (c) => lam(tint(c));
    const T = p.thick;
    switch (p.kind) {
      case 'crate': {   // Pfandkasten
        g.add(box(p.hw * 2, T - 0.06, p.hd * 2, body(0xd98a1c), 0, -0.06 - (T - 0.06) / 2, 0));
        g.add(box(p.hw * 2 - 0.25, 0.06, p.hd * 2 - 0.25, body(0xf1b84a), 0, -0.03, 0));
        for (const s of [-1, 1]) for (let j = -2; j <= 2; j++) g.add(box(0.14, T * 0.5, 0.05, lam(0x8f5610), j * p.hw * 0.4, -T * 0.5, s * (p.hd + 0.02)));
        for (let j = 0; j < 4; j++) g.add(cyl(0.13, 0.13, 0.5, lam(0x2f6b3a), 8, -p.hw * 0.7 + j * p.hw * 0.47, -T - 0.2, 0));
        break;
      }
      case 'bench': {   // Bahnhofsbank
        for (let j = 0; j < 3; j++) g.add(box(p.hw * 2, 0.14, 0.34, body(0xc4122f), 0, -0.07, -p.hd + 0.2 + j * 0.42));
        for (const s of [-1, 1]) g.add(box(0.16, T, p.hd * 2 - 0.1, lam(0x6d717c), s * (p.hw - 0.3), -0.14 - T / 2, 0));
        g.add(box(p.hw * 2, 0.1, 0.1, lam(0x6d717c), 0, -0.4, 0));
        break;
      }
      case 'fridge': {   // Spaeti-Kuehlschrank, liegend
        g.add(box(p.hw * 2, T - 0.06, p.hd * 2, body(0xf2f2f0), 0, -0.06 - (T - 0.06) / 2, 0));
        g.add(box(p.hw * 2 - 0.2, 0.06, p.hd * 2 - 0.2, body(0xa8dcf5), 0, -0.03, 0));
        g.add(box(p.hw * 2 + 0.02, 0.22, p.hd * 2 + 0.02, lam(0x2d7fd6), 0, -0.45, 0));
        g.add(box(0.12, 0.12, 0.9, lam(0x777f8c), p.hw + 0.08, -0.5, 0));
        break;
      }
      case 'iceseat': {   // ICE-Sitz
        g.add(box(p.hw * 2, T - 0.06, p.hd * 2, body(0x2a4fa0), 0, -0.06 - (T - 0.06) / 2, 0));
        g.add(box(p.hw * 2 - 0.2, 0.06, p.hd * 2 - 0.2, body(0x3d68c9), 0, -0.03, 0));
        g.add(box(p.hw * 2 - 0.6, 0.065, 0.22, lam(0xd8353f), 0, -0.03, 0));
        g.add(box(p.hw * 2, 0.12, p.hd * 2, lam(0x545b69), 0, -T - 0.05, 0));
        break;
      }
      case 'doner': {   // Doenerspiess
        const cols = [0x9a4a2a, 0xb85d36, 0x7e3a20, 0xc26b40];
        for (let j = 0; j < 4; j++) g.add(cyl(p.r - (j % 2) * 0.06, p.r - (j % 2) * 0.06, T / 4, lam(cols[j]), 18, 0, -(T / 4) * (j + 0.5) - (j === 0 ? 0.0 : 0), 0));
        g.children[0].material = [lam(cols[0]), lam(0xd78a58), lam(cols[0])];
        g.add(cyl(0.07, 0.07, T + 1.6, lam(0xc7ccd4), 8, 0, -T / 2 - 0.5, 0));
        break;
      }
      case 'cone': {   // Leitkegel, kopfueber
        g.add(cyl(p.r, 0.28, T, [lam(0xff7a1a), lam(0xffa24a), lam(0xff7a1a)], 20, 0, -T / 2, 0));
        g.add(cyl(p.r * 0.74, p.r * 0.56, 0.3, lam(0xf6f6f2), 20, 0, -T * 0.4, 0));
        g.add(box(0.7, 0.1, 0.7, lam(0x222630), 0, -T - 0.04, 0));
        break;
      }
      case 'cap': {   // Kronkorken
        g.add(cyl(p.r, p.r * 0.94, T, [lam(0xd9a21b), lam(0xf0c040), lam(0xd9a21b)], 14, 0, -T / 2, 0));
        for (let j = 0; j < 14; j++) {   // the crimped rim
          const a = (j / 14) * Math.PI * 2;
          const tooth = box(0.28, T * 0.9, 0.14, lam(0xb98410), Math.cos(a) * (p.r * 0.97), -T / 2, Math.sin(a) * (p.r * 0.97));
          tooth.rotation.y = -a;
          g.add(tooth);
        }
        break;
      }
      case 'bottle': {   // the summit: a giant Mate bottle with its crown cap on top
        g.add(cyl(p.r, p.r * 0.92, T, [lam(0xc9d0d8), lam(0xe8edf2), lam(0xc9d0d8)], 20, 0, -T / 2, 0));
        g.add(cyl(1.3, 1.9, 2.6, lam(0x2d4b2a), 16, 0, -T - 1.3, 0));
        g.add(cyl(3.0, 2.0, 2.2, lam(0x2d4b2a), 16, 0, -T - 3.6, 0));
        g.add(cyl(3.0, 3.0, 9, lam(0x2d4b2a), 20, 0, -T - 8.2, 0));
        g.add(cyl(3.04, 3.04, 3.6, lam(0xf2d03b), 20, 0, -T - 8.2, 0));
        const lab = textSprite(THREE, 'MATE', { w: 256, h: 96, font: 80, color: '#2d4b2a', stroke: '#f2d03b', scale: 3.4 });
        lab.position.set(0, -T - 8.2, 0);
        g.add(lab);
        // flag
        g.add(cyl(0.06, 0.06, 3, lam(0xeeeeee), 6, 1.6, 1.5, 0));
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.0), new THREE.MeshBasicMaterial({ color: 0xff3d5a, side: THREE.DoubleSide }));
        flag.position.set(2.5, 2.5, 0);
        g.add(flag);
        break;
      }
      default: g.add(box(p.hw * 2 || p.r * 2, T, p.hd * 2 || p.r * 2, lam(0xcccccc), 0, -T / 2, 0));
    }
    scene.add(g);
    plat.push({ i: p.i, group: g, dip: 0, baseY: p.top, rx: 0, rz: 0 });
  }

  return {
    plat,
    bump(i, amount = 0.2) { if (plat[i]) plat[i].dip = amount; },
    update(dt, time) {
      for (const e of plat) {
        e.dip *= Math.exp(-dt * 5);
        e.group.position.y = e.baseY - e.dip * 0.4;
        e.group.rotation.z = Math.sin(time * 1.1 + e.i * 1.7) * 0.012 + e.dip * 0.05;   // the wobbly tower
        e.group.rotation.x = Math.cos(time * 0.9 + e.i * 2.3) * 0.012;
      }
      for (const c of clouds) {
        c.position.x += c.userData.speed * dt;
        if (c.position.x > 80) c.position.x = -80;
      }
    },
  };
}
