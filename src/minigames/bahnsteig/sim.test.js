import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, MINIGAMES, TIMING } from '../../contracts.js';
import { takeImps } from '../owner.js';
import { hostInit, hostStep, hostResult, hostAdopt, stepBody, stepAir, gustAt, botFrame, tileAt, tileCenter, C, GW, GH, HALF_W, HALF_H, DURATION_MS } from './sim.js';

const DT = 1000 / 60;
const init = (seats = [0, 1, 2], seed = 7) => hostInit({ seats, seed, rng: createRng(seed), mode: 'ffa', teams: null });
const frame = (over = {}) => ({ move: { x: 0, y: 0 }, jump: false, action: false, confirm: false, back: false, pressed: { jump: false, action: false, confirm: false, back: false }, ...over });
const press = frame({ pressed: { jump: false, action: true, confirm: false, back: false } });
const pl = (mg, s) => mg.ps.find((p) => p.s === s);
/** no patterns, no ICE: only what the test sets up happens */
const quiet = (mg) => { mg.next = 1e9; mg.iceNext = 1e9; return mg; };

function playBots(seats, seed, ms = DURATION_MS + 1000) {
  const mg = init(seats, seed);
  const rngs = Object.fromEntries(seats.map((s) => [s, createRng(seed + s)]));
  for (let i = 0; i < Math.ceil(ms / DT) && !mg.done; i++) {
    hostStep(mg, Object.fromEntries(seats.map((s) => [s, botFrame(mg, s, rngs[s])])), DT);
  }
  return mg;
}

test('the sim is deterministic: same seed + same inputs => identical state', () => {
  const a = playBots([0, 1, 2, 3], 99), b = playBots([0, 1, 2, 3], 99), c = playBots([0, 1, 2, 3], 100);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.notDeepEqual(a.tw, c.tw);
});

test('state is plain JSON and carries t + done; everybody starts on a tile', () => {
  const mg = init([0, 1, 2, 3, 4, 5]);
  hostStep(mg, {}, DT);
  assert.equal(typeof mg.t, 'number');
  assert.equal(mg.done, false);
  assert.deepEqual(JSON.parse(JSON.stringify(mg)), mg);
  assert.equal(mg.tw.length, GW * GH);
  for (const p of mg.ps) assert.ok(tileAt(p.x, p.z) >= 0, `seat ${p.s} spawns on the platform`);
});

test('a pattern is announced, makes tiles wobble, and they fall when the timer is up', () => {
  const mg = init([0, 1]);
  mg.next = 0; mg.iceNext = 1e9;
  hostStep(mg, {}, DT);
  const ann = mg.ev.find((e) => e.k === 'a');
  assert.ok(ann, 'announcement event');
  assert.ok(ann.n > 0);
  const wobbling = mg.tw.filter((x) => x > 0).length;
  assert.equal(wobbling, ann.n);
  mg.next = 1e9;
  for (let i = 0; i < 150 && mg.tw.some((x) => x > 0); i++) hostStep(mg, {}, DT);
  assert.equal(mg.tw.filter((x) => x === -1).length, ann.n, 'every wobbling tile fell');
  assert.equal(mg.tw.filter((x) => x > 0).length, 0);
});

test('standing on a tile that falls drops you out (after the coyote time); walking off the platform too', () => {
  const mg = quiet(init([0, 1, 2]));
  Object.assign(pl(mg, 0), { x: 0, z: 0 });
  Object.assign(pl(mg, 1), { x: 6, z: 0 });
  Object.assign(pl(mg, 2), { x: -6, z: 3 });
  mg.tw[tileAt(0, 0)] = 100;
  for (let i = 0; i < 30; i++) hostStep(mg, { 1: frame({ move: { x: 1, y: 0 } }) }, DT);
  assert.notEqual(pl(mg, 0).out, null, 'tile fell under player 0');
  assert.ok(pl(mg, 0).out >= 100 + C.COYOTE_MS - DT);
  assert.equal(pl(mg, 2).out, null);
  for (let i = 0; i < 120; i++) hostStep(mg, { 1: frame({ move: { x: 1, y: 0 } }) }, DT);
  assert.notEqual(pl(mg, 1).out, null, 'ran off the east edge');
  assert.ok(pl(mg, 1).x > HALF_W);
  assert.ok(pl(mg, 0).y < -1, 'keeps falling after being out');
  assert.ok(pl(mg, 0).y >= C.FLOOR_Y, 'but lands on the track bed');
});

test('a short hop over the coyote time does not kill you', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: -0.9, z: 0.1, vx: -5 });
  mg.tw[tileAt(-0.9, 0.1)] = -1;                      // the tile you stand on is already gone, but the adjacent one is not
  for (let i = 0; i < 12; i++) hostStep(mg, { 0: frame({ move: { x: -1, y: 0 } }) }, DT);
  assert.ok(pl(mg, 0).x < -1, 'made it over');
  assert.equal(pl(mg, 0).out, null);
  assert.equal(pl(mg, 0).air, 0);
});

test('a shove knocks a rival away, stuns them, and credits the shover when they then fall', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 5.2, z: 0, fx: 1, fz: 0 });
  Object.assign(pl(mg, 1), { x: 6.4, z: 0 });
  hostStep(mg, { 0: frame({ move: { x: 1, y: 0 }, action: true, pressed: { jump: false, action: true, confirm: false, back: false } }) }, DT);
  assert.ok(pl(mg, 1).stun > 0);
  assert.equal(pl(mg, 1).ls, 0);
  assert.ok(mg.ev.some((e) => e.k === 's' && e.s === 0 && e.o === 1));
  for (let i = 0; i < 90 && pl(mg, 1).out === null; i++) hostStep(mg, {}, DT);
  assert.notEqual(pl(mg, 1).out, null, 'knocked off the edge');
  assert.equal(pl(mg, 0).ko, 1);
  assert.ok(mg.ev.some((e) => e.k === 'o' && e.s === 1 && e.by === 0) || pl(mg, 1).out !== null);
});

test('a shove needs the cooldown to be over; jump (A) also shoves', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: -3, z: 0 }); Object.assign(pl(mg, 1), { x: 3, z: 3 });
  hostStep(mg, { 0: press }, DT);
  assert.ok(pl(mg, 0).dash > 0);
  for (let i = 0; i < 30; i++) hostStep(mg, {}, DT);          // dash over, cooldown still running
  hostStep(mg, { 0: press }, DT);
  assert.equal(pl(mg, 0).dash, 0, 'second press ignored while on cooldown');
  for (let i = 0; i < 60; i++) hostStep(mg, {}, DT);
  hostStep(mg, { 0: frame({ pressed: { jump: true, action: false, confirm: false, back: false } }) }, DT);
  assert.ok(pl(mg, 0).dash > 0, 'jump press shoves too');
});

test('the ICE: warning first, then its suction drags players towards its track', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 0, z: 0 }); Object.assign(pl(mg, 1), { x: 3, z: 0 });
  mg.iceNext = 0;
  hostStep(mg, {}, DT);
  assert.ok(mg.ice && mg.ice.w === 0, 'warning phase');
  assert.ok(mg.ev.some((e) => e.k === 'i'));
  const side = mg.ice.side, z0 = pl(mg, 0).z;
  for (let i = 0; i < 100; i++) hostStep(mg, {}, DT);          // 1.7 s: still warning, no push
  assert.equal(pl(mg, 0).z, z0);
  let started = false;
  for (let i = 0; i < 200 && !started; i++) { hostStep(mg, {}, DT); started = mg.ice?.w === 1; }
  assert.ok(started, 'the ICE rushes through after the warning');
  const mid = [];
  for (let i = 0; i < 70 && mg.ice; i++) { hostStep(mg, {}, DT); mid.push(pl(mg, 0).z); }
  assert.ok((pl(mg, 0).z - z0) * side > 0.5 || pl(mg, 0).out !== null, `dragged towards side ${side}: z=${pl(mg, 0).z}`);
  for (let i = 0; i < 200 && mg.ice; i++) hostStep(mg, {}, DT);
  assert.equal(mg.ice, null, 'the ICE leaves again');
});

test('the last survivor ends the game after a short outro, and hovers safely meanwhile', () => {
  const mg = quiet(init([0, 1, 2]));
  mg.t = 4000;
  Object.assign(pl(mg, 0), { x: 0, z: 0 });
  Object.assign(pl(mg, 1), { x: 12, z: 0 });
  Object.assign(pl(mg, 2), { x: -12, z: 0 });
  for (let i = 0; i < 20; i++) hostStep(mg, {}, DT);
  assert.notEqual(pl(mg, 1).out, null); assert.notEqual(pl(mg, 2).out, null);
  assert.equal(mg.done, false, 'outro still running');
  mg.tw[tileAt(0, 0)] = -1;
  for (let i = 0; i < 20; i++) hostStep(mg, {}, DT);
  assert.equal(pl(mg, 0).out, null, 'the winner does not fall during the outro');
  for (let i = 0; i < 120; i++) hostStep(mg, {}, DT);
  assert.equal(mg.done, true);
  assert.deepEqual(hostResult(mg).placements[0], [0]);
});

test('the game ends by durationMs at the latest; survivors tie for first', () => {
  const mg = quiet(init([0, 1, 2]));
  for (let i = 0; i < 3000 && !mg.done; i++) hostStep(mg, {}, DT);
  assert.equal(mg.done, true);
  assert.ok(mg.t >= DURATION_MS && mg.t < DURATION_MS + 2 * DT, `t=${mg.t}`);
  assert.deepEqual(hostResult(mg).placements, [[0, 1, 2]], 'everybody survived: one big tie');
  const stepped = mg.t;
  hostStep(mg, {}, DT);
  assert.equal(mg.t, stepped, 'a finished game does not advance');
});

test('hostResult: survivors first (tied), then later out is better, equal times tie', () => {
  const mg = init([0, 1, 2, 3, 4]);
  Object.assign(pl(mg, 0), { out: 5000, ko: 2 });
  Object.assign(pl(mg, 1), { out: 9000 });
  Object.assign(pl(mg, 3), { out: 5000 });
  const r = hostResult(mg);
  assert.deepEqual(r.placements, [[2, 4], [1], [0, 3]]);
  assert.match(r.labels[0], /abgefahren nach 5,0 s/);
  assert.match(r.labels[0], /2× rausgeschubst/);
  assert.match(r.labels[2], /noch auf dem Bahnsteig/);
});

test('hostResult covers exactly the participants (non-contiguous seats)', () => {
  const mg = playBots([1, 3, 4, 5], 5);
  const r = hostResult(mg);
  assert.deepEqual(r.placements.flat().sort(), [1, 3, 4, 5]);
  assert.equal(new Set(r.placements.flat()).size, 4);
  for (const s of [1, 3, 4, 5]) assert.equal(typeof r.labels[s], 'string');
});

test('bots alone finish a game (2, 4 and 6 players, various seeds) with a winner most of the time', () => {
  let decided = 0, games = 0;
  for (const n of [2, 4, 6]) for (const seed of [1, 2, 3]) {
    const seats = [...Array(n).keys()];
    const mg = playBots(seats, seed);
    assert.equal(mg.done, true, `n=${n} seed ${seed} not finished at t=${mg.t}`);
    assert.ok(mg.t <= DURATION_MS + 2 * DT);
    assert.deepEqual(hostResult(mg).placements.flat().sort(), seats);
    games++; if (hostResult(mg).placements[0].length === 1) decided++;
  }
  assert.ok(decided >= games - 2, `${decided}/${games} games had a single winner`);
});

test('the bot leaves a wobbling tile for a stable one, and stands still on a quiet platform', () => {
  const mg = quiet(init([0]));
  Object.assign(pl(mg, 0), { x: 0.1, z: 0.1 });
  const idle = botFrame(mg, 0, createRng(1));
  assert.ok(Math.hypot(idle.move.x, idle.move.y) < 0.99, 'content on its tile');
  mg.tw[tileAt(0.1, 0.1)] = 100;                          // about to fall (past any reaction time)
  const f = botFrame(mg, 0, createRng(1));
  assert.ok(Math.hypot(f.move.x, f.move.y) > 0.9, 'runs');
  // simulate: it survives the fall
  for (let i = 0; i < 90; i++) hostStep(mg, { 0: botFrame(mg, 0, createRng(1)) }, DT);
  assert.equal(pl(mg, 0).out, null);
  assert.equal(mg.tw[tileAt(0.1, 0.1)], -1);
});

test('the bot shoves a rival standing at the brink', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 5.0, z: 0 });
  Object.assign(pl(mg, 1), { x: 6.8, z: 0 });
  let pressed = false;
  const rng = createRng(3);
  for (let i = 0; i < 200 && !pressed; i++) pressed = botFrame(mg, 0, rng).pressed.action;
  assert.ok(pressed);
});

test('bahnsteig is an arena game in the MINIGAMES table', () => {
  assert.equal(MINIGAMES.bahnsteig.kind, 'arena');
  assert.ok(tileCenter(0).x < 0);
});

// ---- owner-authoritative movement ----
const report = (p, over = {}) => ({ x: p.x, z: p.z, vx: 0, vz: 0, kx: 0, kz: 0, fx: p.fx, fz: p.fz, dash: 0, cd: 0, stun: 0, air: 0, dn: p.dn, ack: p.ia, ...over });
const run = (mg, n, inputs = {}) => { for (let i = 0; i < n; i++) hostStep(mg, inputs, DT); };

test('stepBody is the host body math: a one-seat hostStep equals stepBody ticks (and a started dash is reported)', () => {
  const mg = quiet(init([0]));
  const p = pl(mg, 0), c = structuredClone(p);
  let started = 0;
  for (let i = 0; i < 40; i++) {
    const f = i === 5 ? frame({ move: { x: 0.6, y: 0.8 }, pressed: { jump: false, action: true, confirm: false, back: false } }) : frame({ move: { x: 0.6, y: 0.8 } });
    hostStep(mg, { 0: f }, DT);
    started += stepBody(c, f, DT) ? 1 : 0;
  }
  assert.equal(started, 1);
  assert.ok(Math.abs(p.x - c.x) < 0.05 && Math.abs(p.z - c.z) < 0.05, `host ${p.x},${p.z} vs stepBody ${c.x},${c.z}`);
  assert.equal(p.dash, c.dash);
  assert.ok(mg.ev.some((e) => e.k === 'd' && e.s === 0), 'the host announces an input-driven dash');
});

test('stepBody applies the ICE gust towards its side, and gustAt extrapolates the ICE linearly', () => {
  const a = { x: 0, z: 0, vx: 0, vz: 0, kx: 0, kz: 0, fx: 1, fz: 0, dash: 0, cd: 0, stun: 0, air: 0 };
  stepBody(a, frame(), 100, { gust: 1, side: -1 });
  assert.ok(a.z < -0.3, `dragged towards side -1: z=${a.z}`);
  const b = { ...a, z: 0 };
  stepBody(b, frame(), 100, { gust: 0, side: -1 });
  assert.equal(b.z, 0);
  assert.deepEqual(gustAt(null), { amt: 0, side: 0 });
  assert.deepEqual(gustAt({ w: 0, x: 0, dir: 1, side: 1 }), { amt: 0, side: 0 }, 'no suction during the warning');
  const ice = { w: 1, x: -20, dir: 1, side: 1 };
  const g0 = gustAt(ice, 0), g1 = gustAt(ice, 0.25);   // 0.25 s * 48 = 12 units closer to the middle
  assert.equal(g0.side, 1);
  assert.ok(g1.amt > g0.amt && g1.amt <= 1);
  assert.ok(Math.abs(g1.amt - (1 - 8 / (HALF_W + 16))) < 1e-9);
});

test('stepAir counts the coyote time against the tiles it is given', () => {
  const tw = new Array(GW * GH).fill(0);
  tw[tileAt(0, 0)] = -1;
  const p = { x: 0, z: 0, air: 0 };
  stepAir(p, tw, 50); stepAir(p, tw, 50);
  assert.equal(p.air, 100);
  stepAir(p, tw, 50, true);
  assert.equal(p.air, 0, 'frozen (the winner hovers)');
  stepAir(p, tw, 50);
  Object.assign(p, { x: 3, z: 3 });
  stepAir(p, tw, 50);
  assert.equal(p.air, 0, 'solid ground again');
});

test('hostAdopt: whitelists fields, clamps to the platform and sane speeds, never touches host-owned fields', () => {
  const mg = init([0, 1]);
  const p = pl(mg, 0);
  Object.assign(p, { ko: 2, ls: 1, lt: 77, ia: 0, y: 0 });
  const res = hostAdopt(mg, 0, { x: 99999, z: -99999, vx: 500, vz: -500, kx: 12.345, kz: 0, fx: 3, fz: -3, dash: 99999, cd: 5, stun: 7, air: 3, dn: 2, out: 5, ko: 99, ls: 5, lt: 5, y: -9, vy: 4, dh: [1], ia: 77, s: 1, ot: -1, hax: 1, ack: 0 });
  assert.deepEqual(res, { changed: ['dn'], gated: false });
  assert.deepEqual([p.x, p.z, p.vx, p.vz, p.kx, p.fx, p.fz], [HALF_W + 6, -HALF_H - 6, C.DASH_SPEED + 1, -C.DASH_SPEED - 1, 12.35, 1, -1]);
  assert.equal(p.dash, C.DASH_MS);
  assert.equal(p.dn, 2);
  assert.deepEqual([p.out, p.ko, p.ls, p.lt, p.y, p.vy, p.dh, p.ia, p.s, 'hax' in p], [null, 2, 1, 77, 0, 0, [], 0, 0, false], 'host-owned fields untouched');
  assert.equal(p.ot, mg.t);
});

test('hostAdopt rejects NaN, Infinity and non-numbers field by field', () => {
  const mg = init([0, 1]);
  const p = pl(mg, 0), before = { x: p.x, z: p.z, vx: p.vx, air: p.air };
  hostAdopt(mg, 0, { x: NaN, z: Infinity, vx: '5', vz: null, kx: {}, kz: undefined, fx: [1], air: NaN, dn: NaN, ack: 0 });
  assert.deepEqual({ x: p.x, z: p.z, vx: p.vx, air: p.air }, before);
  assert.equal(p.dn, 0);
  assert.equal(hostAdopt(mg, 0, null), null);
  assert.equal(hostAdopt(mg, 9, report(p)), null, 'unknown seat');
});

test('air adoption: taken as reported, clamped to 0..COYOTE_MS, rounded', () => {
  const mg = quiet(init([0, 1]));
  const p = pl(mg, 0);
  hostAdopt(mg, 0, report(p, { air: 80.46 }));
  assert.equal(p.air, 80.5);
  hostAdopt(mg, 0, report(p, { air: 99999 }));
  assert.equal(p.air, C.COYOTE_MS, 'an absurd air is clamped to the coyote time, not beyond');
  hostAdopt(mg, 0, report(p, { air: -50 }));
  assert.equal(p.air, 0);
});

test('ack gating: while ack < ia the kinematic fields (incl. air) are ignored, the dash serial still counts; once acked they apply', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 4, z: 0, fx: 1, fz: 0 }); Object.assign(pl(mg, 1), { x: 5.2, z: 0 });
  hostStep(mg, { 0: press }, DT);
  const v = pl(mg, 1);
  assert.equal(v.ia, 1);
  const kx = v.kx, x = v.x;
  const res = hostAdopt(mg, 1, { ...report(v), x: -3, z: 3, kx: 0, air: 100, ack: 0, dn: 1 });
  assert.equal(res.gated, true);
  assert.deepEqual([v.x, v.kx, v.air], [x, kx, 0], 'a report from before the shove cannot erase the knockback or the position');
  assert.equal(v.dn, 1, 'serials are not kinematic');
  hostAdopt(mg, 1, { ...report(v), x: -3, z: 3, kx: 5, ack: 1 });
  assert.deepEqual([v.x, v.z, v.kx], [-3, 3, 5]);
});

test('a new dash serial (dn) resets dh and announces the dash; an unchanged one does not; the owned dasher shoves at the REPORTED position, once per serial', () => {
  const mg = quiet(init([0, 1]));
  const p = pl(mg, 0);
  p.dh = [1];
  hostAdopt(mg, 0, report(p));
  assert.deepEqual(p.dh, [1]);
  assert.equal(mg.ev.filter((e) => e.k === 'd').length, 0);
  hostAdopt(mg, 0, report(p, { dn: 1, dash: 200 }));
  assert.deepEqual(p.dh, []);
  assert.equal(mg.ev.filter((e) => e.k === 'd' && e.s === 0).length, 1);
  Object.assign(pl(mg, 1), { x: 1.2, z: 0 });
  hostAdopt(mg, 0, report(p, { x: 0, z: 0, fx: 1, fz: 0, dn: 1, dash: 200 }));
  run(mg, 2);
  assert.equal(mg.ev.filter((e) => e.k === 's').length, 1, 'one shove per dash serial');
});

test('an owned seat ignores its input frame; once the owner goes stale (OWN_STALE_MS) the input path takes over again', () => {
  const mg = quiet(init([0, 1]));
  const p = pl(mg, 0);
  Object.assign(p, { x: 0, z: 0 });
  hostAdopt(mg, 0, report(p));
  run(mg, 20, { 0: press });
  assert.deepEqual([p.x, p.vx, p.dash, p.cd], [0, 0, 0, 0], 'owned: the input is not used');
  mg.t += TIMING.OWN_STALE_MS + 1;
  hostStep(mg, { 0: frame({ move: { x: 1, y: 0 } }) }, DT);
  assert.ok(p.vx > 0 && p.x > 0, 'stale: driven by input again');
  hostStep(mg, { 0: press }, DT);
  assert.ok(p.dash > 0, 'stale: dash start by input works');
});

test('a shove gives the same knockback for an owned and an unowned victim, cancels the dash and sets the credit', () => {
  const go = (owned) => {
    const mg = quiet(init([0, 1]));
    Object.assign(pl(mg, 0), { x: 4, z: 0, fx: 1, fz: 0 }); Object.assign(pl(mg, 1), { x: 5.2, z: 0.3 });
    if (owned) hostAdopt(mg, 1, report(pl(mg, 1)));
    hostStep(mg, { 0: press }, DT);
    const v = pl(mg, 1);
    return { kx: v.kx, kz: v.kz, stun: v.stun, dash: v.dash, ls: v.ls, lt: v.lt };
  };
  const a = go(false), b = go(true);
  assert.deepEqual(a, b);
  assert.ok(a.kx > 10 && a.kz > 0.5 && a.stun === C.SHOVE_STUN_MS && a.dash === 0 && a.ls === 0);
});

test('a shove cancels the victim\'s dash (dc), owned or not', () => {
  for (const owned of [false, true]) {
    const mg = quiet(init([0, 1]));
    Object.assign(pl(mg, 0), { x: 4, z: 0, fx: 1, fz: 0 }); Object.assign(pl(mg, 1), { x: 5.2, z: 0 });
    if (owned) hostAdopt(mg, 1, report(pl(mg, 1), { dash: 150, dn: 1, vx: -13 }));
    else pl(mg, 1).dash = 150;
    hostStep(mg, { 0: press }, DT);
    assert.equal(pl(mg, 1).dash, 0, `owned=${owned}`);
    assert.equal(mg.imp[0].dc, 1);
  }
});

test('pushImp entry shape from a shove: {i, s, kx, ky(=z axis), st, dc:1, t}, victim ia = i, no stray ky on the player, nothing for the shover', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 4, z: 0, fx: 1, fz: 0 }); Object.assign(pl(mg, 1), { x: 5.2, z: 0 });
  hostStep(mg, { 0: press }, DT);
  assert.equal(mg.imp.length, 1);
  const e = mg.imp[0];
  assert.deepEqual(Object.keys(e).sort(), ['dc', 'i', 'kx', 'ky', 's', 'st', 't']);
  assert.deepEqual([e.i, e.s, e.st, e.dc], [1, 1, C.SHOVE_STUN_MS, 1]);
  assert.ok(Math.abs(e.kx - C.SHOVE_KB) < 0.2 && Math.abs(e.ky) < 0.2);
  assert.equal(mg.iid, 1);
  assert.equal(pl(mg, 1).ia, 1);
  assert.equal(pl(mg, 0).ia, 0);
  assert.equal('ky' in pl(mg, 1), false, 'the z axis is kz on a bahnsteig player');
  assert.deepEqual(takeImps(JSON.parse(JSON.stringify(mg)), 1, 0).list.map((x) => x.i), [1]);
  assert.equal(takeImps(mg, 0, 0).list.length, 0);
  assert.deepEqual(takeImps(mg, 1, null), { list: [], last: 1 });
});

test('the soft separation does not move an owned seat; an unowned neighbour still takes its half', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 0, z: 0 }); Object.assign(pl(mg, 1), { x: 0.6, z: 0 });
  hostAdopt(mg, 0, report(pl(mg, 0)));
  hostStep(mg, {}, DT);
  assert.equal(pl(mg, 0).x, 0);
  assert.equal(pl(mg, 1).x, 0.6 + (2 * C.R - 0.6) / 2);
});

test('an owned seat falls when its adopted air reaches COYOTE_MS over a fallen tile', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 0, z: 0 });
  mg.tw[tileAt(0, 0)] = -1;
  hostAdopt(mg, 0, report(pl(mg, 0), { air: C.COYOTE_MS - 20 }));
  hostStep(mg, {}, DT);
  assert.equal(pl(mg, 0).out, null, 'not yet');
  hostAdopt(mg, 0, report(pl(mg, 0), { air: C.COYOTE_MS }));
  hostStep(mg, {}, DT);
  assert.notEqual(pl(mg, 0).out, null, 'adopted air at the coyote time => out');
  assert.ok(mg.ev.some((e) => e.k === 'o' && e.s === 0 && e.by === -1));
});

test('KEY RULE: an owned seat is not eliminated just because the HOST tile is gone - it falls only on the owner\'s air', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 0, z: 0 });
  mg.tw[tileAt(0, 0)] = -1;
  for (let i = 0; i < 40; i++) { hostAdopt(mg, 0, report(pl(mg, 0), { air: 0 })); hostStep(mg, {}, DT); }   // 0.66 s over a hole, but the owner still sees solid ground
  assert.equal(pl(mg, 0).out, null);
  assert.equal(pl(mg, 0).air, 0);
});

test('an owned seat\'s air is reset when the host\'s own tile under the reported position is solid', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 0, z: 0 });
  hostAdopt(mg, 0, report(pl(mg, 0), { air: 100 }));
  hostStep(mg, {}, DT);
  assert.equal(pl(mg, 0).air, 0);
});

test('a stale owner still falls: after OWN_STALE_MS the host\'s own ground check takes over', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 0, z: 0 });
  hostAdopt(mg, 0, report(pl(mg, 0)));
  mg.tw[tileAt(0, 0)] = -1;
  run(mg, Math.floor(TIMING.OWN_STALE_MS / DT) - 3);
  assert.equal(pl(mg, 0).out, null, 'a silent but still-fresh owner is trusted for a while');
  run(mg, Math.ceil((C.COYOTE_MS + 100) / DT) + 6);
  assert.notEqual(pl(mg, 0).out, null, 'stale: the host counted the air itself');
  assert.ok(pl(mg, 0).out >= TIMING.OWN_STALE_MS, `fell at ${pl(mg, 0).out}`);
});

test('a never-reporting seat falls exactly as before (host ground check)', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 0, z: 0 });
  mg.tw[tileAt(0, 0)] = -1;
  run(mg, 20);
  assert.ok(pl(mg, 0).out >= C.COYOTE_MS - DT && pl(mg, 0).out <= C.COYOTE_MS + 2 * DT, `out=${pl(mg, 0).out}`);
});

test('a fallen seat ignores further owner reports (the fall is host decoration)', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 0, z: 0 });
  mg.tw[tileAt(0, 0)] = -1;
  hostAdopt(mg, 0, report(pl(mg, 0), { air: C.COYOTE_MS }));
  hostStep(mg, {}, DT);
  const out = pl(mg, 0).out;
  assert.notEqual(out, null);
  const at = { x: pl(mg, 0).x, z: pl(mg, 0).z };
  const res = hostAdopt(mg, 0, report(pl(mg, 0), { x: 5, z: 3, air: 0 }));
  assert.deepEqual(res, { changed: [], gated: false });
  assert.deepEqual({ x: pl(mg, 0).x, z: pl(mg, 0).z, out: pl(mg, 0).out }, { ...at, out });
  run(mg, 60);
  assert.ok(pl(mg, 0).y < -1 && pl(mg, 0).y >= C.FLOOR_Y, 'still falls to the track bed');
});

test('the shove-fall credit works with owners: shoved off the edge, the victim\'s owner reports the fall, the shover gets the ko', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 6.4, z: 0, fx: 1, fz: 0 });
  Object.assign(pl(mg, 1), { x: 7.6, z: 0 });
  hostAdopt(mg, 0, report(pl(mg, 0)));
  hostAdopt(mg, 1, report(pl(mg, 1)));
  hostAdopt(mg, 0, report(pl(mg, 0), { dn: 1, dash: 200, fx: 1, fz: 0 }));
  hostStep(mg, {}, DT);
  const v = pl(mg, 1);
  assert.equal(v.ls, 0, 'credit recorded when the shove lands');
  assert.equal(mg.imp.length, 1);
  assert.equal(mg.imp[0].dc, 1);
  // the victim's client applies the impulse, flies off the edge, sees no tile, counts its air and reports it (acking the impulse)
  const ack = mg.imp[0].i;
  let air = 0;
  for (let i = 0; i < 90 && v.out === null; i++) {
    air = v.x > HALF_W ? air + DT : 0;   // what the owner counts against its snapshot's tiles
    hostAdopt(mg, 0, report(pl(mg, 0)));
    hostAdopt(mg, 1, { ...report(v), kx: v.kx, kz: v.kz, ack, air });
    hostStep(mg, {}, DT);
  }
  assert.notEqual(v.out, null, 'fell');
  assert.equal(pl(mg, 0).ko, 1, 'the shover is credited');
  assert.ok(mg.ev.some((e) => e.k === 'o' && e.s === 1 && e.by === 0));
});

test('the outro: an owned winner reporting a coyote-time air is not dropped while it hovers', () => {
  const mg = quiet(init([0, 1]));
  mg.t = 4000;
  Object.assign(pl(mg, 0), { x: 0, z: 0 });
  Object.assign(pl(mg, 1), { x: 12, z: 0 });
  run(mg, 20);
  assert.notEqual(pl(mg, 1).out, null);
  assert.ok(mg.endAt > 0);
  mg.tw[tileAt(0, 0)] = -1;
  for (let i = 0; i < 20; i++) { hostAdopt(mg, 0, report(pl(mg, 0), { air: C.COYOTE_MS })); hostStep(mg, {}, DT); }
  assert.equal(pl(mg, 0).out, null);
});

test('the ICE gust also moves an owned seat on the host between reports (dead reckoning keeps the gust)', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 0, z: 0 });
  hostAdopt(mg, 0, report(pl(mg, 0)));
  mg.ice = { side: 1, dir: 1, x: 0, w: 1, tl: 0 };
  const z0 = pl(mg, 0).z;
  hostStep(mg, {}, DT);
  assert.ok(pl(mg, 0).z > z0, 'dragged towards the ICE side');
});
