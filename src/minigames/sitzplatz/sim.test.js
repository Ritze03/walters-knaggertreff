import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, MINIGAMES, TIMING } from '../../contracts.js';
import { hostInit, hostStep, hostResult, hostAdopt, stepBody, botFrame, counts, pushOutTables, SEATS, SEAT_COUNT, TABLES, TABLE, ARENA, C, DURATION_MS } from './sim.js';
import { takeImps } from '../owner.js';

const DT = 1000 / 60;
const TEAMS4 = [[0, 2], [1, 3]];
const init = (seats = [0, 1, 2, 3], teams = TEAMS4, seed = 7) => hostInit({ seats, seed, rng: createRng(seed), mode: 'team', teams });
const frame = (over = {}) => ({ move: { x: 0, y: 0 }, jump: false, action: false, confirm: false, back: false, pressed: { jump: false, action: false, confirm: false, back: false }, ...over });
const pl = (mg, s) => mg.ps.find((p) => p.s === s);
const away = (mg) => { mg.sc.x = 1200; mg.sc.pz = 1e9; return mg; };   // parks the Schaffner far from the test spots

function playBots(seats, teams, seed, ms = DURATION_MS + 1000) {
  const mg = init(seats, teams, seed);
  const rngs = Object.fromEntries(seats.map((s) => [s, createRng(seed + s)]));
  const mems = Object.fromEntries(seats.map((s) => [s, {}]));
  for (let i = 0; i < Math.ceil(ms / DT) && !mg.done; i++) {
    hostStep(mg, Object.fromEntries(seats.map((s) => [s, botFrame(mg, s, rngs[s], mems[s])])), DT);
  }
  return mg;
}

test('the registry says sitzplatz is a team game for 4..6', () => {
  assert.equal(MINIGAMES.sitzplatz.kind, 'team');
  assert.ok(MINIGAMES.sitzplatz.min >= 4);
});

test('hostInit uses the given teams exactly and falls back to parity teams', () => {
  const mg = init();
  assert.deepEqual(mg.teams, TEAMS4);
  assert.deepEqual(mg.ps.map((p) => [p.s, p.tm]), [[0, 0], [1, 1], [2, 0], [3, 1]]);
  const fb = hostInit({ seats: [0, 1, 2, 3, 4, 5], seed: 1, rng: createRng(1), mode: 'team', teams: null });
  assert.deepEqual(fb.teams, [[0, 2, 4], [1, 3, 5]]);
  assert.equal(fb.o.length, SEAT_COUNT);
  assert.ok(fb.o.every((o) => o === -1));
});

test('seats and tables do not overlap and lie inside the arena', () => {
  for (const s of SEATS) assert.ok(s.x > ARENA.x0 && s.x < ARENA.x1 && s.y > ARENA.y0 && s.y < ARENA.y1);
  for (const t of TABLES) for (const s of SEATS) assert.ok(Math.abs(t.x - s.x) > 20 || Math.abs(t.y - s.y) > 40, 'table sits between the seat rows');
});

test('the sim is deterministic: same seed + same inputs => identical state', () => {
  const a = playBots([0, 1, 2, 3], TEAMS4, 99), b = playBots([0, 1, 2, 3], TEAMS4, 99), c = playBots([0, 1, 2, 3], TEAMS4, 100);
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

test('the game ends at durationMs and a finished game does not advance', () => {
  const mg = init();
  for (let i = 0; i < 3000 && !mg.done; i++) hostStep(mg, {}, DT);
  assert.equal(mg.done, true);
  assert.ok(mg.t >= DURATION_MS && mg.t < DURATION_MS + 2 * DT, `t=${mg.t}`);
  const t = mg.t;
  hostStep(mg, {}, DT);
  assert.equal(mg.t, t);
});

test('touching a seat paints it in the team colour, and the other team flips it after the immunity', () => {
  const mg = away(init());
  const i = 9, s = SEATS[i];
  Object.assign(pl(mg, 0), { x: s.x, y: s.y });
  hostStep(mg, {}, DT);
  assert.equal(mg.o[i], 0);
  Object.assign(pl(mg, 1), { x: s.x, y: s.y });
  Object.assign(pl(mg, 0), { x: 400, y: 370 });
  hostStep(mg, {}, DT);
  assert.equal(mg.o[i], 0, 'freshly painted seats are immune for a moment');
  for (let k = 0; k < Math.ceil(C.FLIP_CD_MS / DT) + 2; k++) { Object.assign(pl(mg, 1), { x: s.x, y: s.y, vx: 0, vy: 0 }); hostStep(mg, {}, DT); }
  assert.equal(mg.o[i], 1, 'then the rival flips it');
  assert.deepEqual(counts(mg), [0, 1]);
});

test('a stunned player does not paint', () => {
  const mg = away(init());
  const s = SEATS[3];
  Object.assign(pl(mg, 0), { x: s.x, y: s.y, stun: 300 });
  hostStep(mg, {}, DT);
  assert.equal(mg.o[3], -1);
});

test('the jacket claims and locks the seats around, rivals cannot flip locked seats, the lock runs out', () => {
  const mg = away(init());
  const near = SEATS.map((s, i) => i).filter((i) => Math.hypot(SEATS[i].x - 296, SEATS[i].y - 260) <= C.JACKET_R);
  assert.ok(near.length >= 3, `${near.length} seats near`);
  Object.assign(pl(mg, 0), { x: 296, y: 260 });
  hostStep(mg, { 0: frame({ pressed: { jump: false, action: true, confirm: false, back: false } }) }, DT);
  for (const i of near) { assert.equal(mg.o[i], 0); assert.ok(mg.lk[i] > 0); }
  assert.ok(pl(mg, 0).cd > 0, 'jacket has a cooldown');
  assert.ok(mg.ev.some((e) => e.k === 'j' && e.s === 0 && e.n === near.length));
  const s = SEATS[near[0]];
  Object.assign(pl(mg, 1), { x: s.x, y: s.y });
  Object.assign(pl(mg, 0), { x: 700, y: 370 });
  hostStep(mg, {}, DT);
  assert.equal(mg.o[near[0]], 0, 'locked');
  for (let k = 0; k < Math.ceil(C.LOCK_MS / DT) + 40; k++) { Object.assign(pl(mg, 1), { x: s.x, y: s.y, vx: 0, vy: 0 }); hostStep(mg, {}, DT); }
  assert.equal(mg.o[near[0]], 1, 'after the lock the rival paints it');
});

test('the jacket press is ignored during the cooldown', () => {
  const mg = away(init());
  Object.assign(pl(mg, 0), { x: 296, y: 260 });
  const press = { 0: frame({ pressed: { jump: false, action: true, confirm: false, back: false } }) };
  hostStep(mg, press, DT);
  const n = mg.ev.filter((e) => e.k === 'j').length;
  hostStep(mg, press, DT);
  assert.equal(mg.ev.filter((e) => e.k === 'j').length, n);
});

test('the Schaffner flings and stuns a player in the aisle, then leaves them alone for a while', () => {
  const mg = init();
  Object.assign(mg.sc, { x: 640, pz: 1e9 });
  Object.assign(pl(mg, 0), { x: 640 - 30, y: mg.sc.y });
  hostStep(mg, {}, DT);
  assert.ok(pl(mg, 0).stun > 0);
  assert.ok(pl(mg, 0).kx < 0, 'flung away from him');
  assert.ok(mg.ev.some((e) => e.k === 'b' && e.s === 0));
  const stun = pl(mg, 0).stun;
  Object.assign(pl(mg, 0), { x: 640 - 30, y: mg.sc.y });
  hostStep(mg, {}, DT);
  assert.ok(pl(mg, 0).stun <= stun, 'no second bump during immunity');
});

test('tables block players', () => {
  const mg = away(init());
  const t = TABLES[0];
  Object.assign(pl(mg, 0), { x: t.x, y: t.y });
  hostStep(mg, {}, DT);
  assert.ok(Math.abs(pl(mg, 0).x - t.x) >= 12 || Math.abs(pl(mg, 0).y - t.y) >= 22, 'pushed out of the table');
});

test('players stay inside the arena', () => {
  const mg = away(init());
  for (let i = 0; i < 300; i++) hostStep(mg, { 0: frame({ move: { x: -1, y: -1 } }), 1: frame({ move: { x: 1, y: 1 } }) }, DT);
  for (const p of mg.ps) assert.ok(p.x >= ARENA.x0 && p.x <= ARENA.x1 && p.y >= ARENA.y0 && p.y <= ARENA.y1);
});

test('hostResult: more seats wins; the team gets one group; equal seats is a draw; every seat appears once', () => {
  const mg = init();
  mg.o.fill(-1);
  assert.deepEqual(hostResult(mg).placements, [[0, 1, 2, 3]], 'nothing claimed: draw');
  mg.o[0] = 1; mg.o[1] = 1; mg.o[2] = 0;
  const r = hostResult(mg);
  assert.deepEqual(r.placements, [[1, 3], [0, 2]]);
  assert.match(r.labels[1], /Team Blau: 2/);
  assert.deepEqual(r.placements.flat().sort(), [0, 1, 2, 3]);
  mg.o[2] = 1; mg.o[3] = 0; mg.o[4] = 0; mg.o[5] = 0; mg.o[6] = 0;
  assert.deepEqual(hostResult(mg).placements, [[0, 2], [1, 3]]);
  const six = hostInit({ seats: [0, 1, 2, 3, 4, 5], seed: 1, rng: createRng(1), mode: 'team', teams: [[0, 3, 4], [1, 2, 5]] });
  six.o[0] = 1;
  assert.deepEqual(hostResult(six).placements, [[1, 2, 5], [0, 3, 4]]);
});

test('bots: a full 4-bot and 6-bot game ends, claims a good part of the carriage and is not always a draw', () => {
  const results = [];
  for (let seed = 1; seed <= 6; seed++) {
    const mg = playBots([0, 1, 2, 3], TEAMS4, seed);
    assert.equal(mg.done, true);
    const [a, b] = counts(mg);
    assert.ok(a + b >= SEAT_COUNT * 0.6, `seed ${seed}: only ${a + b} of ${SEAT_COUNT} claimed`);
    results.push(hostResult(mg).placements.length);
  }
  assert.ok(results.includes(2), 'at least one decisive game');
  const six = playBots([0, 1, 2, 3, 4, 5], [[0, 2, 4], [1, 3, 5]], 3);
  assert.equal(six.done, true);
  assert.equal(hostResult(six).placements.flat().length, 6);
});

test('a team of bots beats two idle players', () => {
  const seats = [0, 1, 2, 3];
  const mg = init(seats, TEAMS4, 5);
  const rngs = { 0: createRng(1), 2: createRng(2) }, mems = { 0: {}, 2: {} };
  for (let i = 0; i < 3000 && !mg.done; i++) hostStep(mg, { 0: botFrame(mg, 0, rngs[0], mems[0]), 2: botFrame(mg, 2, rngs[2], mems[2]) }, DT);
  const [a, b] = counts(mg);
  assert.ok(a > b + 10, `${a} vs ${b}`);
  assert.deepEqual(hostResult(mg).placements[0], [0, 2]);
});

// ---- owner-authoritative movement ----
const report = (p, over = {}) => ({ x: p.x, y: p.y, vx: 0, vy: 0, kx: 0, ky: 0, fx: p.fx, fy: p.fy, cd: 0, stun: 0, jn: p.jn, ack: p.ia, ...over });
const jacket = () => frame({ action: true, pressed: { jump: false, action: true, confirm: false, back: false } });
/** does the body disc of `p` overlap a table rectangle? */
const inTable = (p) => TABLES.some((t) => Math.hypot(p.x - Math.max(t.x - TABLE.w / 2, Math.min(t.x + TABLE.w / 2, p.x)), p.y - Math.max(t.y - TABLE.h / 2, Math.min(t.y + TABLE.h / 2, p.y))) < C.R - 0.5);

test('stepBody is the host body math: a one-seat hostStep equals stepBody ticks (and a thrown jacket is reported)', () => {
  const mg = away(init([0, 1, 2, 3]));
  const p = pl(mg, 0), c = structuredClone(p);
  let thrown = 0;
  for (let i = 0; i < 60; i++) {
    const f = i === 5 ? frame({ move: { x: 1, y: 0.1 }, pressed: { jump: false, action: true, confirm: false, back: false } }) : frame({ move: { x: 1, y: 0.1 } });
    hostStep(mg, { 0: f }, DT);
    thrown += stepBody(c, f, DT) ? 1 : 0;
  }
  assert.equal(thrown, 1);
  for (const k of ['vx', 'vy', 'kx', 'ky']) c[k] = Math.round(c[k] * 10) / 10;
  assert.ok(Math.abs(p.x - c.x) < 2 && Math.abs(p.y - c.y) < 2, `host ${p.x},${p.y} vs stepBody ${c.x},${c.y}`);
  assert.equal(p.cd, c.cd);
});

test('stepBody pushes the owner out of tables (pure export, same as the host pass)', () => {
  const t = TABLES[0], p = { x: t.x - 30, y: t.y, vx: 285, vy: 0, kx: 0, ky: 0, fx: 1, fy: 0, cd: 0, stun: 0 };
  for (let i = 0; i < 60; i++) { stepBody(p, frame({ move: { x: 1, y: 0 } }), DT); assert.ok(!inTable(p), `step ${i}: ${p.x},${p.y}`); }
  const q = { x: t.x, y: t.y };
  pushOutTables(q);
  assert.ok(!inTable(q));
});

test('hostAdopt: whitelists fields, clamps to the carriage and sane speeds, never touches host-owned fields', () => {
  const mg = away(init());
  const p = pl(mg, 0);
  Object.assign(p, { bi: 800, ia: 0 });
  const res = hostAdopt(mg, 0, { x: 99999, y: -5, vx: 5000, vy: -5000, kx: 12.34, ky: 0, fx: 3, fy: -3, cd: 99999, stun: 7, jn: 2, tm: 1, bi: 0, s: 1, ia: 77, jp: 9, ot: -1, hax: 1, ack: 0 });
  assert.deepEqual(res, { changed: ['jn'], gated: false });
  assert.deepEqual([p.x, p.y, p.vx, p.vy, p.kx, p.fx, p.fy], [ARENA.x1, ARENA.y0, 400, -400, 12.3, 1, -1]);
  assert.equal(p.cd, C.JACKET_CD_MS);
  assert.equal(p.jn, 2);
  assert.deepEqual([p.tm, p.bi, p.s, p.ia, p.jp, 'hax' in p], [0, 800, 0, 0, 1, false], 'host-owned fields untouched (jp is only the queued claim)');
  assert.equal(p.ot, mg.t);
});

test('hostAdopt rejects NaN, Infinity and non-numbers field by field', () => {
  const mg = init();
  const p = pl(mg, 0), before = { x: p.x, y: p.y, vx: p.vx };
  hostAdopt(mg, 0, { x: NaN, y: Infinity, vx: '5', vy: null, kx: {}, ky: undefined, fx: [1], jn: NaN, ack: 0 });
  assert.deepEqual({ x: p.x, y: p.y, vx: p.vx }, before);
  assert.equal(p.jn, 0);
  assert.equal(p.jp, 0);
  assert.equal(hostAdopt(mg, 0, null), null);
  assert.equal(hostAdopt(mg, 9, report(p)), null, 'unknown seat');
});

test('ack gating: while ack < ia the kinematic fields are ignored, the jacket serial still counts (at the reported position); once acked they apply', () => {
  const mg = init();
  Object.assign(mg.sc, { x: 640, pz: 1e9 });
  Object.assign(pl(mg, 0), { x: 640 - 30, y: mg.sc.y });
  hostStep(mg, {}, DT);   // the Schaffner hits seat 0
  const v = pl(mg, 0);
  assert.equal(v.ia, 1);
  const kx = v.kx, x = v.x;
  const res = hostAdopt(mg, 0, { ...report(v), x: 300, y: 260, kx: 0, ack: 0, jn: 1 });
  assert.equal(res.gated, true);
  assert.deepEqual([v.x, v.kx], [x, kx], 'a stale report cannot erase the knockback or the position');
  assert.equal(v.jn, 1, 'serials are not kinematic');
  assert.deepEqual([v.jp, v.jx, v.jy], [1, 300, 260], 'the claim uses the position of the report that carried the serial');
  hostAdopt(mg, 0, { ...report(v), x: 300, y: 260, kx: 5, ack: 1 });
  assert.deepEqual([v.x, v.y, v.kx], [300, 260, 5]);
});

test('jacket claimed exactly once per jn serial, at the reported position', () => {
  const mg = away(init());
  const p = pl(mg, 0);
  const near = (x, y) => SEATS.map((s, i) => i).filter((i) => Math.hypot(SEATS[i].x - x, SEATS[i].y - y) <= C.JACKET_R);
  const a = near(296, 260), b = near(1000, 600);
  assert.ok(a.length >= 3 && b.length >= 3 && !a.some((i) => b.includes(i)));
  p.x = 700; p.y = 370;
  hostAdopt(mg, 0, report(p, { x: 296, y: 260 }));            // unchanged serial: just a position
  hostStep(mg, {}, DT);
  assert.equal(mg.ev.filter((e) => e.k === 'j').length, 0, 'no claim without a new serial');
  const rep1 = report(p, { x: 296, y: 260, jn: 1, cd: C.JACKET_CD_MS });
  hostAdopt(mg, 0, rep1);
  hostAdopt(mg, 0, rep1);                                     // the same report again (resent / duplicate): same serial
  for (let i = 0; i < 5; i++) hostStep(mg, {}, DT);
  for (const i of a) { assert.equal(mg.o[i], 0); assert.ok(mg.lk[i] > 0); }
  const js = mg.ev.filter((e) => e.k === 'j');
  assert.equal(js.length, 1, 'exactly one claim for serial 1');
  assert.deepEqual([js[0].s, js[0].x, js[0].y, js[0].n], [0, 296, 260, a.length]);
  assert.equal(p.jp, 0, 'the pending claim was consumed');
  // the owner walked on; reports with the same serial never claim again, even with the lock gone
  mg.lk.fill(0); mg.o.fill(-1);
  hostAdopt(mg, 0, report(p, { x: 1000, y: 600, jn: 1 }));
  for (let i = 0; i < 5; i++) hostStep(mg, {}, DT);
  assert.equal(mg.ev.filter((e) => e.k === 'j').length, 1);
  // serial 2 at the new position claims the other group, not the old one
  hostAdopt(mg, 0, report(p, { x: 1000, y: 600, jn: 2, cd: C.JACKET_CD_MS }));
  hostStep(mg, {}, DT);
  assert.equal(mg.ev.filter((e) => e.k === 'j').length, 2);
  for (const i of b) assert.equal(mg.o[i], 0);
  for (const i of a) assert.equal(mg.o[i], -1);
});

test('an owned seat ignores pressed.action (only jn throws); an unowned seat still throws by input', () => {
  const mg = away(init());
  const p = pl(mg, 0);
  Object.assign(p, { x: 296, y: 260 });
  hostAdopt(mg, 0, report(p));
  for (let i = 0; i < 5; i++) hostStep(mg, { 0: jacket() }, DT);
  assert.equal(mg.ev.filter((e) => e.k === 'j').length, 0);
  assert.equal(p.cd, 0);
  mg.t += TIMING.OWN_STALE_MS + 1;   // stale owner: the input path takes over
  hostStep(mg, { 0: jacket() }, DT);
  assert.equal(mg.ev.filter((e) => e.k === 'j').length, 1);
  assert.ok(p.cd > 0);
});

test('an owned seat cannot report a position inside a table', () => {
  const mg = away(init());
  const p = pl(mg, 0);
  for (const t of TABLES) {
    hostAdopt(mg, 0, report(p, { x: t.x, y: t.y }));
    assert.ok(!inTable(p), `table ${t.x},${t.y} -> ${p.x},${p.y}`);
    hostAdopt(mg, 0, report(p, { x: t.x + 3, y: t.y - 5 }));
    assert.ok(!inTable(p));
  }
  // a jacket thrown "from inside a table" is claimed from the pushed-out spot
  hostAdopt(mg, 0, report(p, { x: TABLES[0].x, y: TABLES[0].y, jn: 1 }));
  assert.ok(Math.abs(p.jx - TABLES[0].x) >= TABLE.w / 2 || Math.abs(p.jy - TABLES[0].y) >= TABLE.h / 2);
});

test('an owned seat keeps its reported body: no input, no soft separation; once stale the input path takes over', () => {
  const mg = away(init());
  const p = pl(mg, 0);
  Object.assign(p, { x: 400, y: 370 });
  hostAdopt(mg, 0, report(p));
  for (let i = 0; i < 20; i++) hostStep(mg, { 0: frame({ move: { x: 1, y: 0 } }) }, DT);
  assert.deepEqual([p.x, p.vx], [400, 0], 'owned: the input is not used');
  mg.t += TIMING.OWN_STALE_MS + 1;
  hostStep(mg, { 0: frame({ move: { x: 1, y: 0 } }) }, DT);
  assert.ok(p.vx > 0 && p.x > 400, 'stale: driven by input again');
  // separation: the owned seat is not moved, the unowned neighbour takes its half
  const m2 = away(init());
  Object.assign(pl(m2, 0), { x: 400, y: 370 }); Object.assign(pl(m2, 1), { x: 420, y: 370 });
  hostAdopt(m2, 0, report(pl(m2, 0)));
  hostStep(m2, {}, DT);
  assert.equal(pl(m2, 0).x, 400);
  assert.equal(pl(m2, 1).x, 420 + (2 * C.R - 20) / 2);
});

test('a Schaffner hit gives the same knockback/stun for an owned and an unowned victim', () => {
  const run = (owned) => {
    const mg = init();
    Object.assign(mg.sc, { x: 640, pz: 1e9 });
    Object.assign(pl(mg, 0), { x: 640 - 30, y: mg.sc.y });
    if (owned) hostAdopt(mg, 0, report(pl(mg, 0)));
    hostStep(mg, {}, DT);
    const v = pl(mg, 0);
    return { kx: v.kx, ky: v.ky, stun: v.stun, bi: v.bi };
  };
  const a = run(false), b = run(true);
  assert.deepEqual(a, b);
  assert.ok(a.kx < -900 && a.stun > 0 && a.bi > 0);
});

test('pushImp entry shape from the Schaffner: {i, s, kx, ky, st, dc, t}, victim ia = i, no second entry during immunity', () => {
  const mg = init();
  Object.assign(mg.sc, { x: 640, pz: 1e9 });
  Object.assign(pl(mg, 0), { x: 640 - 30, y: mg.sc.y });
  hostStep(mg, {}, DT);
  assert.equal(mg.imp.length, 1);
  const e = mg.imp[0];
  assert.deepEqual(Object.keys(e).sort(), ['dc', 'i', 'kx', 'ky', 's', 'st', 't']);
  assert.deepEqual([e.i, e.s, e.st, e.dc], [1, 0, C.SCH_STUN_MS, 0]);
  assert.ok(e.kx < -900);
  assert.equal(mg.iid, 1);
  assert.equal(pl(mg, 0).ia, 1);
  assert.equal(pl(mg, 1).ia, 0);
  Object.assign(pl(mg, 0), { x: 640 - 30, y: mg.sc.y });
  hostStep(mg, {}, DT);
  assert.equal(mg.imp.length, 1, 'immune: no second impulse');
  assert.deepEqual(takeImps(JSON.parse(JSON.stringify(mg)), 0, 0).list.map((x) => x.i), [1]);
  assert.equal(takeImps(mg, 1, 0).list.length, 0);
  assert.deepEqual(takeImps(mg, 0, null), { list: [], last: 1 });
});

test('an owned, stunned seat does not paint seats; an owned walker does', () => {
  const mg = away(init());
  const s = SEATS[3], p = pl(mg, 0);
  hostAdopt(mg, 0, report(p, { x: s.x, y: s.y, stun: 300 }));
  hostStep(mg, {}, DT);
  assert.equal(mg.o[3], -1);
  hostAdopt(mg, 0, report(p, { x: s.x, y: s.y, stun: 0 }));
  hostStep(mg, {}, DT);
  assert.equal(mg.o[3], 0);
});
