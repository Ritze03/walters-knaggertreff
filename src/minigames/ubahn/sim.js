// "U-Bahn-Surfers": the pure rules (no Kaplay, no three, no Math.random). Every client builds the SAME track from the shared seed and runs
// its own runner on it; the result is distance + a Pfand bonus. Units are metres / seconds. The runner moves along +dist; the 3D scene puts
// dist on the -z axis (see world.js).

export const DURATION_MS = 35000;
export const LANE_W = 2.4;                 // distance between lane centres
export const LANES = 3;
export const STUMBLE_T = 1.4;              // seconds of stumble after a hit (speed dips to 25 % and recovers linearly); a hit also costs 4 s of speed ramp and 3 bottles
export const BOTTLE_BONUS = 3;             // metres of score per Pfand bottle
export const JUMP_V = 9.5;
export const GRAVITY = 28;
export const STAND_H = 1.5;
export const SLIDE_H = 0.6;
export const SLIDE_T = 0.65;
export const LANE_SPEED = 24;              // m/s sideways: one lane in 0.1 s
const HALF_Z = 0.35, HALF_X = 0.4;
export const SPAWN_GAP = 120;              // an oncoming train appears (out of the fog, with a horn) this many metres ahead of the runner
export const PARKED_SHARE = 0.25;          // share of train rows that stand still instead (no roof / climb mechanic: they are just a wall in that lane)
const r4 = (n) => Math.round(n * 10000) / 10000;

/** Obstacle kinds: hw = half width (x), len (z, along the track), [y0, y1] = vertical extent. lane-dodge always works; `jump` / `slide` = also passable that way. */
export const KINDS = {
  controller: { hw: 0.5, len: 0.9, y0: 0, y1: 2.0 },
  pillar: { hw: 0.55, len: 1.1, y0: 0, y1: 8 },
  scooter: { hw: 0.95, len: 0.7, y0: 0, y1: 0.55, jump: true },
  crate: { hw: 0.6, len: 1.0, y0: 0, y1: 0.9, jump: true },
  train: { hw: 1.0, len: 14, y0: 0, y1: 3.6 },
  gate: { hw: 1.1, len: 0.8, y0: 0.9, y1: 3.0, slide: true },
};

export const laneX = (lane) => (lane - 1) * LANE_W;

/** Speed in m/s after t seconds of running, before any stumble. */
export const baseSpeed = (t) => 12 + 0.38 * t;

/**
 * The whole track: obstacles + Pfand bottles, both sorted by d (metres from the start). Pure function of the rng.
 * An obstacle with `v > 0` (only trains) is an ONCOMING train: `d` is where it spawns (front face, SPAWN_GAP ahead of the runner when it
 * does) and from then on its front is at d - v * (sim time since the spawn), see frontOf(). With v = 0 it stands still at d.
 */
export function makeTrack(rng, length = 1500) {
  const obstacles = [], bottles = [];
  let oid = 0, bid = 0;
  const obs = (type, lane, d) => { const o = { id: oid++, type, lane, d: r4(d), len: KINDS[type].len, v: 0 }; obstacles.push(o); return o; };
  const line = (lane, d, n, y = 0.9) => { for (let i = 0; i < n; i++) bottles.push({ id: bid++, lane, d: d + i * 2.4, y }); return d + (n - 1) * 2.4; };
  const lerp = (a, b, f) => a + (b - a) * f;
  const sample = (list) => list[Math.floor(rng.next() * list.length)];
  let d = 38, lastFree = 1;
  while (d < length) {
    const f = Math.min(1, d / 700);
    const lanes = [0, 1, 2];
    let end = d;
    const r = rng.next();
    const easy = d < 120;
    if (r < 0.2 || (easy && r < 0.45)) {
      // one blocker, a few bottles in a neighbouring lane
      const lane = sample(lanes);
      obs(sample(['controller', 'pillar', 'scooter', 'crate']), lane, d);
      const free = sample(lanes.filter((l) => l !== lane));
      end = Math.max(end, line(free, d - 6, 4 + rng.int(0, 3)));
      lastFree = free;
    } else if (r < 0.46) {
      // two blockers, one open lane (with a bottle line as the reward for choosing right)
      const free = sample(lanes);
      const kinds = f < 0.15 ? ['controller', 'pillar', 'crate'] : ['controller', 'pillar', 'scooter', 'crate'];
      for (const l of lanes) if (l !== free) obs(sample(kinds), l, d + rng.next() * 2);
      end = Math.max(end, line(free, d - 4, 5 + rng.int(0, 3)));
      lastFree = free;
    } else if (r < 0.58) {
      // jump row: a scooter / crate wall across all lanes, bottles floating over it
      const type = sample(['scooter', 'crate']);
      for (const l of lanes) obs(type, l, d);
      for (let i = -1; i <= 1; i++) bottles.push({ id: bid++, lane: 1, d: d + i * 2.2, y: 1.7 });
      end = d + 2.2;
    } else if (r < 0.68 && f > 0.08) {
      // gate row: duck under the barrier
      for (const l of lanes) obs('gate', l, d);
      for (let i = -1; i <= 1; i++) bottles.push({ id: bid++, lane: 1, d: d + i * 2.2, y: 0.55 });
      end = d + 2.2;
    } else if (r < 0.88 && f > 0.1) {
      // oncoming train(s) in one or two lanes
      const two = f > 0.3 && rng.next() < 0.45;
      const free = sample(lanes);
      const taken = lanes.filter((l) => l !== free);
      const blocked = two ? taken : [sample(taken)];
      for (const l of blocked) {
        const dm = d + (two ? 0 : rng.next() * 2);        // where the runner is meant to meet it
        const v = rng.next() < PARKED_SHARE ? 0 : r4(8 + rng.next() * 5 + f * 3);
        // closing speed ~ runner + v, so over SPAWN_GAP the train covers ~ v / (runner + v) ~ 0.42 of it: spawn that far behind the meeting point
        obs('train', l, v ? dm + SPAWN_GAP * 0.42 : dm).v = v;
      }
      const open = lanes.filter((l) => !blocked.includes(l));
      end = Math.max(end, line(sample(open), d - 2, 6 + rng.int(0, 2)));
      if (!two) { const l = blocked[0]; const o = sample(lanes.filter((x) => x !== l)); obs('controller', o, d + 20); end = Math.max(end, d + 21); }
      end = Math.max(end, d + KINDS.train.len);
      lastFree = open[0];
    } else {
      // Pfand snake: bottles zig-zagging across the lanes, no obstacles
      let lane = lastFree, dd = d;
      for (let seg = 0; seg < 4; seg++) {
        dd = line(lane, dd, 3 + rng.int(0, 1)) + 2.4;
        lane = Math.max(0, Math.min(2, lane + sample([-1, 1])));
      }
      end = dd;
    }
    d = end + lerp(30, 19, f) + rng.next() * 7;
  }
  obstacles.sort((a, b) => a.d - b.d);
  bottles.sort((a, b) => a.d - b.d);
  return { obstacles, bottles, length };
}

export function createRun(track) {
  return {
    track, t: 0, te: 0, dist: 0, speed: baseSpeed(0), lane: 1, x: 0, y: 0, vy: 0, slide: 0, stumble: 0, bottles: 0, hits: 0, done: false,
    oi: 0, bi: 0, taken: new Set(), hitSet: new Set(), lastHit: null,
    spawned: new Map(), active: [],   // oncoming trains: id -> sim time of the spawn; the spawned ones that may still touch the runner
  };
}

/** Where the front face of an obstacle is right now (m); null = an oncoming train that has not spawned yet. A pure function of sim time. */
export function frontOf(st, o) {
  if (!o.v) return o.d;
  const ta = st.spawned.get(o.id);
  return ta === undefined ? null : r4(o.d - o.v * (st.t - ta));
}

/** Cheap stand-in for the thumbnails, which only know the remote runner's distance: assumes ~18 m/s of runner speed. */
export const approxFront = (o, dist, runnerV = 18) => (!o.v ? o.d : dist < o.d - SPAWN_GAP ? null : o.d - o.v * ((dist - (o.d - SPAWN_GAP)) / runnerV));

export const score = (st) => Math.round(st.dist) + st.bottles * BOTTLE_BONUS;
export const heightOf = (st) => (st.slide > 0 && st.y <= 0.001 ? SLIDE_H : STAND_H);

const stumbleMul = (st) => (st.stumble > 0 ? 0.25 + 0.75 * (1 - st.stumble / STUMBLE_T) : 1);

/**
 * One fixed step. `inp` = { dx: -1|0|1 (change lane), jump: bool, slide: bool }, applied once. Returns events:
 * { k: 'lane'|'jump'|'slide'|'land'|'bottle'|'hit', type? }.
 */
export function step(st, dt, inp = {}) {
  const ev = [];
  if (st.done) return ev;
  const { obstacles, bottles } = st.track;
  // --- input
  if (inp.dx) {
    const nl = Math.max(0, Math.min(LANES - 1, st.lane + inp.dx));
    if (nl !== st.lane) { st.lane = nl; ev.push({ k: 'lane', dx: inp.dx }); }
  }
  if (inp.jump && st.y <= 0.001) { st.vy = JUMP_V; st.y = 0.002; st.slide = 0; ev.push({ k: 'jump' }); }
  if (inp.slide) {
    if (st.y > 0.001) st.vy = Math.min(st.vy, -16);   // fast fall
    st.slide = SLIDE_T;
    ev.push({ k: 'slide' });
  }
  // --- motion
  st.t += dt;
  st.te += dt;
  st.speed = baseSpeed(st.te) * stumbleMul(st);
  st.stumble = Math.max(0, st.stumble - dt);
  st.slide = Math.max(0, st.slide - dt);
  const tx = laneX(st.lane);
  st.x += Math.max(-LANE_SPEED * dt, Math.min(LANE_SPEED * dt, tx - st.x));
  if (st.y > 0.001 || st.vy > 0) {
    st.vy -= GRAVITY * dt;
    st.y += st.vy * dt;
    if (st.y <= 0) { st.y = 0; st.vy = 0; ev.push({ k: 'land' }); }
  }
  st.dist += st.speed * dt;
  // --- oncoming trains: spawn at the far end, then drive towards the runner
  for (let i = st.oi; i < obstacles.length && obstacles[i].d < st.dist + SPAWN_GAP; i++) {
    const o = obstacles[i];
    if (o.v > 0 && !st.spawned.has(o.id)) { st.spawned.set(o.id, st.t); st.active.push(o); ev.push({ k: 'train', id: o.id, lane: o.lane, v: o.v }); }
  }
  // --- collisions (obstacles) with the player's box: x +-HALF_X, z +-HALF_Z, y [y, y+h]
  const h = heightOf(st);
  const touch = (o, a) => {
    if (st.hitSet.has(o.id)) return;
    const kd = KINDS[o.type];
    if (st.dist + HALF_Z < a || st.dist - HALF_Z > a + o.len) return;
    if (Math.abs(st.x - laneX(o.lane)) >= kd.hw + HALF_X) return;
    if (st.y >= kd.y1 || st.y + h <= kd.y0) return;
    st.hitSet.add(o.id);
    st.hits++;
    st.stumble = STUMBLE_T;
    st.lastHit = o.type;
    st.te = Math.max(0, st.te - 4);
    st.bottles -= Math.min(3, st.bottles);
    ev.push({ k: 'hit', type: o.type, id: o.id });
  };
  while (st.oi < obstacles.length && obstacles[st.oi].d + obstacles[st.oi].len < st.dist - HALF_Z - 1) st.oi++;
  for (let i = st.oi; i < obstacles.length && obstacles[i].d < st.dist + HALF_Z + 1; i++) if (!obstacles[i].v) touch(obstacles[i], obstacles[i].d);
  for (let j = st.active.length - 1; j >= 0; j--) {
    const o = st.active[j], a = frontOf(st, o);
    if (a + o.len < st.dist - HALF_Z - 3) { st.active.splice(j, 1); continue; }
    touch(o, a);
  }
  // --- bottles
  while (st.bi < bottles.length && bottles[st.bi].d < st.dist - 3) st.bi++;
  for (let i = st.bi; i < bottles.length && bottles[i].d < st.dist + 1; i++) {
    const b = bottles[i];
    if (st.taken.has(b.id)) continue;
    if (Math.abs(b.d - st.dist) > 0.9 || Math.abs(st.x - laneX(b.lane)) > 1.0) continue;
    if (b.y < st.y - 0.3 || b.y > st.y + h + 0.2) continue;
    st.taken.add(b.id);
    st.bottles++;
    ev.push({ k: 'bottle', id: b.id });
  }
  if (st.t >= DURATION_MS / 1000) st.done = true;
  return ev;
}

/** Real frame time -> fixed 1/60 substeps (so a slow GPU does not change collisions). Input is applied on the first substep. */
export function advance(st, dtReal, inp) {
  const events = [];
  let left = Math.min(dtReal, 0.5);
  let first = true;
  while (left > 1e-6 && !st.done) {
    const dt = Math.min(1 / 60, left);
    events.push(...step(st, dt, first ? inp : {}));
    first = false;
    left -= dt;
  }
  return events;
}

/**
 * What lies ahead, per lane: the most urgent obstacle whose rear end is still in front of the player and the number of bottles in reach.
 * Returns an array of 3 { gap, egap, eta, type, jump, slide, clear, v } (gap = metres to the front face right now; v = its speed towards us,
 * 0 for everything that stands still; eta = seconds until it reaches us; egap = eta * our own speed, i.e. "gap as if it stood still" = the
 * time-to-collision in metres, which is what a bot should compare against its reaction distance; clear = nothing within `range`).
 * Oncoming trains count once they have spawned and their front is within `range`.
 */
export function lookahead(st, range = 60) {
  const out = Array.from({ length: LANES }, () => ({ gap: Infinity, egap: Infinity, eta: Infinity, type: null, jump: false, slide: false, clear: true, bottles: 0, v: 0, o: null }));
  const { obstacles, bottles } = st.track;
  const sp = Math.max(1, st.speed);
  const see = (o, front) => {
    if (st.hitSet.has(o.id) || front + o.len < st.dist - HALF_Z) return;
    const slot = out[o.lane];
    const gap = Math.max(0, front - st.dist), v = o.v || 0;
    const eta = gap / (sp + v);
    if (eta < slot.eta) { const kd = KINDS[o.type]; Object.assign(slot, { gap, egap: eta * sp, eta, type: o.type, jump: !!kd.jump, slide: !!kd.slide, clear: false, v, o }); }
  };
  for (let i = st.oi; i < obstacles.length && obstacles[i].d < st.dist + range; i++) if (!obstacles[i].v) see(obstacles[i], obstacles[i].d);
  for (const o of st.active) { const f = frontOf(st, o); if (f < st.dist + range) see(o, f); }
  for (let i = st.bi; i < bottles.length && bottles[i].d < st.dist + range * 0.6; i++) {
    const b = bottles[i];
    if (!st.taken.has(b.id) && b.d > st.dist - 1) out[b.lane].bottles++;
  }
  return out;
}
