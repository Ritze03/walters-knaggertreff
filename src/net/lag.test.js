import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withLag } from './lag.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** minimal fake link recording everything; `deliver` simulates an inbound packet */
function fakeLink() {
  const sent = [], handlers = new Map(), ev = [];
  let join = null, leave = null;
  return {
    sent, ev,
    selfId: 'me',
    send: (type, data, target) => sent.push({ type, data, target, t: Date.now() }),
    broadcast: (type, data) => sent.push({ type, data, bc: true, t: Date.now() }),
    onMessage: (type, h) => handlers.set(type, h),
    onPeerJoin: (h) => { join = h; },
    onPeerLeave: (h) => { leave = h; },
    ping: async () => { await wait(5); return 5; },
    leave: () => ev.push('leave'),
    deliver: (type, data, from) => handlers.get(type)?.(data, from),
    join: (id) => join?.(id),
    part: (id) => leave?.(id),
  };
}

test('ms = 0 (or garbage) returns the very same link', () => {
  const l = fakeLink();
  assert.equal(withLag(l, 0), l);
  assert.equal(withLag(l, undefined), l);
  assert.equal(withLag(l, null), l);
  assert.equal(withLag(l, NaN), l);
  assert.equal(withLag(l, -5), l);
});

test('outbound send and broadcast are delayed by ms', async () => {
  const l = fakeLink(), g = withLag(l, 80);
  const t0 = Date.now();
  g.send('a', { n: 1 }, 'peer');
  g.broadcast('b', { n: 2 });
  assert.equal(l.sent.length, 0);
  await wait(40);
  assert.equal(l.sent.length, 0);
  await wait(80);
  assert.equal(l.sent.length, 2);
  assert.ok(l.sent[0].t - t0 >= 75, `delayed ${l.sent[0].t - t0}ms`);
  assert.equal(l.sent[0].type, 'a');
  assert.deepEqual(l.sent[0].data, { n: 1 });
  assert.equal(l.sent[0].target, 'peer');
});

test('the payload is snapshotted at send time', async () => {
  const l = fakeLink(), g = withLag(l, 30);
  const obj = { n: 1 };
  g.send('a', obj);
  obj.n = 99;
  await wait(70);
  assert.equal(l.sent[0].data.n, 1);
});

test('inbound handler calls are delayed by ms', async () => {
  const l = fakeLink(), g = withLag(l, 80);
  const got = [];
  g.onMessage('a', (data, from) => got.push({ data, from, t: Date.now() }));
  const t0 = Date.now();
  l.deliver('a', { n: 1 }, 'p1');
  assert.equal(got.length, 0);
  await wait(40);
  assert.equal(got.length, 0);
  await wait(80);
  assert.equal(got.length, 1);
  assert.ok(got[0].t - t0 >= 75);
  assert.equal(got[0].from, 'p1');
});

test('order is preserved both ways', async () => {
  const l = fakeLink(), g = withLag(l, 20);
  const got = [];
  g.onMessage('a', (d) => got.push(d));
  for (let i = 0; i < 50; i++) { g.send('a', i); l.deliver('a', i, 'p'); }
  await wait(120);
  const seq = [...Array(50).keys()];
  assert.deepEqual(l.sent.map((s) => s.data), seq);
  assert.deepEqual(got, seq);
});

test('join / leave events are not delayed', () => {
  const l = fakeLink(), g = withLag(l, 500);
  const seen = [];
  g.onPeerJoin((id) => seen.push('join:' + id));
  g.onPeerLeave((id) => seen.push('leave:' + id));
  l.join('x'); l.part('x');
  assert.deepEqual(seen, ['join:x', 'leave:x']);
  assert.equal(g.selfId, 'me');
});

test('ping reports the real round trip plus 2*ms and really takes that long', async () => {
  const l = fakeLink(), g = withLag(l, 60);
  const t0 = Date.now();
  const rtt = await g.ping('p');
  const took = Date.now() - t0;
  assert.ok(rtt >= 125 && rtt < 250, `rtt ${rtt}`);
  assert.ok(took >= 120, `took ${took}`);
});

test('leave stops pending traffic', async () => {
  const l = fakeLink(), g = withLag(l, 30);
  const got = [];
  g.onMessage('a', (d) => got.push(d));
  g.send('a', 1);
  l.deliver('a', 2, 'p');
  g.leave();
  await wait(70);
  assert.deepEqual(l.ev, ['leave']);
  assert.equal(l.sent.length, 0);
  assert.equal(got.length, 0);
});
