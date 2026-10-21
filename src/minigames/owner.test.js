import test from 'node:test';
import assert from 'node:assert/strict';
import { TIMING } from '../contracts.js';
import { adoptFields, isOwned, pushImp, takeImps, fixedStepper } from './owner.js';

const SPEC = {
  x: { lo: 0, hi: 1000, kin: true }, y: { lo: 0, hi: 500, kin: true },
  kx: { lo: -2000, hi: 2000, kin: true, dp: 2 },
  cd: { lo: 0, hi: 2000, dp: 0 },
  dn: { lo: 0, hi: 1e6, serial: true },
};
const player = () => ({ s: 0, x: 100, y: 100, kx: 0, cd: 0, dn: 0, dh: [], aura: 500 });

test('adoptFields: whitelist, only spec fields are copied, host-owned fields untouched', () => {
  const p = player();
  const r = adoptFields(p, { x: 200.26, y: 50, aura: 99999, stun: 5, evil: 1, ack: 0 }, SPEC, 1234);
  assert.equal(p.x, 200.3); assert.equal(p.y, 50);
  assert.equal(p.aura, 500); assert.equal(p.stun, undefined); assert.equal(p.evil, undefined);
  assert.equal(p.ot, 1234);
  assert.deepEqual(r, { changed: [], gated: false });
});

test('adoptFields: clamp and per-field rounding', () => {
  const p = player();
  adoptFields(p, { x: -50, y: 9999, kx: 1.23456, cd: 12.7 }, SPEC, 0);
  assert.equal(p.x, 0); assert.equal(p.y, 500); assert.equal(p.kx, 1.23); assert.equal(p.cd, 13);
});

test('adoptFields: NaN, Infinity, strings and missing values are rejected per field', () => {
  const p = player();
  adoptFields(p, { x: NaN, y: Infinity, kx: '5', cd: null, dn: -Infinity }, SPEC, 7);
  assert.deepEqual([p.x, p.y, p.kx, p.cd, p.dn], [100, 100, 0, 0, 0]);
  assert.equal(p.ot, 7, 'a valid object still counts as a report');
  assert.equal(adoptFields(p, null, SPEC, 9), null);
  assert.equal(adoptFields(p, 'x', SPEC, 9), null);
  assert.equal(p.ot, 7);
});

test('adoptFields: kinematics are ignored while ack < p.ia, serials and timers still adopted', () => {
  const p = player();
  p.ia = 3; p.x = 111;
  let r = adoptFields(p, { x: 500, kx: 9, cd: 400, dn: 1, ack: 2 }, SPEC, 10);
  assert.equal(p.x, 111); assert.equal(p.kx, 0);
  assert.equal(p.cd, 400); assert.equal(p.dn, 1);
  assert.deepEqual(r, { changed: ['dn'], gated: true });
  r = adoptFields(p, { x: 500, ack: 3 }, SPEC, 20);
  assert.equal(p.x, 500); assert.equal(r.gated, false);
  p.ia = 4;
  assert.equal(adoptFields(p, { x: 1 }, SPEC, 30).gated, true, 'a missing ack counts as 0');
  assert.equal(adoptFields(p, { x: 1, ack: 'nope' }, SPEC, 30).gated, true);
});

test('adoptFields: serial change is reported once, then not again', () => {
  const p = player();
  assert.deepEqual(adoptFields(p, { dn: 0 }, SPEC, 0).changed, [], 'missing counts as 0');
  assert.deepEqual(adoptFields(p, { dn: 1 }, SPEC, 0).changed, ['dn']);
  assert.deepEqual(adoptFields(p, { dn: 1 }, SPEC, 0).changed, []);
  assert.deepEqual(adoptFields(p, { dn: 2.4 }, SPEC, 0).changed, ['dn']);
  assert.equal(p.dn, 2);
  const q = { s: 1 };
  assert.deepEqual(adoptFields(q, { dn: 1 }, SPEC, 0).changed, ['dn'], 'a player without the field');
});

test('isOwned: stale detection against OWN_STALE_MS', () => {
  const p = player();
  assert.equal(isOwned(p, 0), false, 'never reported');
  adoptFields(p, { x: 1 }, SPEC, 1000);
  assert.equal(isOwned(p, 1000), true);
  assert.equal(isOwned(p, 1000 + TIMING.OWN_STALE_MS), true);
  assert.equal(isOwned(p, 1000 + TIMING.OWN_STALE_MS + 1), false);
});

test('pushImp: appends, numbers, applies to the host copy and sets ia', () => {
  const mg = { t: 5000 };
  const q = { s: 2, kx: 10, ky: 0, stun: 100, dash: 50 };
  const e1 = pushImp(mg, q, 2, { kx: 300.04, ky: -20, st: 350, dc: true });
  assert.deepEqual(e1, { i: 1, s: 2, kx: 300, ky: -20, st: 350, dc: 1, t: 5000 });
  assert.equal(mg.iid, 1); assert.deepEqual(mg.imp, [e1]);
  assert.equal(q.ia, 1); assert.equal(q.kx, 310); assert.equal(q.ky, -20); assert.equal(q.stun, 350); assert.equal(q.dash, 0);
  const e2 = pushImp(mg, q, 2, { kx: 1, ky: 1, st: 10 });
  assert.equal(e2.i, 2); assert.equal(e2.dc, 0);
  assert.equal(q.stun, 350, 'stun is a max'); assert.equal(q.ia, 2);
});

test('pushImp: dc false leaves the dash alone; entries older than 2 s are pruned, ids never reused', () => {
  const mg = { t: 0 };
  const q = { s: 0, dash: 80 };
  pushImp(mg, q, 0, { kx: 1, ky: 0, st: 0 });
  assert.equal(q.dash, 80);
  mg.t = 1500; pushImp(mg, q, 0, { kx: 1 });
  assert.equal(mg.imp.length, 2);
  mg.t = 2100; pushImp(mg, q, 0, { kx: 1 });
  assert.deepEqual(mg.imp.map((e) => e.i), [2, 3], 'the first one is older than 2 s');
  mg.t = 9000; pushImp(mg, q, 0, { kx: 1 });
  assert.deepEqual(mg.imp.map((e) => e.i), [4]);
  assert.equal(mg.iid, 4);
});

test('takeImps: only my seat, only newer than lastImp, in id order, dedup across calls', () => {
  const mg = { t: 0 };
  const a = { s: 0 }, b = { s: 1 };
  pushImp(mg, a, 0, { kx: 1 }); pushImp(mg, b, 1, { kx: 2 }); pushImp(mg, a, 0, { kx: 3 });
  let r = takeImps(mg, 0, 0);
  assert.deepEqual(r.list.map((e) => e.i), [1, 3]); assert.equal(r.last, 3);
  r = takeImps(mg, 0, r.last);
  assert.deepEqual(r.list, []); assert.equal(r.last, 3);
  r = takeImps(mg, 1, 0);
  assert.deepEqual(r.list.map((e) => e.kx), [2]); assert.equal(r.last, 2);
  assert.deepEqual(takeImps({}, 0, 5), { list: [], last: 5 });
});

test('takeImps: the first snapshot after a (re)mount replays nothing and adopts the highest id', () => {
  const mg = { t: 0 };
  const a = { s: 0 };
  pushImp(mg, a, 0, { kx: 1 }); pushImp(mg, a, 0, { kx: 1 });
  assert.deepEqual(takeImps(mg, 0, null), { list: [], last: 2 });
  assert.deepEqual(takeImps(mg, 0, undefined), { list: [], last: 2 });
  assert.deepEqual(takeImps({}, 0, null), { list: [], last: 0 });
  assert.deepEqual(takeImps({ iid: 7, imp: [] }, 0, null), { list: [], last: 7 });
});

test('fixedStepper: steps at the fixed rate and keeps the remainder', () => {
  const st = fixedStepper(60, 8);
  const calls = [];
  assert.equal(st.step(10, (d) => calls.push(d)), 0);
  assert.equal(st.step(10, (d) => calls.push(d)), 1, '20 ms accumulated: one 16.7 ms step');
  assert.equal(calls.length, 1); assert.ok(Math.abs(calls[0] - 1000 / 60) < 1e-9);
  let n = 0;
  for (let i = 0; i < 60; i++) n += st.step(1000 / 60, () => {});
  assert.ok(n >= 59 && n <= 61, `60 frames of 60 Hz -> ~60 steps, got ${n}`);
});

test('fixedStepper: catch-up is capped and the backlog is dropped', () => {
  const st = fixedStepper(60, 4);
  let n = 0;
  assert.equal(st.step(250, () => n++), 4);
  assert.equal(n, 4);
  assert.equal(st.step(1, () => n++), 0, 'the backlog was dropped, not paid back later');
  assert.equal(st.step(100000, () => n++), 4, 'a huge frame time is clamped to 250 ms then capped');
  st.reset();
  assert.equal(st.step(0, () => n++), 0);
});
