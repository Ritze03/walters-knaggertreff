// "U-Bahn-Surfers": the three.js scene. NO static `import 'three'` (it would pull three into the main bundle): everything comes from `THREE` = t3.THREE.
// The run goes along -z: world z = -dist. Low-poly primitives and a few canvas textures only, nothing from outside.
import { LANE_W, KINDS, laneX } from './sim.js';

const SEG = 24;            // length of one tunnel segment (m)
const SEGS = 9;            // segments in the ring (216 m, a bit more than the fog distance)
const WALL = 6.6;          // half width of the tunnel
const FAR = 150;           // obstacles / bottles are built this far ahead
const BACK = 14;           // ... and dropped this far behind

/** a station is two segments out of ten */
export const isStation = (seg) => ((seg % 10) + 10) % 10 >= 7;
const stationNo = (seg) => Math.floor(seg / 10);
const STATIONS = ['Schinkenstraße', 'Späti-Platz', 'Pfandring', 'Aura-Allee', 'Döner-Damm', 'Mittwochsfrosch', 'Kiez-Kreuz', 'Bürgeramt Süd'];
const BANDS = ['#e8742c', '#2b8fb5', '#c43a5a', '#4aa05a', '#8a5bd0'];
const POSTERS = [['DÖNER', '5 €', '#e8742c'], ['SPÄTI', 'OPEN', '#2b8fb5'], ['ES IST', 'MITTWOCH', '#4aa05a'], ['AURA', '+1000', '#8a5bd0'], ['PFAND', 'IST PFAND', '#c43a5a']];

export function buildWorld(t3, profile, track) {
  const { THREE, scene, camera } = t3;
  const own = [];   // everything with a dispose() that is not always part of the scene graph
  const keep = (x) => { own.push(x); return x; };
  const geo = (g) => keep(g);
  const mats = new Map();
  const lambert = (color, o = {}) => {
    const key = color + JSON.stringify(o);
    if (!mats.has(key)) mats.set(key, keep(new THREE.MeshLambertMaterial({ color, ...o })));
    return mats.get(key);
  };
  const basic = (color, o = {}) => {
    const key = 'b' + color + JSON.stringify(o);
    if (!mats.has(key)) mats.set(key, keep(new THREE.MeshBasicMaterial({ color, ...o })));
    return mats.get(key);
  };
  const canvasTex = (w, h, draw, repeat) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const tex = keep(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    if (repeat) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(repeat[0], repeat[1]); }
    return tex;
  };
  const FONT = '"Segoe UI", system-ui, sans-serif';
  const fitText = (g, text, x, y, maxW, px, color, weight = 800) => {
    g.font = `${weight} ${px}px ${FONT}`;
    while (g.measureText(text).width > maxW && px > 10) { px -= 2; g.font = `${weight} ${px}px ${FONT}`; }
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, x, y);
  };
  const mesh = (g, m, parent, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); parent?.add(o); return o; };
  const box = (w, h, d) => geoCache(`box${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
  const gcache = new Map();
  function geoCache(key, make) { if (!gcache.has(key)) gcache.set(key, geo(make())); return gcache.get(key); }

  // ---------- atmosphere
  const FOG = 0x151a29;
  scene.background = new THREE.Color(FOG);
  scene.fog = new THREE.Fog(FOG, 45, 160);
  scene.add(new THREE.HemisphereLight(0xe8eeff, 0x5a6078, 1.9));
  const sun = new THREE.DirectionalLight(0xfff4dc, 1.4);
  sun.position.set(-4, 9, 6);
  scene.add(sun, sun.target);

  // ---------- textures
  const tileTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#eceff4'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#aab2c2'; g.lineWidth = 4;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, h); g.stroke(); g.beginPath(); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke(); }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(120,130,150,${Math.random() * 0.09})`; g.fillRect(Math.random() * w, Math.random() * h, 28, 28); }
  }, [SEG / 3, 7 / 3]);
  const bedTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#3d3a3c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(${90 + Math.random() * 50},${90 + Math.random() * 40},${90 + Math.random() * 40},0.5)`; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
    g.fillStyle = '#6b4a2e';
    g.fillRect(8, 6, w - 16, 18); g.fillRect(8, 70, w - 16, 18);   // sleepers
    g.fillStyle = '#c4cad6';
    g.fillRect(22, 0, 8, h); g.fillRect(98, 0, 8, h);              // rails
    g.fillStyle = '#ffffff'; g.fillRect(24, 0, 2, h); g.fillRect(100, 0, 2, h);
  }, [1, SEG / 2]);
  const mkSign = (name) => canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#1b3a8c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f4d21e'; g.fillRect(0, 0, w, 10); g.fillRect(0, h - 10, w, 10);
    g.font = '64px serif'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
    g.fillText('🚇', 18, h / 2 + 4);
    fitText(g, name, w / 2 + 40, h / 2 + 2, w - 150, 66, '#ffffff');
  });
  const signMats = STATIONS.map((n) => keep(new THREE.MeshBasicMaterial({ map: mkSign(n), fog: true })));
  const warnTex = canvasTex(512, 96, (g, w, h) => {
    g.fillStyle = '#f4d21e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#16181f';
    for (let x = -h; x < w; x += 48) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 24, h); g.lineTo(x + 24 + h, 0); g.lineTo(x + h, 0); g.fill(); }
    g.fillStyle = '#16181f'; g.fillRect(70, 14, w - 140, h - 28);
    fitText(g, 'Zurückbleiben bitte!', w / 2, h / 2 + 2, w - 170, 52, '#f4d21e');
  });
  const warnMat = keep(new THREE.MeshBasicMaterial({ map: warnTex }));
  const posterMats = POSTERS.map(([a, b, c]) => keep(new THREE.MeshLambertMaterial({
    map: canvasTex(128, 192, (g, w, h) => {
      g.fillStyle = c; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.arc(w * 0.8, h * 0.2, 46, 0, 7); g.fill();
      fitText(g, a, w / 2, h * 0.36, w - 16, 44, '#ffffff'); fitText(g, b, w / 2, h * 0.62, w - 16, 40, '#16181f');
      g.fillStyle = '#ffffff'; g.fillRect(14, h - 34, w - 28, 8);
    }),
  })));
  const gateTex = canvasTex(256, 192, (g, w, h) => {
    g.fillStyle = '#f4d21e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#16181f';
    for (let x = -h; x < w; x += 44) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 22, 0); g.lineTo(x + 22 + h, h); g.lineTo(x + h, h); g.fill(); }
    g.fillStyle = '#16181f'; g.fillRect(14, 54, w - 28, 84);
    fitText(g, 'BAUSTELLE', w / 2, 82, w - 50, 40, '#f4d21e'); fitText(g, 'Bitte ducken', w / 2, 118, w - 50, 26, '#ffffff', 600);
  });
  const trainSign = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#10131c'; g.fillRect(0, 0, w, h);
    fitText(g, 'NICHT EINSTEIGEN', w / 2, h / 2 + 2, w - 20, 34, '#ffb12b');
  });

  // ---------- tunnel ring
  const tileWall = lambert(0xffffff, { map: tileTex });
  const tileWallDark = lambert(0xb5bccc, { map: tileTex });
  const segs = [];
  const plane = (w, h) => geoCache(`plane${w},${h}`, () => new THREE.PlaneGeometry(w, h));
  for (let k = 0; k < SEGS; k++) {
    const g = new THREE.Group();
    const floor = mesh(box(WALL * 2, 0.3, SEG), lambert(0x30364a), g, 0, -0.17, 0);
    void floor;
    for (let l = 0; l < 3; l++) {
      const bed = mesh(plane(LANE_W - 0.3, SEG), lambert(0xffffff, { map: bedTex }), g, laneX(l), 0.012, 0);
      bed.rotation.x = -Math.PI / 2;
    }
    const walls = [];
    for (const s of [-1, 1]) {
      const w = mesh(plane(SEG, 7), tileWallDark, g, s * WALL, 3.5, 0);
      w.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2;
      walls.push(w);
    }
    const ceil = mesh(plane(WALL * 2, SEG), basic(0x2b3250), g, 0, 7, 0);
    ceil.rotation.x = Math.PI / 2;
    const bands = [];
    for (const s of [-1, 1]) bands.push(mesh(box(0.1, 0.5, SEG), lambert(BANDS[0]), g, s * (WALL - 0.04), 1.55, 0));
    for (const z of [-6, 6]) {
      mesh(box(WALL * 2, 0.5, 0.8), basic(0x1e2338), g, 0, 6.75, z);
      for (const s of [-1, 1]) mesh(box(2.6, 0.1, 0.45), basic(0xfff1bd), g, s * 2.6, 6.46, z);
    }
    // station dressing
    const st = new THREE.Group();
    for (const s of [-1, 1]) {
      mesh(box(WALL - 3.7, 1.1, SEG), lambert(0x8a91a4), st, s * (3.7 + (WALL - 3.7) / 2), 0.55, 0);
      mesh(box(0.34, 0.03, SEG), lambert(0xf4d21e), st, s * 3.9, 1.12, 0);
      const sign = mesh(plane(6.5, 1.6), signMats[0], st, s * (WALL - 0.06), 4.3, 0);
      sign.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2;
      const warn = mesh(plane(6.5, 1.22), warnMat, st, s * (WALL - 0.06), 5.75, 0);
      warn.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2;
      for (const z of [-8.5, 8.5]) {
        const p = mesh(plane(1.5, 2.25), posterMats[(k + (z > 0 ? 2 : 0) + (s > 0 ? 1 : 0)) % 5], st, s * (WALL - 0.06), 2.9, z);
        p.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2;
        p.userData.poster = true;
      }
      // two waiting blobs on the platform
      for (let i = 0; i < 2; i++) {
        const col = ['#ff8fd0', '#8ce99a', '#ffd43b', '#b197fc', '#4dabf7'][(k + i + (s > 0 ? 2 : 0)) % 5];
        const z = i ? 5 : -4;
        const body = mesh(geoCache('sph', () => new THREE.SphereGeometry(0.4, 14, 10)), lambert(col), st, s * 5.2, 1.1 + 0.45, z);
        body.scale.set(1, 1.3, 1);
        for (const e of [-1, 1]) mesh(geoCache('eye', () => new THREE.SphereGeometry(0.08, 8, 6)), basic(0x111111), st, s * 5.2 + (s < 0 ? 0.36 : -0.36), 1.1 + 0.62, z + e * 0.14);
      }
    }
    st.visible = false;
    g.add(st);
    scene.add(g);
    segs.push({ g, walls, bands, st, idx: null, signs: st.children.filter((c) => c.material && signMats.includes(c.material)), posters: st.children.filter((c) => c.userData.poster) });
  }
  function placeSeg(s, idx) {
    s.idx = idx;
    s.g.position.z = -(idx * SEG + SEG / 2);
    const station = isStation(idx);
    s.st.visible = station;
    const n = stationNo(idx);
    for (const w of s.walls) w.material = station ? tileWall : tileWallDark;
    for (const b of s.bands) b.material = lambert(station ? BANDS[((n % BANDS.length) + BANDS.length) % BANDS.length] : '#4a5068');
    if (station) for (const sg of s.signs) sg.material = signMats[((n % STATIONS.length) + STATIONS.length) % STATIONS.length];
  }

  // ---------- obstacle / bottle builders
  const sph = (r) => geoCache(`s${r}`, () => new THREE.SphereGeometry(r, 16, 12));
  const cyl = (rt, rb, h, seg = 12) => geoCache(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
  const eyes = (p, y, z, r = 0.11) => {
    for (const e of [-1, 1]) {
      mesh(sph(r), basic(0xffffff), p, e * 0.2, y, z);
      mesh(sph(r * 0.5), basic(0x111111), p, e * 0.2, y, z + r * 0.8);
    }
  };

  function buildController() {
    const g = new THREE.Group();
    const body = mesh(sph(0.5), lambert(0x27408b), g, 0, 0.8, 0);
    body.scale.set(1, 1.5, 0.95);
    mesh(cyl(0.52, 0.52, 0.2, 16), lambert(0xd8ff3d), g, 0, 0.85, 0).scale.set(1, 1, 0.95);
    mesh(cyl(0.36, 0.38, 0.17, 16), lambert(0x16254f), g, 0, 1.6, 0);
    mesh(box(0.5, 0.05, 0.3), lambert(0x16254f), g, 0, 1.53, 0.35);
    mesh(cyl(0.385, 0.385, 0.05, 16), lambert(0xf4d21e), g, 0, 1.54, 0);
    eyes(g, 1.22, 0.4, 0.1);
    for (const e of [-1, 1]) { const br = mesh(box(0.2, 0.05, 0.05), basic(0x111111), g, e * 0.2, 1.37, 0.43); br.rotation.z = e * 0.45; }
    mesh(box(0.28, 0.2, 0.1), lambert(0xf2f2f2), g, 0.6, 0.95, 0.25);
    mesh(box(0.08, 0.08, 0.04), basic(0xff3030), g, 0.6, 0.98, 0.31);
    return g;
  }
  function buildScooter(id) {
    const g = new THREE.Group();
    const c = id % 2 ? 0xff8a3d : 0x2dd36f;
    mesh(box(1.5, 0.08, 0.34), lambert(c), g, 0, 0.19, 0);
    for (const s of [-1, 1]) {
      const w = mesh(cyl(0.17, 0.17, 0.09, 14), lambert(0x15171d), g, s * 0.68, 0.17, 0);
      w.rotation.x = Math.PI / 2;
    }
    const stem = mesh(cyl(0.035, 0.035, 0.95, 8), lambert(0xc4cad6), g, 0.62, 0.43, 0);
    stem.rotation.z = -0.35;
    mesh(box(0.06, 0.06, 0.5), lambert(0x15171d), g, 0.8, 0.88, 0);
    return g;
  }
  function buildPillar() {
    const g = new THREE.Group();
    mesh(box(0.9, 7, 0.9), lambert(0xdfe3ea), g, 0, 3.5, 0);
    mesh(box(0.96, 0.9, 0.96), lambert(0xf4d21e), g, 0, 0.45, 0);
    for (const y of [0.18, 0.6]) mesh(box(0.98, 0.14, 0.98), lambert(0x16181f), g, 0, y, 0);
    return g;
  }
  function buildCrate() {
    const g = new THREE.Group();
    mesh(box(1.1, 0.5, 0.8), lambert(0x1f5fcf), g, 0, 0.27, 0);
    mesh(box(1.12, 0.1, 0.82), lambert(0x174a9f), g, 0, 0.5, 0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const x = (i - 1) * 0.32, z = (j - 0.5) * 0.34;
      mesh(cyl(0.1, 0.1, 0.3, 10), lambert(0x6a3d17), g, x, 0.62, z);
      mesh(cyl(0.04, 0.07, 0.12, 8), lambert(0x6a3d17), g, x, 0.83, z);
    }
    return g;
  }
  const trainMats = () => ({ body: lambert(0xf2c81e), roof: lambert(0xc9a413), dark: lambert(0x1b2030), glass: lambert(0x2a3350) });
  function buildTrain() {
    const m = trainMats(), L = KINDS.train.len, g = new THREE.Group();
    mesh(box(2.0, 0.35, L), m.dark, g, 0, 0.3, -L / 2);
    mesh(box(2.1, 3.0, L), m.body, g, 0, 1.97, -L / 2);
    mesh(box(2.05, 0.18, L), m.roof, g, 0, 3.55, -L / 2);
    mesh(box(2.16, 0.8, L - 0.8), m.glass, g, 0, 2.55, -L / 2);
    mesh(box(2.12, 0.14, L), lambert(0xd9381e), g, 0, 1.35, -L / 2);
    mesh(box(1.7, 0.95, 0.06), m.glass, g, 0, 2.6, 0.03);
    mesh(box(1.9, 0.3, 0.07), lambert(0x10131c), g, 0, 3.24, 0.04).material = lambert(0xffffff, { map: trainSign });
    for (const e of [-1, 1]) mesh(sph(0.15), basic(0xfffbd0), g, e * 0.7, 1.0, 0.05);
    mesh(box(0.5, 0.2, 0.06), lambert(0x1b2030), g, 0, 0.75, 0.06);
    return g;
  }
  function buildGate() {
    const g = new THREE.Group();
    for (const s of [-1, 1]) mesh(box(0.18, 3.0, 0.18), lambert(0x8a93a6), g, s * 1.05, 1.5, 0);
    mesh(box(2.3, 2.1, 0.14), lambert(0xffffff, { map: gateTex }), g, 0, 1.95, 0);
    mesh(box(2.3, 0.1, 0.16), lambert(0xd9381e), g, 0, 0.92, 0);
    return g;
  }
  const BUILD = { controller: buildController, scooter: buildScooter, pillar: buildPillar, crate: buildCrate, train: buildTrain, gate: buildGate };

  function buildBottle() {
    const g = new THREE.Group();
    const tilt = new THREE.Group();
    tilt.rotation.z = 0.28;
    mesh(cyl(0.12, 0.13, 0.36, 10), lambert(0x7a4a1c, { emissive: 0x2a1604 }), tilt, 0, 0, 0);
    mesh(cyl(0.05, 0.1, 0.2, 10), lambert(0x7a4a1c, { emissive: 0x2a1604 }), tilt, 0, 0.26, 0);
    mesh(cyl(0.065, 0.065, 0.05, 10), basic(0xf4d21e), tilt, 0, 0.38, 0);
    g.add(tilt);
    return g;
  }

  // ---------- player blob
  const player = new THREE.Group();
  const shell = new THREE.Group();   // animated part
  player.add(shell);
  const col = new THREE.Color(profile.color || '#ffb400');
  const bodyMat = keep(new THREE.MeshLambertMaterial({ color: col }));
  const body = mesh(sph(0.5), bodyMat, shell, 0, 0.62, 0);
  body.scale.set(1, 1.12, 0.95);
  for (const e of [-1, 1]) {   // eyes on the -z side (the face looks where it runs), visible when the camera swings round on a hit
    mesh(sph(0.12), basic(0xffffff), shell, e * 0.18, 0.82, -0.42);
    mesh(sph(0.06), basic(0x111111), shell, e * 0.18, 0.82, -0.52);
  }
  mesh(box(0.5, 0.45, 0.22), lambert(0x30364a), shell, 0, 0.6, 0.45);   // little Rucksack: seen from behind
  mesh(box(0.34, 0.1, 0.24), lambert(0xd9381e), shell, 0, 0.74, 0.5);
  const feet = [-1, 1].map((e) => mesh(sph(0.15), lambert(new THREE.Color(col).multiplyScalar(0.6)), shell, e * 0.22, 0.13, 0));
  const hat = profile.hat;
  const hatG = new THREE.Group();
  hatG.position.y = 1.18;
  shell.add(hatG);
  let prop = null;
  if (hat === 'cap') { mesh(cyl(0.3, 0.32, 0.18, 14), lambert(0xd9381e), hatG, 0, 0.05, 0); mesh(box(0.4, 0.04, 0.3), lambert(0xa82a14), hatG, 0, 0, -0.3); }
  else if (hat === 'crown') { mesh(cyl(0.3, 0.25, 0.22, 8), lambert(0xffd43b, { emissive: 0x4a3a00 }), hatG, 0, 0.05, 0); for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; mesh(sph(0.06), lambert(0xffd43b), hatG, Math.cos(a) * 0.28, 0.2, Math.sin(a) * 0.28); } }
  else if (hat === 'tophat') { mesh(cyl(0.45, 0.45, 0.04, 16), lambert(0x16181f), hatG, 0, 0, 0); mesh(cyl(0.27, 0.27, 0.42, 16), lambert(0x16181f), hatG, 0, 0.22, 0); mesh(cyl(0.275, 0.275, 0.08, 16), lambert(0xd9381e), hatG, 0, 0.1, 0); }
  else if (hat === 'cowboy') { mesh(cyl(0.58, 0.5, 0.05, 18), lambert(0x8a5a2b), hatG, 0, 0, 0); mesh(cyl(0.27, 0.33, 0.3, 14), lambert(0x8a5a2b), hatG, 0, 0.17, 0); }
  else if (hat === 'hotdog') { const h = mesh(geoCache('hd', () => new THREE.CapsuleGeometry(0.13, 0.5, 4, 10)), lambert(0xe0a458), hatG, 0, 0.1, 0); h.rotation.z = Math.PI / 2; mesh(geoCache('hd2', () => new THREE.CapsuleGeometry(0.07, 0.55, 4, 8)), lambert(0xd9381e), hatG, 0, 0.2, 0).rotation.z = Math.PI / 2; }
  else if (hat === 'cucumber') { const c = mesh(geoCache('cu', () => new THREE.CapsuleGeometry(0.11, 0.5, 4, 10)), lambert(0x4aa05a), hatG, 0.1, 0.15, 0); c.rotation.z = -0.7; }
  else if (hat === 'propeller') { mesh(cyl(0.05, 0.05, 0.14, 8), lambert(0x8a93a6), hatG, 0, 0.07, 0); prop = mesh(box(0.7, 0.03, 0.1), lambert(0xd9381e), hatG, 0, 0.16, 0); }
  const shadow = mesh(geoCache('shadow', () => new THREE.CircleGeometry(0.5, 20)), basic(0x000000, { transparent: true, opacity: 0.35 }), scene, 0, 0.03, 0);
  shadow.rotation.x = -Math.PI / 2;
  scene.add(player);

  // ---------- dynamic things
  const live = new Map();       // obstacle id -> { o, obj }
  const liveB = new Map();      // bottle id -> { b, obj }
  const flung = [];             // hit obstacles flying away
  const pops = Array.from({ length: 10 }, () => {
    const m = mesh(sph(0.3), keep(new THREE.MeshBasicMaterial({ color: 0xfff1a0, transparent: true, opacity: 0 })), scene);
    m.visible = false;
    return { m, t: 9 };
  });
  let oHi = 0, bHi = 0, shake = 0, tAnim = 0, camX = 0;
  const { obstacles, bottles } = track;

  function addObstacle(o) {
    const obj = BUILD[o.type](o.id);
    const kd = KINDS[o.type];
    obj.position.set(laneX(o.lane), 0, o.type === 'train' ? -o.d : -(o.d + kd.len / 2));
    scene.add(obj);
    live.set(o.id, { o, obj });
  }

  function update(st, dt, events = []) {
    tAnim += dt;
    const dist = st.dist;
    // tunnel ring
    const s0 = Math.floor((dist - 40) / SEG);
    for (let k = 0; k < SEGS; k++) {
      const s = segs[k];
      const idx = s0 + ((((k - s0) % SEGS) + SEGS) % SEGS);
      if (s.idx !== idx) placeSeg(s, idx);
    }
    // obstacles + bottles streaming
    while (oHi < obstacles.length && obstacles[oHi].d < dist + FAR) { const o = obstacles[oHi++]; if (o.d + o.len > dist - BACK) addObstacle(o); }
    for (const [id, e] of live) if (e.o.d + e.o.len < dist - BACK) { scene.remove(e.obj); live.delete(id); }
    while (bHi < bottles.length && bottles[bHi].d < dist + FAR) {
      const b = bottles[bHi++];
      if (b.d < dist - BACK || st.taken.has(b.id)) continue;
      const obj = buildBottle();
      obj.position.set(laneX(b.lane), b.y, -b.d);
      scene.add(obj);
      liveB.set(b.id, { b, obj });
    }
    for (const [id, e] of liveB) {
      if (e.b.d < dist - BACK) { scene.remove(e.obj); liveB.delete(id); continue; }
      e.obj.rotation.y = tAnim * 3 + id;
      e.obj.position.y = e.b.y + Math.sin(tAnim * 4 + id) * 0.06;
    }
    // events
    for (const ev of events) {
      if (ev.k === 'bottle') {
        const e = liveB.get(ev.id);
        if (e) {
          const p = pops.find((q) => q.t > 0.4);
          if (p) { p.t = 0; p.m.position.copy(e.obj.position); p.m.visible = true; }
          scene.remove(e.obj); liveB.delete(ev.id);
        }
      } else if (ev.k === 'hit') {
        shake = 0.5;
        const e = live.get(ev.id);
        if (e && e.o.type !== 'train' && e.o.type !== 'pillar') flung.push({ obj: e.obj, vx: (Math.random() - 0.5) * 8, vy: 7 + Math.random() * 3, vz: -4, spin: (Math.random() - 0.5) * 14, age: 0 });
      }
    }
    for (let i = flung.length - 1; i >= 0; i--) {
      const f = flung[i];
      f.age += dt; f.vy -= 24 * dt;
      f.obj.position.x += f.vx * dt; f.obj.position.y += f.vy * dt; f.obj.position.z += f.vz * dt;
      f.obj.rotation.x += f.spin * dt; f.obj.rotation.z += f.spin * 0.6 * dt;
      if (f.age > 0.9) { scene.remove(f.obj); flung.splice(i, 1); }
    }
    for (const p of pops) {
      if (!p.m.visible) continue;
      p.t += dt;
      const f = p.t / 0.35;
      p.m.scale.setScalar(0.5 + f * 1.6);
      p.m.material.opacity = Math.max(0, 0.9 * (1 - f));
      if (f >= 1) p.m.visible = false;
    }
    // player
    const sliding = st.slide > 0 && st.y <= 0.001;
    player.position.set(st.x, st.y, -dist);
    shadow.position.set(st.x, 0.03, -dist);
    shadow.scale.setScalar(Math.max(0.4, 1 - st.y * 0.25));
    const speedF = Math.min(1.6, st.speed / 18);
    const run = Math.sin(tAnim * 13 * speedF);
    shell.position.y = st.y > 0 ? 0 : Math.abs(run) * 0.09 * speedF;
    shell.scale.set(1, sliding ? 0.55 : st.y > 0.1 ? 1.1 : 1, 1);
    shell.rotation.x = sliding ? 0.7 : st.y > 0.1 ? -0.1 : 0.12;
    shell.rotation.z = Math.max(-0.5, Math.min(0.5, (st.x - laneX(st.lane)) * -0.28)) + (st.stumble > 0 ? Math.sin(tAnim * 30) * 0.18 : 0);
    feet[0].position.z = run * 0.22 * (st.y > 0 ? 0.2 : 1);
    feet[1].position.z = -run * 0.22 * (st.y > 0 ? 0.2 : 1);
    shell.visible = !(st.stumble > 0 && Math.floor(tAnim * 18) % 2 === 0);
    if (prop) prop.rotation.y += dt * 25;
    // light + camera
    sun.position.set(-4, 9, -dist + 6); sun.target.position.set(0, 0, -dist - 10);
    camX += (st.x - camX) * (1 - Math.exp(-dt * 7));
    shake = Math.max(0, shake - dt * 1.6);
    const sh = shake * shake * 0.9;
    camera.fov = 62 + Math.min(14, Math.max(0, st.speed - 12) * 0.55);
    camera.updateProjectionMatrix();
    camera.position.set(camX * 0.75 + (Math.random() - 0.5) * sh, 3.5 + st.y * 0.35 + (Math.random() - 0.5) * sh, -dist + 7.2);
    camera.lookAt(camX * 0.35, 1.2 + st.y * 0.2, -dist - 9);
  }

  function dispose() {
    for (const o of own) { try { o.dispose?.(); } catch { /* gone */ } }
  }

  update({ dist: 0, x: 0, y: 0, lane: 1, stumble: 0, slide: 0, speed: 12, taken: new Set() }, 0.016);
  return { update, dispose };
}
