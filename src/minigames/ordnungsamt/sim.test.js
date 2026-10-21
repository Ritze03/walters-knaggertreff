import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, MINIGAMES, TIMING } from '../../contracts.js';
import { hostInit, hostStep, hostResult, hostAdopt, stepBody, botFrame, ARENA, C, DURATION_MS } from './sim.js';
import { takeImps } from '../owner.js';

const DT = 1000 / 60;
const init = (seats = [0, 1, 2], seed = 7) => hostInit({ seats, seed, rng: createRng(seed), mode: 'ffa', teams: null });
const frame = (over = {}) => ({ move: { x: 0, y: 0 }, jump: false, action: false, confirm: false, back: false, pressed: { jump: false, action: false, confirm: false, back: false }, ...over });
const pl = (mg, s) => mg.ps.find((p) => p.s === s);
const quiet = (mg) => { mg.vans = []; mg.next = 1e9; return mg; };

/** plays `ms` with every seat steered by its bot; returns the final state */
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
  assert.notDeepEqual(a.ps.map((p) => [p.x, p.y]), c.ps.map((p) => [p.x, p.y]));
});

test('state is plain JSON and carries t + done', () => {
  const mg = init();
  hostStep(mg, {}, DT);
  assert.equal(typeof mg.t, 'number');
  assert.equal(mg.done, false);
  assert.deepEqual(JSON.parse(JSON.stringify(mg)), mg);
});

test('the game ends by durationMs at the latest', () => {
  const mg = init([0, 1]);
  // two sitting ducks that are never hit would idle forever: remove all vans each step
  for (let i = 0; i < 3000 && !mg.done; i++) { hostStep(mg, {}, DT); mg.vans = []; }
  assert.equal(mg.done, true);
  assert.ok(mg.t >= DURATION_MS && mg.t < DURATION_MS + 2 * DT, `t=${mg.t}`);
  assert.equal(hostResult(mg).placements.length, 1, 'both survived with 3 lives and no credits: a tie');
  const stepped = mg.t;
  hostStep(mg, {}, DT);
  assert.equal(mg.t, stepped, 'a finished game does not advance');
});

test('a shove pushes a rival away, stuns them and credits the shover', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 600, y: 400, fx: 1, fy: 0 });
  Object.assign(pl(mg, 1), { x: 640, y: 400 });
  hostStep(mg, { 0: frame({ move: { x: 1, y: 0 }, action: true, pressed: { jump: false, action: true, confirm: false, back: false } }) }, DT);
  assert.ok(pl(mg, 1).stun > 0);
  assert.equal(pl(mg, 1).ls, 0);
  assert.ok(mg.ev.some((e) => e.k === 's' && e.s === 0 && e.o === 1));
  for (let i = 0; i < 30; i++) hostStep(mg, {}, DT);
  assert.ok(pl(mg, 1).x > 640 + 100, `pushed to x=${pl(mg, 1).x}`);
  assert.ok(pl(mg, 0).cd > 0, 'shove has a cooldown');
});

test('a shove needs the cooldown to be over', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 300, y: 300 }); Object.assign(pl(mg, 1), { x: 900, y: 600 });
  const press = frame({ pressed: { jump: false, action: true, confirm: false, back: false } });
  hostStep(mg, { 0: press }, DT);
  const dash = pl(mg, 0).dash;
  for (let i = 0; i < 30; i++) hostStep(mg, {}, DT);          // dash over, cooldown still running
  hostStep(mg, { 0: press }, DT);
  assert.equal(pl(mg, 0).dash, 0, `second press ignored (first dash was ${dash} ms)`);
});

test('a van hit costs a life, grants invulnerability, and shoving someone into it credits the shover', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 600, y: 400 });
  Object.assign(pl(mg, 1), { x: 200, y: 200, ls: 0, lt: mg.t });
  mg.vans.push({ id: 1, w: C.VAN_W, h: C.VAN_T, x: 600, y: 400, vx: 300, vy: 0 });
  mg.vans.push({ id: 2, w: C.VAN_W, h: C.VAN_T, x: 200, y: 200, vx: 300, vy: 0 });
  hostStep(mg, {}, DT);
  assert.equal(pl(mg, 0).lives, C.LIVES - 1);
  assert.ok(pl(mg, 0).inv > 0);
  assert.ok(mg.ev.some((e) => e.k === 'h' && e.s === 0 && e.o === -1));
  assert.equal(pl(mg, 1).lives, C.LIVES - 1);
  assert.equal(pl(mg, 0).cr, 1, 'player 0 shoved player 1 shortly before the van hit');
  assert.ok(mg.ev.some((e) => e.k === 'h' && e.s === 1 && e.o === 0));
  hostStep(mg, {}, DT);
  assert.equal(pl(mg, 0).lives, C.LIVES - 1, 'invulnerable right after a hit');
});

test('at 0 lives you are out, and the last survivor ends the game', () => {
  const mg = quiet(init([0, 1, 2]));
  mg.t = 4000;
  for (const s of [0, 1]) { Object.assign(pl(mg, s), { lives: 1, x: 500 + s * 300, y: 400 }); mg.vans.push({ id: s + 1, w: C.VAN_W, h: C.VAN_T, x: 500 + s * 300, y: 400, vx: 300, vy: 0 }); }
  hostStep(mg, {}, DT);
  assert.notEqual(pl(mg, 0).out, null);
  assert.notEqual(pl(mg, 1).out, null);
  assert.equal(mg.done, true);
  assert.deepEqual(hostResult(mg).placements, [[2], [0, 1]], 'same step out = tie');
});

test('hostResult: alive before out, more lives first, credits break ties, later out is better', () => {
  const mg = init([0, 1, 2, 3, 4]);
  Object.assign(pl(mg, 0), { lives: 2, cr: 0 });
  Object.assign(pl(mg, 1), { lives: 0, out: 5000 });
  Object.assign(pl(mg, 2), { lives: 0, out: 9000 });
  Object.assign(pl(mg, 3), { lives: 3 });
  Object.assign(pl(mg, 4), { lives: 2, cr: 1 });
  const r = hostResult(mg);
  assert.deepEqual(r.placements, [[3], [4], [0], [2], [1]]);
  assert.match(r.labels[1], /kontrolliert nach 5,0 s/);
  assert.match(r.labels[4], /Kollateralschaden/);
});

test('hostResult covers exactly the participants (non-contiguous seats)', () => {
  const mg = playBots([1, 3, 4, 5], 5);
  const r = hostResult(mg);
  assert.deepEqual(r.placements.flat().sort(), [1, 3, 4, 5]);
  assert.equal(new Set(r.placements.flat()).size, 4);
  for (const s of [1, 3, 4, 5]) assert.equal(typeof r.labels[s], 'string');
});

test('bots alone finish a game (6 players, various seeds) and stay inside the arena', () => {
  for (const seed of [1, 2, 3]) {
    const mg = playBots([0, 1, 2, 3, 4, 5], seed);
    assert.equal(mg.done, true, `seed ${seed} not finished at t=${mg.t}`);
    assert.ok(mg.t <= DURATION_MS + 2 * DT);
    for (const p of mg.ps) assert.ok(p.x >= ARENA.x0 && p.x <= ARENA.x1 && p.y >= ARENA.y0 && p.y <= ARENA.y1);
    assert.deepEqual(hostResult(mg).placements.flat().sort(), [0, 1, 2, 3, 4, 5]);
  }
});

test('the bot sidesteps an oncoming van but a van-less bot stays put', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 640, y: 400 });
  const f0 = botFrame(mg, 0, createRng(1));
  assert.deepEqual(f0.move, { x: 0, y: 0 });
  mg.vans.push({ id: 1, w: C.VAN_W, h: C.VAN_T, x: 300, y: 405, vx: 400, vy: 0 });
  const f1 = botFrame(mg, 0, createRng(1));
  assert.equal(f1.move.x, 0);
  assert.notEqual(f1.move.y, 0);
});

test('vans speed up over time and lanes are seeded', () => {
  const early = init([0, 1], 3), late = init([0, 1], 3);
  late.t = 25000;
  for (const m of [early, late]) { m.next = 0; hostStep(m, {}, DT); }
  const speed = (m) => Math.abs(m.vans[0].vx || m.vans[0].vy);
  assert.ok(speed(late) > speed(early) + 100);
  const again = init([0, 1], 3); again.next = 0; hostStep(again, {}, DT);
  assert.deepEqual(again.vans, early.vans);
});

test('ordnungsamt is an arena game in the MINIGAMES table', () => {
  assert.equal(MINIGAMES.ordnungsamt.kind, 'arena');
});

// ---- owner-authoritative movement ----
const shove = (move = { x: 1, y: 0 }) => frame({ move, action: true, pressed: { jump: false, action: true, confirm: false, back: false } });
const report = (p, over = {}) => ({ x: p.x, y: p.y, vx: 0, vy: 0, kx: 0, ky: 0, fx: p.fx, fy: p.fy, dash: 0, cd: 0, stun: 0, dn: p.dn, ack: p.ia, ...over });
const van = (over = {}) => ({ id: 77, w: C.VAN_W, h: C.VAN_T, x: 600, y: 400, vx: 300, vy: 0, ...over });

test('stepBody is the host body math: a one-seat hostStep equals stepBody ticks (and a started shove is reported)', () => {
  const mg = quiet(init([0]));
  const p = pl(mg, 0), c = structuredClone(p);
  let started = 0;
  for (let i = 0; i < 40; i++) {
    const f = i === 5 ? shove({ x: 0.6, y: 0.8 }) : frame({ move: { x: 0.6, y: 0.8 } });
    hostStep(mg, { 0: f }, DT);
    started += stepBody(c, f, DT) ? 1 : 0;
  }
  assert.equal(started, 1);
  for (const k of ['vx', 'vy', 'kx', 'ky']) c[k] = Math.round(c[k] * 10) / 10;
  assert.ok(Math.abs(p.x - c.x) < 1.5 && Math.abs(p.y - c.y) < 1.5, `host ${p.x},${p.y} vs stepBody ${c.x},${c.y}`);
  assert.equal(p.dash, c.dash);
});

test('hostAdopt: whitelists fields, clamps to the arena and sane speeds, never touches host-owned fields', () => {
  const mg = init([0, 1]);
  const p = pl(mg, 0);
  Object.assign(p, { lives: 2, inv: 300, cr: 1, ls: 1, lt: 5, ia: 0 });
  const res = hostAdopt(mg, 0, { x: 99999, y: -5, vx: 5000, vy: -5000, kx: 12.34, ky: 0, fx: 3, fy: -3, dash: 99999, cd: 5, stun: 7, dn: 2, lives: 99, inv: 0, out: 5, cr: 50, ls: 9, lt: 9, s: 1, dh: [1], ia: 77, ot: -1, hax: 1, ack: 0 });
  assert.deepEqual(res, { changed: ['dn'], gated: false });
  assert.deepEqual([p.x, p.y, p.vx, p.vy, p.kx, p.fx, p.fy], [ARENA.x1, ARENA.y0, 1000, -1000, 12.3, 1, -1]);
  assert.equal(p.dash, C.DASH_MS);
  assert.equal(p.dn, 2);
  assert.deepEqual([p.lives, p.inv, p.out, p.cr, p.ls, p.lt, p.s, p.ia, p.dh, 'hax' in p], [2, 300, null, 1, 1, 5, 0, 0, [], false], 'host-owned fields untouched');
  assert.equal(p.ot, mg.t);
});

test('hostAdopt rejects NaN, Infinity and non-numbers field by field', () => {
  const mg = init([0, 1]);
  const p = pl(mg, 0), before = { x: p.x, y: p.y, vx: p.vx };
  hostAdopt(mg, 0, { x: NaN, y: Infinity, vx: '5', vy: null, kx: {}, ky: undefined, fx: [1], dn: NaN, ack: 0 });
  assert.deepEqual({ x: p.x, y: p.y, vx: p.vx }, before);
  assert.equal(p.dn, 0);
  assert.equal(hostAdopt(mg, 0, null), null);
  assert.equal(hostAdopt(mg, 9, report(p)), null, 'unknown seat');
});

test('ack gating: while ack < ia the kinematic fields are ignored, the shove serial still counts; once acked they apply', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 600, y: 400, fx: 1, fy: 0 }); Object.assign(pl(mg, 1), { x: 640, y: 400 });
  hostStep(mg, { 0: shove() }, DT);
  const v = pl(mg, 1);
  assert.equal(v.ia, 1);
  const kx = v.kx, x = v.x;
  const res = hostAdopt(mg, 1, { ...report(v), x: 300, y: 300, kx: 0, ack: 0, dn: 1 });
  assert.equal(res.gated, true);
  assert.deepEqual([v.x, v.kx], [x, kx], 'stale report cannot erase the knockback or the position');
  assert.equal(v.dn, 1, 'serials are not kinematic');
  hostAdopt(mg, 1, { ...report(v), x: 300, y: 300, kx: 5, ack: 1 });
  assert.deepEqual([v.x, v.y, v.kx], [300, 300, 5]);
});

test('a new shove serial (dn) resets dh so the next shove can hit again; an unchanged one does not', () => {
  const mg = quiet(init([0, 1]));
  const p = pl(mg, 0);
  p.dh = [1];
  hostAdopt(mg, 0, report(p));
  assert.deepEqual(p.dh, [1]);
  hostAdopt(mg, 0, report(p, { dn: 1, dash: 180 }));
  assert.deepEqual(p.dh, []);
  // an owned shover hits the rival at the REPORTED position, once per serial
  Object.assign(pl(mg, 1), { x: 640, y: 400 });
  hostAdopt(mg, 0, report(p, { x: 610, y: 400, fx: 1, fy: 0, dn: 1, dash: 180 }));
  hostStep(mg, {}, DT);
  hostStep(mg, {}, DT);
  assert.equal(mg.ev.filter((e) => e.k === 's').length, 1);
  assert.equal(pl(mg, 1).ls, 0, 'the shover is credited');
});

test('an owned seat ignores its input frame; once the owner goes stale (OWN_STALE_MS) the input path takes over again', () => {
  const mg = quiet(init([0, 1]));
  const p = pl(mg, 0);
  Object.assign(p, { x: 400, y: 400 });
  hostAdopt(mg, 0, report(p));
  for (let i = 0; i < 20; i++) hostStep(mg, { 0: shove({ x: 1, y: 0 }) }, DT);
  assert.deepEqual([p.x, p.vx, p.dash, p.cd], [400, 0, 0, 0], 'owned: the input is not used');
  mg.t += TIMING.OWN_STALE_MS + 1;
  hostStep(mg, { 0: frame({ move: { x: 1, y: 0 } }) }, DT);
  assert.ok(p.vx > 0 && p.x > 400, 'stale: driven by input again');
  hostStep(mg, { 0: shove() }, DT);
  assert.ok(p.dash > 0, 'stale: shove start by input works');
});

test('a shove gives the same knockback for an owned and an unowned victim', () => {
  const run = (owned) => {
    const mg = quiet(init([0, 1]));
    Object.assign(pl(mg, 0), { x: 600, y: 400, fx: 1, fy: 0 }); Object.assign(pl(mg, 1), { x: 640, y: 400 });
    if (owned) hostAdopt(mg, 1, report(pl(mg, 1)));
    hostStep(mg, { 0: shove() }, DT);
    const v = pl(mg, 1);
    return { kx: v.kx, ky: v.ky, stun: v.stun, ls: v.ls };
  };
  const a = run(false), b = run(true);
  assert.deepEqual(a, b);
  assert.ok(a.kx > 1000 && a.stun > 300 && a.ls === 0);
});

test('pushImp entry shape from a shove: {i, s, kx, ky, st, dc, t}, dc 0, victim ia = i, nothing for the shover', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 600, y: 400, fx: 1, fy: 0 }); Object.assign(pl(mg, 1), { x: 640, y: 400 });
  hostStep(mg, { 0: shove() }, DT);
  assert.equal(mg.imp.length, 1);
  const e = mg.imp[0];
  assert.deepEqual(Object.keys(e).sort(), ['dc', 'i', 'kx', 'ky', 's', 'st', 't']);
  assert.deepEqual([e.i, e.s, e.st, e.dc], [1, 1, C.SHOVE_STUN_MS, 0]);
  assert.ok(Math.abs(e.kx - C.SHOVE_KB) < 1 && Math.abs(e.ky) < 1);
  assert.equal(mg.iid, 1);
  assert.equal(pl(mg, 1).ia, 1);
  assert.equal(pl(mg, 0).ia, 0);
  assert.deepEqual(takeImps(JSON.parse(JSON.stringify(mg)), 1, 0).list.map((x) => x.i), [1]);
  assert.equal(takeImps(mg, 0, 0).list.length, 0);
  assert.deepEqual(takeImps(mg, 1, null), { list: [], last: 1 });
});

test('a van hit on an owned seat costs a life and is delivered as a dc:1 impulse (stun + knockback, cancels the dash)', () => {
  const mg = quiet(init([0, 1]));
  const p = pl(mg, 0);
  Object.assign(p, { x: 600, y: 400 }); Object.assign(pl(mg, 1), { x: 200, y: 200 });
  hostAdopt(mg, 0, report(p, { dn: 1, dash: 120 }));
  mg.vans.push(van());
  hostStep(mg, {}, DT);
  assert.equal(p.lives, C.LIVES - 1);
  assert.equal(p.inv, C.INV_MS);
  assert.equal(mg.imp.length, 1);
  const e = mg.imp[0];
  assert.deepEqual([e.s, e.dc, e.st, e.kx, e.ky], [0, 1, C.HIT_STUN_MS, C.VAN_KB, 0]);
  assert.equal(p.ia, e.i);
  assert.equal(p.dash, 0, 'the host copy lost its shove too');
  assert.equal(p.stun, C.HIT_STUN_MS);
  assert.ok(p.kx > 0);
  // a report from before the hit (ack 0) cannot undo it
  hostAdopt(mg, 0, report(p, { ack: 0, kx: 0, dash: 120, x: 500 }));
  assert.ok(p.kx > 0 && p.dash === 0 && p.x > 500);
  // the owner: takeImps hands the hit over
  const got = takeImps(JSON.parse(JSON.stringify(mg)), 0, 0);
  assert.deepEqual(got.list.map((x) => [x.kx, x.dc]), [[C.VAN_KB, 1]]);
});

test('a van hit gives the same result for an owned and an unowned victim', () => {
  const run = (owned) => {
    const mg = quiet(init([0, 1]));
    Object.assign(pl(mg, 0), { x: 600, y: 400 }); Object.assign(pl(mg, 1), { x: 200, y: 200 });
    if (owned) hostAdopt(mg, 0, report(pl(mg, 0)));
    mg.vans.push(van({ vx: 0, vy: -300 }));
    hostStep(mg, {}, DT);
    const v = pl(mg, 0);
    return { kx: v.kx, ky: v.ky, stun: v.stun, dash: v.dash, lives: v.lives, inv: v.inv };
  };
  assert.deepEqual(run(false), run(true));
  assert.equal(run(true).ky, -C.VAN_KB);
});

test('the van that eliminates an owner sets out; the eliminated owner\'s reports are then ignored for position', () => {
  const mg = quiet(init([0, 1, 2]));
  const p = pl(mg, 0);
  Object.assign(p, { x: 600, y: 400, lives: 1 });
  hostAdopt(mg, 0, report(p));
  mg.vans.push(van());
  hostStep(mg, {}, DT);
  assert.notEqual(p.out, null);
  assert.equal(mg.ev.filter((e) => e.k === 'o').length, 1);
  const at = { x: p.x, y: p.y, kx: p.kx, ot: p.ot };
  assert.equal(hostAdopt(mg, 0, report(p, { ack: p.ia, x: 100, y: 100, kx: 99, vx: 500, dn: 5 })), null);
  assert.deepEqual({ x: p.x, y: p.y, kx: p.kx, ot: p.ot }, at);
  assert.equal(p.dn, 0);
  for (let i = 0; i < 10; i++) hostStep(mg, {}, DT);
  assert.deepEqual([p.x, p.y], [at.x, at.y], 'an out player no longer moves');
});

test('an owned shove into a rival who is then hit by a van still credits the shover (collateral damage)', () => {
  const mg = quiet(init([0, 1]));
  const a = pl(mg, 0), b = pl(mg, 1);
  Object.assign(a, { x: 600, y: 300, fx: 1, fy: 0 }); Object.assign(b, { x: 640, y: 300 });
  hostAdopt(mg, 0, report(a, { dn: 1, dash: 180 }));
  hostAdopt(mg, 1, report(b));
  hostStep(mg, {}, DT);
  assert.equal(b.ls, 0);
  mg.vans.push(van({ x: b.x, y: b.y, w: 20, h: C.VAN_W, vx: 0, vy: 1 }));
  hostStep(mg, {}, DT);
  assert.equal(b.lives, C.LIVES - 1);
  assert.equal(a.cr, 1);
  assert.equal(mg.imp.length, 2, 'shove + van hit, both delivered');
  assert.equal(mg.imp[1].dc, 1);
});

test('the soft separation does not move an owned seat; an unowned neighbour still takes its half', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 400, y: 400 }); Object.assign(pl(mg, 1), { x: 420, y: 400 });
  hostAdopt(mg, 0, report(pl(mg, 0)));
  hostStep(mg, {}, DT);
  assert.equal(pl(mg, 0).x, 400);
  assert.equal(pl(mg, 1).x, 420 + (2 * C.R - 20) / 2);
});
