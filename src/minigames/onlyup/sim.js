// "Knaggerturm" (solo, 3D): pure course + physics. No Kaplay, no three, no Math.random: every client builds the SAME tower from ctx.rng and simulates
// its own blob locally. Units are metres, y is up, the tower axis is x = z = 0. Platforms are one-way (you jump up through them and land on top).
// CONTROLS: the player only steers left / right (inp.axis -1..1, A/D, arrows, stick X) plus jump. assistMove() turns that into a world move direction:
// "right" runs clockwise round the tower (the way the spiral winds, and screen-right for the camera that follows the blob), and the radial / depth
// part is automatic: it eases the blob onto the line through the platform it stands on and the next (or previous) one. Same rules for humans and bots.
// The client (client.js) draws it with three.js and feeds step() with {axis, jump}; botControl() steers the ?bot with the same {axis, jump}.

export const DURATION_MS = 45000;
export const BOT_NOISE = 1.3;   // the ?bot: a bit early/late, a bit off-centre, now and then a plain misjudgement

export const C = {
  GRAV: 26, JUMP_V: 10.5, SPEED: 6.6,
  ACC_G: 70, ACC_A: 40, FRIC_G: 55, DRAG_A: 1.2,
  COYOTE: 0.14, BUFFER: 0.14,     // forgiveness: jump a moment after leaving an edge / a moment before landing
  MARGIN: 0.32,                    // the blob may overhang a platform edge by this much and still stand
  SPLAT_DROP: 4.5,                 // a fall of at least this many metres (to a lower platform / the ground) is a "splat"
  GROUND_R: 24,                    // the street around the tower; the sim clamps the blob inside
  DT: 1 / 120,
  ASSIST_LEAD: 0.15, ASSIST_GAIN: 2.5, ASSIST_HOLD: 0.9,   // assistMove: look-ahead (rad), radial pull per metre of error, share of a platform's half extent over which the route radius is held (tuned with the bot on 400 seeds)
  N: 28,                           // platforms including the summit
};

/** platform kinds: shape ('box' | 'round'), half extents / radius, visual thickness (the top face is the walkable surface) */
export const KINDS = {
  crate:   { shape: 'box',   hw: 1.35, hd: 1.0,  thick: 0.8 },   // Pfandkasten
  bench:   { shape: 'box',   hw: 1.9,  hd: 0.62, thick: 0.5 },   // Bahnhofsbank
  fridge:  { shape: 'box',   hw: 1.05, hd: 1.05, thick: 1.3 },   // Spaeti-Kuehlschrank
  iceseat: { shape: 'box',   hw: 1.25, hd: 0.95, thick: 0.7 },   // ICE-Sitz
  doner:   { shape: 'round', r: 1.25,  thick: 1.0 },              // Doenerspiess
  cone:    { shape: 'round', r: 1.05,  thick: 1.2 },              // Leitkegel, kopfueber
  cap:     { shape: 'round', r: 1.2,   thick: 0.35 },             // Kronkorken
};
const KIND_LIST = Object.keys(KINDS);
export const SUMMIT = { kind: 'summit', shape: 'round', r: 2.5, thick: 0.5 };   // the silver cap platform on top (with a flag)

const TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
export { angDiff };

/** The tower. rng = ctx.rng (shared seed). Platform i has: {i, kind, shape, x, z, top, yaw, hw, hd, r, thick, e, ang, rad}. i = 0 is the first, N-1 the summit. */
export function makeCourse(rng) {
  const plats = [];
  const ang0 = rng.next() * TAU;
  let ang = ang0, rad = 4.6, top = 0, prevKind = '';
  for (let i = 0; i < C.N; i++) {
    const last = i === C.N - 1;
    let kind;
    if (last) kind = 'summit';
    else { do { kind = KIND_LIST[rng.int(0, KIND_LIST.length - 1)]; } while (kind === prevKind); }
    prevKind = kind;
    const def = last ? SUMMIT : KINDS[kind];
    const e = def.shape === 'round' ? def.r : def.hw * 0.9 + def.hd * 0.35;     // rough half extent along the way to the next platform
    const nrad = last ? 4.8 : 4.0 + rng.next() * 2.0;
    const dy = i === 0 ? 1.25 : 1.3 + rng.next() * 0.45;
    if (i > 0) {
      const pe = plats[i - 1].e;
      const gap = 0.9 + rng.next() * 1.35;                                       // edge to edge, metres
      const d = pe + e + gap;
      const c = (rad * rad + nrad * nrad - d * d) / (2 * rad * nrad);
      ang -= Math.acos(Math.max(-1, Math.min(1, c)));                           // the spiral winds clockwise seen from above (to the RIGHT on screen)
    } else ang -= 0.5;
    rad = nrad;
    top += dy;
    const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
    // box platforms are laid along the spiral (tangent) with some jitter
    const yaw = def.shape === 'box' ? -(ang - Math.PI / 2) + (rng.next() - 0.5) * 0.7 : rng.next() * TAU;
    plats.push({ i, kind, shape: def.shape, x, z, top, yaw, hw: def.hw ?? 0, hd: def.hd ?? 0, r: def.r ?? 0, thick: def.thick, e, ang, rad });
  }
  // start: on the street, beside the first platform
  const p0 = plats[0];
  const sa = p0.ang + 0.55;
  // the climbing route as (angle, radius) points: the start spot on the street, then every platform centre (assistMove follows its polyline)
  const route = [{ ang: sa, rad: 5.4, e: 0 }, ...plats.map((p) => ({ ang: p.ang, rad: p.rad, e: p.e }))];
  return { plats, route, top: plats[plats.length - 1].top, start: { x: Math.cos(sa) * 5.4, z: Math.sin(sa) * 5.4 } };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Left / right input -> world move direction {dx, dz} (length <= 1). axis > 0 = clockwise round the tower (screen-right), < 0 = counter-clockwise.
 * While steering, the radial part (the old W/S) pulls the blob onto the route: the radius is interpolated by angle between the centre of the platform it
 * last stood on (st.ref, -1 = street) and the next one (when it is clockwise of it) or the previous one (counter-clockwise). No input = no movement at all.
 */
export function assistMove(st, course, axis) {
  const a = clamp(axis || 0, -1, 1);
  const r = Math.hypot(st.x, st.z);
  if (Math.abs(a) < 0.05 || r < 0.5) return { dx: 0, dz: 0 };
  const th = Math.atan2(st.z, st.x);
  const R = course.route, i = Math.min(R.length - 1, Math.max(0, (st.ref ?? -1) + 1)), cur = R[i];
  const look = angDiff(th - Math.sign(a) * C.ASSIST_LEAD, cur.ang);   // the radius is read a bit AHEAD along the way, so the blob is on the line when it gets there
  const nxt = look <= 0 ? R[i + 1] : R[i - 1];
  let want = cur.rad;
  if (nxt) {   // stay on the line through the platform's centre while the blob is over it; slide over to the next radius in the gap between the two
    const t = clamp(look / angDiff(nxt.ang, cur.ang), 0, 1), d = cur.e + nxt.e + 1.5, t0 = (cur.e * C.ASSIST_HOLD) / d, t1 = 1 - (nxt.e * C.ASSIST_HOLD) / d;
    want += (nxt.rad - cur.rad) * clamp((t - t0) / (t1 - t0), 0, 1);
  }
  const c = clamp((want - r) * C.ASSIST_GAIN, -1, 1) * Math.abs(a);
  const tx = Math.sin(th), tz = -Math.cos(th), ex = Math.cos(th), ez = Math.sin(th);
  const dx = a * tx + c * ex, dz = a * tz + c * ez, l = Math.hypot(dx, dz);
  return l > 1 ? { dx: dx / l, dz: dz / l } : { dx, dz };
}

/** is the point (x, z) over platform p's top face (grown by `m`)? */
export function over(p, x, z, m = C.MARGIN) {
  const dx = x - p.x, dz = z - p.z;
  if (p.shape === 'round') return dx * dx + dz * dz <= (p.r + m) * (p.r + m);
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.abs(lx) <= p.hw + m && Math.abs(lz) <= p.hd + m;
}

/** height of the highest surface at or below `y` under (x, z) (ground = 0): used for the blob's drop shadow */
export function supportBelow(course, x, z, y) {
  let h = 0;
  for (const p of course.plats) if (p.top <= y + 0.05 && p.top > h && over(p, x, z)) h = p.top;
  return h;
}

export function newState(course) {
  return { x: course.start.x, y: 0, z: course.start.z, vx: 0, vy: 0, vz: 0, grounded: true, on: -1, coyote: 0, buf: 0, best: 0, bestOn: -1, t: 0, done: false,
    stand: 0, fx: 0, fz: 0, ref: -1 };
}

/**
 * One fixed step. inp = { axis (-1..1, left / right: see assistMove) or dx, dz (a raw world move direction, length <= 1), jump (a press happened) }.
 * Returns an array of events: 'jump', 'land' {drop}, 'splat' {drop}, 'summit'. Mutates st.
 */
export function step(st, course, inp, dt = C.DT) {
  const ev = [];
  if (st.done) { st.vx = st.vz = 0; return ev; }
  st.t += dt;
  st.buf = inp.jump ? C.BUFFER : Math.max(0, st.buf - dt);
  if (inp.axis !== undefined) inp = { ...inp, ...assistMove(st, course, inp.axis) };

  // horizontal: snappy on the ground, softer in the air (a little air control, never none)
  const tx = inp.dx * C.SPEED, tz = inp.dz * C.SPEED;
  const has = Math.hypot(inp.dx, inp.dz) > 0.05;
  const acc = (st.grounded ? C.ACC_G : C.ACC_A) * dt;
  if (has) {
    const ex = tx - st.vx, ez = tz - st.vz, el = Math.hypot(ex, ez);
    const k = el > acc ? acc / el : 1;
    st.vx += ex * k; st.vz += ez * k;
  } else {
    const sp = Math.hypot(st.vx, st.vz), dec = (st.grounded ? C.FRIC_G : C.DRAG_A) * dt;
    const k = sp > dec ? (sp - dec) / sp : 0;
    st.vx *= k; st.vz *= k;
  }
  if (has) { st.fx = inp.dx; st.fz = inp.dz; }

  // jump (buffered, with coyote time)
  if (st.buf > 0 && (st.grounded || st.coyote > 0)) {
    st.vy = C.JUMP_V; st.grounded = false; st.on = -1; st.coyote = 0; st.buf = 0;
    ev.push('jump');
  }
  const prevY = st.y;
  st.x += st.vx * dt; st.z += st.vz * dt;
  const rr = Math.hypot(st.x, st.z);
  if (rr > C.GROUND_R) { st.x *= C.GROUND_R / rr; st.z *= C.GROUND_R / rr; }

  if (st.grounded) {
    const surf = st.on >= 0 ? course.plats[st.on] : null;
    if (surf && !over(surf, st.x, st.z)) { st.grounded = false; st.coyote = C.COYOTE; st.on = -1; }   // walked off the edge
  }
  if (!st.grounded) {
    st.coyote = Math.max(0, st.coyote - dt);
    st.vy -= C.GRAV * dt;
    st.y += st.vy * dt;
    if (st.vy <= 0) {
      let land = null, landTop = 0;
      if (st.y <= 0) { land = -1; landTop = 0; }
      for (const p of course.plats) {
        if (p.top > landTop && p.top <= prevY + 0.08 && st.y <= p.top && over(p, st.x, st.z)) { land = p.i; landTop = p.top; }
      }
      if (land !== null) {
        st.y = landTop; st.vy = 0; st.grounded = true; st.on = land; st.ref = land; st.coyote = 0;
        const drop = st.stand - landTop;
        if (drop >= C.SPLAT_DROP) ev.push({ type: 'splat', drop });
        else ev.push({ type: 'land', drop });
        st.stand = landTop;
        if (landTop > st.best) { st.best = landTop; st.bestOn = land; }
        if (land === course.plats.length - 1) { st.done = true; ev.push('summit'); }
      }
    }
  } else {
    st.y = st.on >= 0 ? course.plats[st.on].top : 0;
    st.vy = 0;
  }
  return ev;
}

/**
 * Bot steering: returns {axis, jump} (the same left / right + jump a player has). `bot` is a per-bot memory {rng, aim, noise}. It aims at the next platform and jumps when it thinks it is in range;
 * noise makes it a bit early/late and a bit off-centre, so it sometimes misses and falls. noise 0 = a clean run (used by the tests).
 */
export function botControl(st, course, bot, noise = 1, dt = C.DT) {
  const n = course.plats.length;
  const idx = Math.min(n - 1, (st.grounded ? st.on : bot.lastOn ?? -1) + 1);
  if (st.grounded) bot.lastOn = st.on;
  const tgt = course.plats[idx];
  if (bot.idx !== idx) {
    bot.idx = idx;
    const a = bot.rng.next() * TAU, m = noise * (0.3 + bot.rng.next() * 0.9);
    bot.off = { x: Math.cos(a) * m, z: Math.sin(a) * m };
    bot.early = 1 + noise * (bot.rng.next() - 0.45) * 0.7;               // <1 jumps late, >1 jumps early
    bot.dumb = bot.rng.next() < 0.14 * noise;                              // occasionally just misjudges it badly
    bot.wait = noise * (0.1 + bot.rng.next() * 0.45);                             // little hesitation before the run-up
  }
  if (bot.wait > 0) { bot.wait -= dt; return { axis: 0, jump: false }; }
  const lim = tgt.shape === 'round' ? tgt.r * 0.6 : Math.min(tgt.hw, tgt.hd * 1.6) * 0.55;
  let ax = tgt.x + bot.off.x, az = tgt.z + bot.off.z;
  const ox = ax - tgt.x, oz = az - tgt.z, ol = Math.hypot(ox, oz);
  if (ol > lim) { ax = tgt.x + (ox / ol) * lim; az = tgt.z + (oz / ol) * lim; }
  const dx = ax - st.x, dz = az - st.z, d = Math.hypot(dx, dz);
  const rise = tgt.top - st.stand;
  const vy = C.JUMP_V;
  const disc = vy * vy - 2 * C.GRAV * Math.max(0, rise + 0.05);
  const flight = disc > 0 ? (vy + Math.sqrt(disc)) / C.GRAV : 0.45;
  const reach = C.SPEED * flight;
  let jump = false;
  const cur = st.on >= 0 ? course.plats[st.on] : null;
  const atEdge = cur && !over(cur, st.x + st.vx * 0.09, st.z + st.vz * 0.09, -0.1);   // about to run off: take the jump now
  if (st.grounded && (atEdge || d <= reach * 0.78 * bot.early * (bot.dumb ? 1.35 : 1))) jump = !bot.jumped;
  bot.jumped = jump;
  // left / right = the shorter way round the tower to the aim point's angle (clockwise = +)
  const th = Math.atan2(st.z, st.x), arc = -angDiff(Math.atan2(az, ax), th) * Math.hypot(st.x, st.z);
  return { axis: clamp(arc * 1.5, -1, 1), jump };
}
