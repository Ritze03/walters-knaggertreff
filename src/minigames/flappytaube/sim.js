// "Flappy Taube": pure simulation (no Kaplay, no Math.random). Every client runs the same course from the shared seed.
// Coordinates: logical lane 960 x 720, y grows downwards, the pigeon stays at x = PX while the world scrolls past.
export const DURATION_MS = 30000;
export const W = 960, GROUND = 640, PX = 240, R = 14;           // R = forgiving hit circle (the drawn pigeon is bigger)
export const GRAVITY = 1500, FLAP_V = -470, VMAX = 720, STEP = 1 / 60;
export const CRUMB_R = 30;
export const GAP_POINTS = 3, CRUMB_POINTS = 1;                  // score = gaps * 3 + crumbs

/** Obstacle kinds. A piece is a "cap" next to the gap (capW x capH) plus a narrower body (bodyW) to the screen edge. capH 0 = plain block. */
export const KINDS = [
  { id: 'plattenbau', name: 'Plattenbau', capW: 104, capH: 0, bodyW: 104 },
  { id: 'fernsehturm', name: 'Fernsehturm', capW: 78, capH: 78, bodyW: 26 },
  { id: 'laterne', name: 'Laterne', capW: 76, capH: 30, bodyW: 14 },
  { id: 'kran', name: 'Baukran', capW: 118, capH: 26, bodyW: 40 },
  { id: 'spaeti', name: 'Späti', capW: 132, capH: 28, bodyW: 108 },
];
// hanging pieces (top) use their own cap shapes: kran -> wrecking ball, spaeti -> Döner spit
export const TOP_CAP = { kran: { capW: 72, capH: 72, bodyW: 10 }, spaeti: { capW: 66, capH: 90, bodyW: 8 } };
export const topOf = (kind) => TOP_CAP[KINDS[kind].id] ?? KINDS[kind];

export const speedAt = (t) => 260 + 5 * t;                       // px/s, t in sim seconds

/** The shared course. n obstacles with a gap each; crumbs sit in gaps and between them. */
export function makeCourse(rng, n = 48) {
  const obs = [], crumbs = [];
  let x = 820, c = GROUND / 2, prev = -1;
  for (let i = 0; i < n; i++) {
    const h = Math.max(160, 250 - i * 5);
    c = Math.min(GROUND - h / 2 - 90, Math.max(h / 2 + 90, c + (rng.next() * 2 - 1) * 170));
    let kind = rng.int(0, KINDS.length - 1);
    if (kind === prev) kind = (kind + 1 + rng.int(0, KINDS.length - 2)) % KINDS.length;
    prev = kind;
    obs.push({ i, x: Math.round(x), c: Math.round(c), h, kind });
    if (rng.next() < 0.55) crumbs.push({ x: Math.round(x), y: Math.round(c + (rng.next() - 0.5) * (h - 90)) });
    const nx = x + 320 + rng.next() * 80;
    if (rng.next() < 0.5) crumbs.push({ x: Math.round((x + nx) / 2), y: 0, between: true });
    x = nx;
  }
  // "between" crumbs lie on the line to the next gap centre
  for (const cr of crumbs) {
    if (!cr.between) continue;
    const j = obs.findIndex((o) => o.x > cr.x);
    if (j > 0) { const a = obs[j - 1], b = obs[j]; cr.y = Math.round(a.c + (b.c - a.c) * ((cr.x - a.x) / (b.x - a.x))); } else cr.y = GROUND / 2;
    delete cr.between;
  }
  crumbs.sort((p, q) => p.x - q.x);
  return { obs, crumbs };
}

/** Collision rects of one obstacle (world x, screen y): [x0, y0, x1, y1] */
export function rectsOf(o) {
  const kd = KINDS[o.kind], top = topOf(o.kind);
  const gTop = o.c - o.h / 2, gBot = o.c + o.h / 2;
  const out = [];
  out.push([o.x - top.capW / 2, gTop - top.capH, o.x + top.capW / 2, gTop]);           // top piece: cap right above the gap
  if (top.bodyW < top.capW) out.push([o.x - top.bodyW / 2, -60, o.x + top.bodyW / 2, gTop - top.capH]);
  else if (top.capH === 0) out[0][1] = -60;
  out.push([o.x - kd.capW / 2, gBot, o.x + kd.capW / 2, gBot + kd.capH]);              // bottom piece
  if (kd.bodyW < kd.capW) out.push([o.x - kd.bodyW / 2, gBot + kd.capH, o.x + kd.bodyW / 2, GROUND + 20]);
  else if (kd.capH === 0) out[out.length - 1][3] = GROUND + 20;
  return out;
}
export const halfWidth = (o) => Math.max(KINDS[o.kind].capW, topOf(o.kind).capW) / 2;

export function createRun(course) {
  return { course, t: 0, dist: 0, y: GROUND / 2 - 40, vy: -200, gaps: 0, crumbs: 0, dead: false, hit: null, done: false, flaps: 0, nextObs: 0, got: new Set() };
}

const hitsRect = (cx, cy, r, [x0, y0, x1, y1]) => {
  const dx = cx - Math.max(x0, Math.min(x1, cx)), dy = cy - Math.max(y0, Math.min(y1, cy));
  return dx * dx + dy * dy < r * r;
};

/** One fixed step. `flap` = a flap press arrived. Returns events: 'gap' | 'crumb' | 'crash' | 'end'. */
export function step(st, flap, dt = STEP) {
  const ev = [];
  if (st.dead || st.done) {   // corpse falls
    st.vy = Math.min(VMAX, st.vy + GRAVITY * dt);
    st.y = Math.min(GROUND - R, st.y + st.vy * dt);
    return ev;
  }
  st.t += dt;
  if (flap) { st.vy = FLAP_V; st.flaps++; }
  st.vy = Math.min(VMAX, st.vy + GRAVITY * dt);
  st.y += st.vy * dt;
  st.dist += speedAt(st.t) * dt;
  if (st.y < R) { st.y = R; if (st.vy < 0) st.vy = 0; }
  const px = st.dist + PX, { obs, crumbs } = st.course;
  for (const o of obs) {
    if (o.x - px > 200) break;
    if (px - o.x > 200) continue;
    if (rectsOf(o).some((r) => hitsRect(px, st.y, R, r))) { st.dead = true; st.hit = o.kind; ev.push('crash'); return ev; }
  }
  if (st.y > GROUND - R) { st.y = GROUND - R; st.dead = true; st.hit = -1; ev.push('crash'); return ev; }
  while (st.nextObs < obs.length && px > obs[st.nextObs].x + halfWidth(obs[st.nextObs])) { st.gaps++; st.nextObs++; ev.push('gap'); }
  for (let i = 0; i < crumbs.length; i++) {
    const c = crumbs[i];
    if (c.x - px > CRUMB_R + 20) break;
    if (st.got.has(i) || px - c.x > CRUMB_R + 20) continue;
    if ((px - c.x) ** 2 + (st.y - c.y) ** 2 < (CRUMB_R + R) ** 2) { st.got.add(i); st.crumbs++; ev.push('crumb'); }
  }
  if (st.t * 1000 >= DURATION_MS - 400) { st.done = true; ev.push('end'); }
  return ev;
}

export const score = (st) => st.gaps * GAP_POINTS + st.crumbs * CRUMB_POINTS;
export const labelOf = (st) => `${st.gaps} Lücken${st.crumbs ? ` + ${st.crumbs} Krümel` : ''}`;
