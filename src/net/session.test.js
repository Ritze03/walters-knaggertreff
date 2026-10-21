import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { MSG, SESSION_EVENT, KEYS, PROTOCOL_VERSION } from '../contracts.js';
import { createSession, QUEUE_MAX, QUEUE_MAX_AGE_MS } from './session.js';
import { createTransport as createLocal } from './transports/local.js';
import { loadIdentity, saveProfile, isHostOf, markHost, loadSave, storeSave } from './identity.js';

const open = [];
const gameIdOf = () => 'test' + Math.random().toString(36).slice(2, 8);
const profileOf = (name) => ({ playerId: name, name, color: '#ff5a5f', hat: 'none' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) assert.fail('timed out waiting for condition');
    await wait(10);
  }
}
/** every session made here is left in the `after` hook so channels/timers close and `node --test` exits */
function make(gameId, name, isHost = false, transport = 'local') {
  const s = createSession({ gameId, transport, profile: profileOf(name), playerId: name, isHost });
  open.push(s);
  return s;
}
const record = (s, type) => { const got = []; s.on(type, (data, from) => got.push({ data, from })); return got; };
after(() => { for (const s of open) s.leave(); });

test('host + 2 clients exchange hello, clients learn the host', async () => {
  const g = gameIdOf();
  const host = make(g, 'host', true);
  const joins = record(host, SESSION_EVENT.peerJoin);
  const a = make(g, 'alice'), b = make(g, 'bob');
  await until(() => joins.length === 2 && a.peers().length === 2 && b.peers().length === 2);

  assert.deepEqual(joins.map((j) => j.data.playerId).sort(), ['alice', 'bob']);
  const alice = joins.find((j) => j.data.playerId === 'alice').data;
  assert.equal(alice.profile.name, 'alice');
  assert.equal(alice.isHost, false);
  assert.equal(alice.protocol, PROTOCOL_VERSION);
  assert.equal(host.hostPlayerId(), 'host');
  assert.equal(a.hostPlayerId(), 'host');
  assert.equal(b.hostPlayerId(), 'host');
  assert.deepEqual(a.peers().map((p) => p.playerId).sort(), ['bob', 'host']);
  assert.equal(a.peers().find((p) => p.playerId === 'host').isHost, true);
});

test('late joiner learns peers that were already present', async () => {
  const g = gameIdOf();
  const host = make(g, 'host', true), a = make(g, 'alice');
  await until(() => host.peers().length === 1 && a.peers().length === 1);
  const b = make(g, 'bob');
  const seen = record(b, SESSION_EVENT.peerJoin);
  await until(() => seen.length === 2);
  assert.deepEqual(seen.map((j) => j.data.playerId).sort(), ['alice', 'host']);
  assert.equal(b.hostPlayerId(), 'host');
});

test('from is stamped with the sender playerId; sendIntent reaches only the host', async () => {
  const g = gameIdOf();
  const host = make(g, 'host', true), a = make(g, 'alice'), b = make(g, 'bob');
  await until(() => a.hostPlayerId() && b.hostPlayerId() && host.peers().length === 2);
  const atHost = record(host, MSG.intent), atBob = record(b, MSG.intent), atAlice = record(a, MSG.intent);

  a.sendIntent({ type: 'roll' });
  await until(() => atHost.length === 1);
  await wait(100);
  assert.deepEqual(atHost[0], { data: { intent: { type: 'roll' } }, from: 'alice' });
  assert.equal(atBob.length, 0);
  assert.equal(atAlice.length, 0);

  // a spoofed playerId inside the payload is just payload
  b.sendIntent({ type: 'ready', playerId: 'alice' });
  await until(() => atHost.length === 2);
  assert.equal(atHost[1].from, 'bob');
});

test('host sendIntent loops back to its own handlers', async () => {
  const host = make(gameIdOf(), 'host', true);
  const got = record(host, MSG.intent);
  host.sendIntent({ type: 'startGame' });
  await until(() => got.length === 1);
  assert.deepEqual(got[0], { data: { intent: { type: 'startGame' } }, from: 'host' });
});

test('client sendIntent reaches no other client while the host is absent', async () => {
  const g = gameIdOf();
  const a = make(g, 'alice'), b = make(g, 'bob');
  await until(() => a.peers().length === 1);
  const got = record(b, MSG.intent);
  a.sendIntent({ type: 'roll' });
  await wait(150);
  assert.equal(got.length, 0);
  assert.equal(a.hostPlayerId(), null);
});

test('intents sent while the host is unknown are delivered in order once it appears; perishable mgInput/mgOwn are not replayed', async () => {
  const g = gameIdOf();
  const a = make(g, 'alice');
  a.sendIntent({ type: 'a' });
  a.sendToHost(MSG.mgInput, { seq: 1 });
  a.sendIntent({ type: 'b' });
  a.sendToHost(MSG.mgOwn, { seq: 2, s: {} });
  a.sendIntent({ type: 'c' });
  const host = make(g, 'host', true);
  const intents = record(host, MSG.intent), inputs = record(host, MSG.mgInput), owns = record(host, MSG.mgOwn);
  await until(() => intents.length === 3);
  assert.deepEqual(intents.map((m) => m.data.intent.type), ['a', 'b', 'c']);
  assert.ok(intents.every((m) => m.from === 'alice'));
  a.sendIntent({ type: 'd' });   // live again: goes straight out, after the queued ones
  await until(() => intents.length === 4);
  await wait(100);
  assert.equal(inputs.length + owns.length, 0);
  assert.deepEqual(intents.map((m) => m.data.intent.type), ['a', 'b', 'c', 'd']);
});

test('the outbox keeps only the newest QUEUE_MAX messages and drops entries older than QUEUE_MAX_AGE_MS', async () => {
  const g = gameIdOf();
  const a = make(g, 'alice');
  const realNow = Date.now;
  let t = realNow();
  Date.now = () => t;
  try {
    a.sendIntent({ type: 'stale' });
    t += QUEUE_MAX_AGE_MS + 1;
    for (let i = 0; i < QUEUE_MAX + 8; i++) a.sendIntent({ type: 'i', i });
  } finally { Date.now = realNow; }
  const host = make(g, 'host', true);
  const intents = record(host, MSG.intent);
  await until(() => intents.length >= QUEUE_MAX);
  await wait(150);
  assert.deepEqual(intents.map((m) => m.data.intent.i), Array.from({ length: QUEUE_MAX }, (_, k) => k + 8));
});

test('intents sent while a silent host is considered gone are delivered when it speaks again', { timeout: 15000 }, async () => {
  const g = gameIdOf();
  const real = createLocal(g);
  let muted = false;
  const flaky = { ...real, send: (...args) => { if (!muted) real.send(...args); } };
  const host = createSession({ gameId: g, transport: flaky, profile: profileOf('host'), playerId: 'host', isHost: true });
  open.push(host);
  const a = make(g, 'alice');
  const gone = record(a, SESSION_EVENT.hostGone), intents = record(host, MSG.intent);
  await until(() => a.hostPlayerId() === 'host');
  muted = true;
  await until(() => gone.length === 1, 8000);
  a.sendIntent({ type: 'x' });
  a.sendIntent({ type: 'y' });
  muted = false;
  await until(() => intents.length === 2, 4000);
  assert.deepEqual(intents.map((m) => m.data.intent.type), ['x', 'y']);
});

test('broadcast reaches all peers, and self only with {self:true}', async () => {
  const g = gameIdOf();
  const host = make(g, 'host', true), a = make(g, 'alice'), b = make(g, 'bob');
  await until(() => a.hostPlayerId() && b.hostPlayerId() && host.peers().length === 2);
  const atHost = record(host, MSG.state), atA = record(a, MSG.state), atB = record(b, MSG.state);

  host.broadcast(MSG.state, { rev: 1 });
  await until(() => atA.length === 1 && atB.length === 1);
  await wait(100);
  assert.equal(atHost.length, 0);
  assert.deepEqual(atA[0], { data: { rev: 1 }, from: 'host' });

  host.broadcast(MSG.state, { rev: 2 }, { self: true });
  await until(() => atHost.length === 1 && atA.length === 2 && atB.length === 2);
  assert.deepEqual(atHost[0], { data: { rev: 2 }, from: 'host' });
});

test('send targets one player; unsubscribe stops delivery', async () => {
  const g = gameIdOf();
  const host = make(g, 'host', true), a = make(g, 'alice'), b = make(g, 'bob');
  await until(() => host.peers().length === 2);
  const atA = record(a, MSG.reject), atB = record(b, MSG.reject);
  host.send(MSG.reject, { reason: 'full' }, 'alice');
  await until(() => atA.length === 1);
  await wait(100);
  assert.equal(atB.length, 0);

  const got = [];
  const off = b.on(MSG.state, (d) => got.push(d));
  host.broadcast(MSG.state, { rev: 1 });
  await until(() => got.length === 1);
  off();
  host.broadcast(MSG.state, { rev: 2 });
  await wait(100);
  assert.equal(got.length, 1);
});

test('ping returns a round trip', async () => {
  const g = gameIdOf();
  const host = make(g, 'host', true), a = make(g, 'alice');
  await until(() => a.peers().length === 1 && host.peers().length === 1);
  const ms = await a.ping('host');
  assert.ok(ms >= 0 && ms < 1000);
  assert.equal(a.peers()[0].pingMs, ms);
  await assert.rejects(a.ping('nobody'));
});

test('a client leaving fires peerLeave with its playerId on the host', async () => {
  const g = gameIdOf();
  const host = make(g, 'host', true), a = make(g, 'alice');
  const left = record(host, SESSION_EVENT.peerLeave);
  await until(() => host.peers().length === 1);
  a.leave();
  await until(() => left.length === 1);
  assert.deepEqual(left[0].data, { playerId: 'alice' });
  assert.equal(host.peers().length, 0);
});

test('a rejoining client (same playerId, new transport) is reported as that playerId again', async () => {
  const g = gameIdOf();
  const host = make(g, 'host', true);
  const joins = record(host, SESSION_EVENT.peerJoin), left = record(host, SESSION_EVENT.peerLeave);
  const a1 = make(g, 'alice');
  await until(() => joins.length === 1);
  a1.leave();
  await until(() => left.length === 1);

  const a2 = make(g, 'alice');
  await until(() => joins.length === 2);
  assert.equal(joins[1].data.playerId, 'alice');
  assert.deepEqual(host.peers().map((p) => p.playerId), ['alice']);
  const got = record(host, MSG.intent);
  a2.sendIntent({ type: 'roll' });
  await until(() => got.length === 1);
  assert.equal(got[0].from, 'alice');
});

test('a reload that beats the old connection timing out replaces it without leave events', async () => {
  const g = gameIdOf();
  const host = make(g, 'host', true);
  const joins = record(host, SESSION_EVENT.peerJoin), left = record(host, SESSION_EVENT.peerLeave);
  make(g, 'alice');   // old connection stays open
  await until(() => joins.length === 1);
  make(g, 'alice');   // same playerId, new peer id
  await until(() => joins.length === 2);
  await wait(100);
  assert.equal(left.length, 0);
  assert.equal(host.peers().length, 1);
});

test('host leaving fires hostGone on clients; a new host session with the same playerId fires hostBack', async () => {
  const g = gameIdOf();
  const host1 = make(g, 'host', true), a = make(g, 'alice'), b = make(g, 'bob');
  const gone = record(a, SESSION_EVENT.hostGone), back = record(a, SESSION_EVENT.hostBack);
  const goneB = record(b, SESSION_EVENT.hostGone);
  await until(() => a.hostPlayerId() === 'host' && b.hostPlayerId() === 'host');
  back.length = 0;

  host1.leave();
  await until(() => gone.length === 1 && goneB.length === 1);
  assert.equal(a.hostPlayerId(), null);
  assert.equal(back.length, 0);

  const host2 = make(g, 'host', true);
  const joins = record(host2, SESSION_EVENT.peerJoin);
  await until(() => back.length === 1 && joins.length === 2);   // the host also learns both clients again
  assert.deepEqual(back[0].data, { playerId: 'host' });
  assert.equal(a.hostPlayerId(), 'host');
  assert.equal(gone.length, 1);
});

test('a silent host (tab killed, no clean leave) is detected as gone, and back when it speaks again', { timeout: 15000 }, async () => {
  const g = gameIdOf();
  const real = createLocal(g);
  let muted = false;
  const flaky = { ...real, send: (...args) => { if (!muted) real.send(...args); } };
  const host = createSession({ gameId: g, transport: flaky, profile: profileOf('host'), playerId: 'host', isHost: true });
  open.push(host);
  const a = make(g, 'alice');
  const gone = record(a, SESSION_EVENT.hostGone), back = record(a, SESSION_EVENT.hostBack), left = record(a, SESSION_EVENT.peerLeave);
  await until(() => a.hostPlayerId() === 'host');
  back.length = 0;

  muted = true;
  await until(() => gone.length === 1, 8000);
  assert.deepEqual(left[0].data, { playerId: 'host' });
  assert.equal(a.hostPlayerId(), null);

  muted = false;
  await until(() => back.length === 1, 4000);
  assert.equal(a.hostPlayerId(), 'host');
});

test('lagMs: a lagged session still connects and delivers, delayed both ways; the host loopback stays instant', { timeout: 15000 }, async () => {
  const LAG = 150;
  const g = gameIdOf();
  const host = createSession({ gameId: g, transport: 'local', profile: profileOf('host'), playerId: 'host', isHost: true, lagMs: LAG });
  open.push(host);
  const a = make(g, 'alice');
  const atHost = record(host, MSG.intent), atAlice = record(a, MSG.state);
  await until(() => a.hostPlayerId() === 'host' && host.peers().length === 1, 5000);

  // the host's own loopback is a microtask, not delayed
  host.sendToHost(MSG.intent, { intent: 'self' });
  await wait(20);
  assert.equal(atHost.length, 1);

  // client -> lagged host: arrives late
  const t0 = Date.now();
  a.sendToHost(MSG.intent, { intent: 'x' });
  await until(() => atHost.length === 2, 3000);
  assert.ok(Date.now() - t0 >= LAG - 10, `inbound delayed ${Date.now() - t0}ms`);

  // lagged host -> client: arrives late
  const t1 = Date.now();
  host.broadcast(MSG.state, { n: 1 });
  await until(() => atAlice.length === 1, 3000);
  assert.ok(Date.now() - t1 >= LAG - 10, `outbound delayed ${Date.now() - t1}ms`);

  // ping measured through the lagged session = real RTT + 2*lag
  const rtt = await host.ping('alice');
  assert.ok(rtt >= 2 * LAG && rtt < 2 * LAG + 150, `rtt ${rtt}`);
});

test('identity: stable playerId, profile round trip, host marker, saves (with and without storage)', () => {
  assert.doesNotThrow(() => loadIdentity());   // no localStorage in node
  const idNoStorage = loadIdentity('nostore');
  assert.equal(loadIdentity('nostore').playerId, idNoStorage.playerId);
  assert.equal(idNoStorage.profile, null);
  assert.equal(loadSave('g1'), null);
  assert.doesNotThrow(() => { markHost('g1', 'p'); storeSave('g1', '{}'); saveProfile({ name: 'x' }); });
  assert.equal(isHostOf('g1', 'p'), false);

  const data = new Map();
  globalThis.localStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
  try {
    const id = loadIdentity();
    assert.match(id.playerId, /^[0-9a-f-]{36}$/);
    assert.equal(loadIdentity().playerId, id.playerId);
    assert.equal(data.get(KEYS.playerId(null)), id.playerId);
    assert.notEqual(loadIdentity('t2').playerId, id.playerId);
    assert.ok(data.has(KEYS.playerId('t2')));

    saveProfile({ playerId: id.playerId, name: 'Walter', color: '#ff5a5f', hat: 'cap' });
    assert.equal(loadIdentity().profile.name, 'Walter');
    assert.equal(loadIdentity().profile.playerId, id.playerId);
    assert.equal(loadIdentity('t2').profile, null);
    data.set(KEYS.profile(null), 'not json');
    assert.equal(loadIdentity().profile, null);

    assert.equal(isHostOf('g1', id.playerId), false);
    markHost('g1', id.playerId);
    assert.equal(isHostOf('g1', id.playerId), true);
    assert.equal(isHostOf('g1', id.playerId, 't2'), false);
    markHost('g1', 'other', 't2');
    assert.equal(isHostOf('g1', 'other', 't2'), true);

    assert.equal(loadSave('g1'), null);
    storeSave('g1', '{"rev":3}');
    assert.equal(loadSave('g1'), '{"rev":3}');
    assert.equal(data.get(KEYS.save('g1')), '{"rev":3}');

    globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    assert.equal(loadIdentity('broken').playerId, loadIdentity('broken').playerId);
    assert.doesNotThrow(() => { storeSave('g1', 'x'); markHost('g1', 'p'); saveProfile({}); });
    assert.equal(loadSave('g1'), null);
  } finally {
    delete globalThis.localStorage;
  }
});
