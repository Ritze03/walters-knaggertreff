import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, MINIGAMES } from '../../contracts.js';
import { hostInit, hostStep, hostResult, hostAdopt, stepBody, botFrame, spillAmount, fmtAura, ARENA, C, DURATION_MS } from './sim.js';
import { takeImps } from '../owner.js';
import { TIMING } from '../../contracts.js';
import LINES from './lines.js';

const DT = 1000 / 60;
const init = (seats = [0, 1, 2], seed = 7) => hostInit({ seats, seed, rng: createRng(seed), mode: 'ffa', teams: null });
const frame = (over = {}) => ({ move: { x: 0, y: 0 }, jump: false, action: false, confirm: false, back: false, pressed: { jump: false, action: false, confirm: false, back: false }, ...over });
const bump = (move = { x: 1, y: 0 }) => frame({ move, action: true, pressed: { jump: false, action: true, confirm: false, back: false } });
const pl = (mg, s) => mg.ps.find((p) => p.s === s);
const quiet = (mg) => { mg.orbs = []; mg.next = 1e9; return mg; };
const orb = (over = {}) => ({ id: 900 + Math.floor(Math.random() * 1e6), v: 100, g: 0, x: 0, y: 0, vx: 0, vy: 0, ex: -1, exm: 0, ttl: 0, ...over });
const total = (mg) => mg.ps.reduce((a, p) => a + p.aura, 0) + mg.orbs.reduce((a, o) => a + o.v, 0);

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
  assert.equal(mg.orbs.length >= C.START_ORBS, true, 'the yard starts with orbs');
});

test('the game ends by durationMs and a finished game does not advance', () => {
  const mg = init([0, 1]);
  for (let i = 0; i < 3000 && !mg.done; i++) hostStep(mg, {}, DT);
  assert.equal(mg.done, true);
  assert.ok(mg.t >= DURATION_MS && mg.t < DURATION_MS + 2 * DT, `t=${mg.t}`);
  const stepped = mg.t;
  hostStep(mg, {}, DT);
  assert.equal(mg.t, stepped);
});

test('walking over an orb collects it, emits a pickup event and removes the orb', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 400, y: 400 }); Object.assign(pl(mg, 1), { x: 1000, y: 600 });
  mg.orbs.push(orb({ id: 1, x: 410, y: 400, v: 200 }), orb({ id: 2, x: 700, y: 300 }));
  hostStep(mg, {}, DT);
  assert.equal(pl(mg, 0).aura, 200);
  assert.deepEqual(mg.orbs.map((o) => o.id), [2]);
  assert.ok(mg.ev.some((e) => e.k === 'p' && e.s === 0 && e.v === 200 && e.g === 0));
});

test('a golden Sigma orb is worth +1000 and expires after its lifetime', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 400, y: 400 }); Object.assign(pl(mg, 1), { x: 1000, y: 600 });
  mg.orbs.push(orb({ id: 1, x: 400, y: 400, v: C.GOLD_VALUE, g: 1, ttl: C.GOLD_TTL_MS }), orb({ id: 2, x: 800, y: 200, v: C.GOLD_VALUE, g: 1, ttl: 50 }));
  hostStep(mg, {}, DT);
  assert.equal(pl(mg, 0).aura, 1000);
  assert.ok(mg.ev.some((e) => e.k === 'p' && e.g === 1));
  for (let i = 0; i < 5; i++) hostStep(mg, {}, DT);
  assert.equal(mg.orbs.length, 0, 'the unclaimed gold orb faded away');
});

test('orbs keep spawning (capped) and gold is guaranteed after 12 s', () => {
  const mg = init([0, 1, 2]);
  let sawGold = mg.orbs.some((o) => o.g);
  let max = 0;
  for (let i = 0; i < 1500; i++) { hostStep(mg, {}, DT); max = Math.max(max, mg.orbs.length); sawGold ||= mg.orbs.some((o) => o.g); mg.orbs = mg.orbs.filter((o) => !o.g || sawGold); }
  assert.ok(sawGold, 'a golden orb appeared');
  assert.ok(max <= C.ORB_CAP_BASE + C.ORB_CAP_PER_PLAYER * 3 + 8, `orb count stayed sane (${max})`);
  assert.ok(mg.orbs.length > 0);
});

test('spillAmount: 30% rounded to hundreds, at least 100, at most what you have', () => {
  assert.equal(spillAmount(0), 0);
  assert.equal(spillAmount(100), 100);
  assert.equal(spillAmount(200), 100);
  assert.equal(spillAmount(1000), 300);
  assert.equal(spillAmount(2000), 600);
  for (const a of [100, 300, 700, 1300, 4100]) assert.ok(spillAmount(a) <= a && spillAmount(a) % 100 === 0);
});

test('a bump knocks the rival back, stuns them and makes them spill aura as orbs (aura is conserved)', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 600, y: 400, fx: 1, fy: 0 });
  Object.assign(pl(mg, 1), { x: 640, y: 400, aura: 1000 });
  hostStep(mg, { 0: bump() }, DT);
  const v = pl(mg, 1);
  assert.ok(v.stun > 0);
  assert.equal(v.aura, 700);
  assert.equal(mg.orbs.reduce((a, o) => a + o.v, 0) + pl(mg, 0).aura, 300, 'the spill is on the floor, or already in the bumper\'s pocket');
  assert.ok(mg.orbs.every((o) => o.ex === 1 && o.exm > 0), 'spill is locked for the victim');
  assert.ok(mg.ev.some((e) => e.k === 'b' && e.s === 0 && e.o === 1 && e.l === 300));
  assert.equal(total(mg), 1000);
  for (let i = 0; i < 30; i++) hostStep(mg, {}, DT);
  assert.ok(pl(mg, 1).x > 640 + 100, `pushed to x=${pl(mg, 1).x}`);
  assert.ok(pl(mg, 0).cd > 0, 'bump has a cooldown');
});

test('the victim cannot re-take their own spill until the lock ends, the bumper can', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 200, y: 200 }); Object.assign(pl(mg, 1), { x: 640, y: 400 });
  mg.orbs.push(orb({ id: 1, x: 640, y: 400, ex: 1, exm: 500 }));
  hostStep(mg, {}, DT);
  assert.equal(pl(mg, 1).aura, 0, 'locked for the owner');
  for (let i = 0; i < 40; i++) hostStep(mg, {}, DT);
  assert.equal(pl(mg, 1).aura, 100, 'free for the owner after the lock');
});

test('a fresh victim is bump-proof for a moment; bumping a broke player spills nothing; aura never goes negative', () => {
  const mg = quiet(init([0, 1, 2]));
  Object.assign(pl(mg, 0), { x: 600, y: 400, fx: 1, fy: 0 });
  Object.assign(pl(mg, 1), { x: 640, y: 400, aura: 100, binv: 300 });
  Object.assign(pl(mg, 2), { x: 1200, y: 650 });
  hostStep(mg, { 0: bump() }, DT);
  assert.equal(pl(mg, 1).aura, 100, 'still protected');
  assert.equal(mg.orbs.length, 0);
  const mg2 = quiet(init([0, 1]));
  Object.assign(pl(mg2, 0), { x: 600, y: 400, fx: 1, fy: 0 }); Object.assign(pl(mg2, 1), { x: 640, y: 400 });
  hostStep(mg2, { 0: bump() }, DT);
  assert.equal(pl(mg2, 1).aura, 0);
  assert.equal(mg2.orbs.length, 0);
  assert.ok(mg2.ev.some((e) => e.k === 'b' && e.l === 0));
});

test('the jump button (A / Space) bumps too', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 600, y: 400, fx: 1, fy: 0 });
  hostStep(mg, { 0: frame({ pressed: { jump: true, action: false, confirm: false, back: false } }) }, DT);
  assert.ok(pl(mg, 0).dash > 0);
});

test('one bump hits each rival once; the cooldown stops a second bump', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 600, y: 400, fx: 1, fy: 0 }); Object.assign(pl(mg, 1), { x: 640, y: 400, aura: 2000 });
  hostStep(mg, { 0: bump() }, DT);
  for (let i = 0; i < 12; i++) hostStep(mg, {}, DT);
  assert.equal(mg.ev.filter((e) => e.k === 'b').length, 1);
  Object.assign(pl(mg, 1), { binv: 0 });
  const dash = pl(mg, 0).dash;
  hostStep(mg, { 0: bump() }, DT);
  assert.equal(pl(mg, 0).dash, Math.max(0, dash - DT), 'second press ignored while cooling down');
});

test('hostResult: most aura first, equal aura ties, labels use German thousands dots', () => {
  const mg = init([0, 1, 2, 3, 4]);
  [1200, 300, 300, 5000, 0].forEach((a, i) => { mg.ps[i].aura = a; });
  const r = hostResult(mg);
  assert.deepEqual(r.placements, [[3], [0], [1, 2], [4]]);
  assert.equal(r.labels[3], '5.000 Aura');
  assert.equal(r.labels[4], '0 Aura');
  assert.equal(fmtAura(1234567), '1.234.567');
});

test('hostResult covers exactly the participants (non-contiguous seats)', () => {
  const mg = playBots([1, 3, 4, 5], 5);
  const r = hostResult(mg);
  assert.deepEqual(r.placements.flat().sort(), [1, 3, 4, 5]);
  for (const s of [1, 3, 4, 5]) assert.equal(typeof r.labels[s], 'string');
});

test('bots alone finish a game (2 and 6 players, several seeds), stay inside the arena, farm aura and spread the placements', () => {
  for (const seats of [[0, 1], [0, 1, 2, 3, 4, 5]]) for (const seed of [1, 2, 3]) {
    const mg = playBots(seats, seed);
    assert.equal(mg.done, true, `seed ${seed} not finished at t=${mg.t}`);
    for (const p of mg.ps) { assert.ok(p.x >= ARENA.x0 && p.x <= ARENA.x1 && p.y >= ARENA.y0 && p.y <= ARENA.y1); assert.ok(p.aura >= 0); }
    assert.ok(mg.ps.every((p) => p.aura > 0), `every bot farmed some aura (seed ${seed}, ${seats.length}p): ${mg.ps.map((p) => p.aura)}`);
    assert.deepEqual(hostResult(mg).placements.flat().sort(), seats);
  }
  assert.ok(hostResult(playBots([0, 1, 2, 3], 11)).placements.length > 1, 'not everybody ties');
});

test('bots bump each other at some point of a game', () => {
  let bumps = 0;
  const seats = [0, 1, 2, 3];
  const mg = init(seats, 4);
  const rngs = Object.fromEntries(seats.map((s) => [s, createRng(4 + s)]));
  for (let i = 0; i < 2000 && !mg.done; i++) {
    hostStep(mg, Object.fromEntries(seats.map((s) => [s, botFrame(mg, s, rngs[s])])), DT);
    bumps += mg.ev.filter((e) => e.k === 'b' && e.t === mg.t && e.l > 0).length;
  }
  assert.ok(bumps >= 1, 'at least one real aura-stealing bump');
});

test('the bot walks to the nearest orb and bumps a close, rich rival', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 300, y: 400 }); Object.assign(pl(mg, 1), { x: 1100, y: 650 });
  mg.orbs.push(orb({ id: 1, x: 500, y: 400 }), orb({ id: 2, x: 300, y: 650 }), orb({ id: 3, x: 100, y: 120 }));
  const f = botFrame(mg, 0, createRng(1));
  assert.ok(f.move.x > 0.5, `heads right toward the orb at 500,400 (move=${JSON.stringify(f.move)})`);
  assert.equal(f.pressed.action, false);
  // rich rival right next to the bot: eventually it bumps
  mg.orbs = [];
  Object.assign(pl(mg, 1), { x: 340, y: 400, aura: 3000 });
  const r = createRng(2);
  let bumped = false;
  for (let i = 0; i < 60 && !bumped; i++) bumped = botFrame(mg, 0, r).pressed.action;
  assert.ok(bumped, 'bot bumps a rich neighbour');
  // a poor rival is left alone
  Object.assign(pl(mg, 1), { aura: 0 });
  const r2 = createRng(2);
  for (let i = 0; i < 60; i++) assert.equal(botFrame(mg, 0, r2).pressed.action, false);
});

test('golden orbs are a magnet for the bot', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 300, y: 400 }); Object.assign(pl(mg, 1), { x: 1100, y: 650 });
  mg.orbs.push(orb({ id: 1, x: 400, y: 400 }), orb({ id: 2, x: 500, y: 150, v: 1000, g: 1, ttl: 5000 }));
  assert.ok(botFrame(mg, 0, createRng(1)).move.y < -0.3, 'goes up to the gold one');
});

test('lines.js: 4-10 voice lines overall, German, short, no brackets', () => {
  const all = Object.values(LINES).flat();
  assert.ok(all.length >= 4 && all.length <= 20);
  for (const l of all) { assert.ok(l.length <= 60); assert.ok(!/[\[\]]/.test(l)); }
  assert.ok(LINES.gold.includes('Plus tausend Aura!'));
});

test('aura is an arena game in the MINIGAMES table', () => {
  assert.equal(MINIGAMES.aura.kind, 'arena');
});

// ---- owner-authoritative movement ----
const report = (p, over = {}) => ({ x: p.x, y: p.y, vx: 0, vy: 0, kx: 0, ky: 0, fx: p.fx, fy: p.fy, dash: 0, cd: 0, stun: 0, dn: p.dn, ack: p.ia, ...over });

test('stepBody is the host body math: a one-seat hostStep equals stepBody ticks (and a started dash is reported)', () => {
  const mg = quiet(init([0]));
  const p = pl(mg, 0), c = structuredClone(p);
  let started = 0;
  for (let i = 0; i < 40; i++) {
    const f = i === 5 ? bump({ x: 0.6, y: 0.8 }) : frame({ move: { x: 0.6, y: 0.8 } });
    hostStep(mg, { 0: f }, DT);
    started += stepBody(c, f, DT) ? 1 : 0;
  }
  assert.equal(started, 1);
  for (const k of ['vx', 'vy', 'kx', 'ky']) c[k] = Math.round(c[k] * 10) / 10;
  assert.ok(Math.abs(p.x - c.x) < 0.2 && Math.abs(p.y - c.y) < 0.2, `host ${p.x},${p.y} vs stepBody ${c.x},${c.y}`);
  assert.equal(p.dash, c.dash);
});

test('hostAdopt: whitelists fields, clamps to the arena and sane speeds, never touches host-owned fields', () => {
  const mg = init([0, 1]);
  const p = pl(mg, 0);
  Object.assign(p, { aura: 500, binv: 300, ia: 0 });
  const res = hostAdopt(mg, 0, { x: 99999, y: -5, vx: 5000, vy: -5000, kx: 12.34, ky: 0, fx: 3, fy: -3, dash: 99999, cd: 5, stun: 7, dn: 2, aura: 99999, binv: 0, s: 1, dh: [1], ia: 77, ot: -1, hax: 1, ack: 0 });
  assert.deepEqual(res, { changed: ['dn'], gated: false });
  assert.deepEqual([p.x, p.y, p.vx, p.vy, p.kx, p.fx, p.fy], [ARENA.x1, ARENA.y0, 1000, -1000, 12.3, 1, -1]);
  assert.equal(p.dash, C.DASH_MS);
  assert.equal(p.dn, 2);
  assert.deepEqual([p.aura, p.binv, p.s, p.ia, p.dh, 'hax' in p], [500, 300, 0, 0, [], false], 'host-owned fields untouched');
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

test('ack gating: while ack < ia the kinematic fields are ignored, the dash serial still counts; once acked they apply', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 600, y: 400, fx: 1, fy: 0 }); Object.assign(pl(mg, 1), { x: 640, y: 400 });
  hostStep(mg, { 0: bump() }, DT);
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

test('a new dash serial (dn) resets dh so the next dash can hit again; an unchanged one does not', () => {
  const mg = quiet(init([0, 1]));
  const p = pl(mg, 0);
  p.dh = [1];
  hostAdopt(mg, 0, report(p));
  assert.deepEqual(p.dh, [1]);
  hostAdopt(mg, 0, report(p, { dn: 1, dash: 180 }));
  assert.deepEqual(p.dh, []);
  // owned dasher hits the rival at the REPORTED position, once per serial
  Object.assign(pl(mg, 1), { x: 640, y: 400 });
  hostAdopt(mg, 0, report(p, { x: 610, y: 400, fx: 1, fy: 0, dn: 1, dash: 180 }));
  hostStep(mg, {}, DT);
  hostStep(mg, {}, DT);
  assert.equal(mg.ev.filter((e) => e.k === 'b').length, 1);
});

test('an owned seat ignores its input frame; once the owner goes stale (OWN_STALE_MS) the input path takes over again', () => {
  const mg = quiet(init([0, 1]));
  const p = pl(mg, 0);
  Object.assign(p, { x: 400, y: 400 });
  hostAdopt(mg, 0, report(p));
  for (let i = 0; i < 20; i++) hostStep(mg, { 0: bump({ x: 1, y: 0 }) }, DT);
  assert.deepEqual([p.x, p.vx, p.dash, p.cd], [400, 0, 0, 0], 'owned: the input is not used');
  mg.t += TIMING.OWN_STALE_MS + 1;
  hostStep(mg, { 0: frame({ move: { x: 1, y: 0 } }) }, DT);
  assert.ok(p.vx > 0 && p.x > 400, 'stale: driven by input again');
  hostStep(mg, { 0: bump() }, DT);
  assert.ok(p.dash > 0, 'stale: dash start by input works');
});

test('a bump gives the same knockback for an owned and an unowned victim, and equals the old in-place write', () => {
  const run = (owned) => {
    const mg = quiet(init([0, 1]));
    Object.assign(pl(mg, 0), { x: 600, y: 400, fx: 1, fy: 0 }); Object.assign(pl(mg, 1), { x: 640, y: 400, aura: 1000 });
    if (owned) hostAdopt(mg, 1, report(pl(mg, 1)));
    hostStep(mg, { 0: bump() }, DT);
    const v = pl(mg, 1);
    return { kx: v.kx, ky: v.ky, stun: v.stun, aura: v.aura, binv: v.binv };
  };
  const a = run(false), b = run(true);
  assert.deepEqual(a, b);
  assert.ok(a.kx > 1000 && a.stun > 300 && a.aura === 700);
});

test('pushImp entry shape from a bump: {i, s, kx, ky, st, dc, t}, victim ia = i, nothing for the bumper', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 600, y: 400, fx: 1, fy: 0 }); Object.assign(pl(mg, 1), { x: 640, y: 400 });
  hostStep(mg, { 0: bump() }, DT);
  assert.equal(mg.imp.length, 1);
  const e = mg.imp[0];
  assert.deepEqual(Object.keys(e).sort(), ['dc', 'i', 'kx', 'ky', 's', 'st', 't']);
  assert.deepEqual([e.i, e.s, e.st, e.dc], [1, 1, C.BUMP_STUN_MS, 0]);
  assert.ok(Math.abs(e.kx - C.BUMP_KB) < 1 && Math.abs(e.ky) < 1);
  assert.equal(mg.iid, 1);
  assert.equal(pl(mg, 1).ia, 1);
  assert.equal(pl(mg, 0).ia, 0);
  // the victim side: takeImps hands it over once; a (re)mounted client replays nothing
  assert.deepEqual(takeImps(JSON.parse(JSON.stringify(mg)), 1, 0).list.map((x) => x.i), [1]);
  assert.equal(takeImps(mg, 0, 0).list.length, 0);
  assert.deepEqual(takeImps(mg, 1, null), { list: [], last: 1 });
});

test('the soft separation does not move an owned seat; an unowned neighbour still takes its half', () => {
  const mg = quiet(init([0, 1]));
  Object.assign(pl(mg, 0), { x: 400, y: 400 }); Object.assign(pl(mg, 1), { x: 420, y: 400 });
  hostAdopt(mg, 0, report(pl(mg, 0)));
  hostStep(mg, {}, DT);
  assert.equal(pl(mg, 0).x, 400);
  assert.equal(pl(mg, 1).x, 420 + (2 * C.R - 20) / 2);
});
