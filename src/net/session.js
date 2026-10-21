// Session: playerId layer on top of a Transport (contracts section 7). Knows peers by playerId, stamps `from`, tracks who the host is.
import { MSG, SESSION_EVENT, PROTOCOL_VERSION } from '../contracts.js';
import { createTransport as createLocal } from './transports/local.js';
import { createTransport as createTrystero } from './transports/trystero.js';
import { withLag } from './lag.js';

export const HEARTBEAT_MS = 1000;   // every session broadcasts a tiny `hb` this often
export const SILENCE_MS = 5000;     // a peer we have heard NOTHING from (any message incl. hb) for this long is treated as left
export const QUEUE_MAX = 32;        // client -> host messages kept while the host link is down (oldest dropped first)
export const QUEUE_MAX_AGE_MS = 10000;   // ... and dropped when they are older than this at flush time
// 30 Hz streams where only the newest frame matters: a replay after a reconnect would be stale, so these are never queued (just lost while disconnected)
const PERISHABLE = new Set([MSG.mgInput, MSG.mgOwn]);
const HB = 'hb';                    // session-internal action, not part of MSG

export function createSession({ gameId, transport, profile, playerId, isHost, isBot = false, lagMs = 0 }) {
  const types = [...Object.values(MSG), HB];
  // `transport` may also be a ready-made Transport object (tests wrap one to simulate a dead peer)
  const rawLink = typeof transport !== 'string' ? transport : transport === 'local' ? createLocal(gameId) : createTrystero(gameId, types);
  // lagMs (debug ?lag=): delay this tab's network traffic both ways. The host's own loopback below (sendToHost / broadcast self) never touches the link, so it stays instant, as in reality.
  const link = withLag(rawLink, lagMs);

  const handlers = new Map();   // type -> Set<handler>
  const peers = new Map();      // transport peerId -> { lastSeen, info: PeerInfo|null }  (info stays null until the peer's hello arrives)
  const peerOf = new Map();     // playerId -> transport peerId (latest connection wins)
  let hostPeerId = null;        // clients only: peerId of the peer that announced isHost:true
  let closed = false;
  let outbox = [];              // clients only: { type, data, at } waiting for a host link (reliable messages = intents)

  const emit = (type, data, from) => {
    for (const h of [...(handlers.get(type) ?? [])]) {
      try { h(data, from); } catch (e) { console.error(`[net] handler for "${type}" threw`, e); }
    }
  };

  const sendHello = (peerId, reply = true) => link.send(MSG.hello, {
    protocol: PROTOCOL_VERSION, playerId, profile, isHost, isBot: !!isBot, ...(reply ? {} : { reply: false }),
  }, peerId);

  function touch(peerId) {
    let p = peers.get(peerId);
    if (!p) peers.set(peerId, (p = { lastSeen: 0, info: null }));
    p.lastSeen = Date.now();
    return p;
  }

  function dropPeer(peerId) {
    const p = peers.get(peerId);
    if (!p) return;   // unknown, or already replaced by a newer connection of the same player
    peers.delete(peerId);
    if (!p.info) return;
    if (peerOf.get(p.info.playerId) === peerId) {
      peerOf.delete(p.info.playerId);
      emit(SESSION_EVENT.peerLeave, { playerId: p.info.playerId }, p.info.playerId);
    }
    if (hostPeerId === peerId) {
      hostPeerId = null;
      emit(SESSION_EVENT.hostGone, {}, p.info.playerId);
    }
  }

  function onHello(peerId, p, m) {
    // ignore garbage and anything claiming OUR playerId (a second tab of the same browser identity)
    if (!m || typeof m.playerId !== 'string' || !m.playerId || m.playerId === playerId) return;
    const first = !p.info;
    const info = {
      playerId: m.playerId,
      profile: m.profile && typeof m.profile === 'object' ? m.profile : {},
      isHost: m.isHost === true,
      isBot: m.isBot === true,
      protocol: m.protocol,   // extra vs PeerInfo: lets the host driver reject 'protocol' mismatches
      pingMs: p.info?.pingMs ?? null,
    };
    const hostWasKnown = hostPeerId !== null;
    // same player on a new connection (reload before the old one timed out): the old connection is simply replaced, no leave/gone events
    const old = peerOf.get(info.playerId);
    if (old && old !== peerId) {
      peers.delete(old);
      if (hostPeerId === old) hostPeerId = null;
    }
    p.info = info;
    peerOf.set(info.playerId, peerId);
    if (first) emit(SESSION_EVENT.peerJoin, { ...info }, info.playerId);
    let answered = m.reply !== false;   // peers answer a hello once so everybody learns everybody, even after a one-sided drop
    if (!isHost && info.isHost) {
      hostPeerId = peerId;
      if (!hostWasKnown) {
        emit(SESSION_EVENT.hostBack, { playerId: info.playerId }, info.playerId);
        answered = true;   // (re)send our hello so the host can seatJoin us
      }
    }
    if (answered) sendHello(peerId, false);
    if (hostPeerId === peerId) flushOutbox();   // after our hello, so the host knows who these intents are from
  }

  function flushOutbox() {
    const now = Date.now(), list = outbox;
    outbox = [];
    for (const m of list) if (now - m.at <= QUEUE_MAX_AGE_MS) link.send(m.type, m.data, hostPeerId);
  }

  function onInbound(type, data, peerId) {
    if (closed) return;
    let p = peers.get(peerId);
    if (!p) { p = touch(peerId); sendHello(peerId); }   // a peer we dropped (or never saw join) is talking: introduce ourselves again
    else p.lastSeen = Date.now();
    if (type === MSG.hello) return onHello(peerId, p, data);
    if (type === HB || !p.info) return;                 // messages before hello have no known sender
    emit(type, data, p.info.playerId);
  }

  for (const type of types) link.onMessage(type, (data, peerId) => onInbound(type, data, peerId));
  link.onPeerJoin((peerId) => { if (!closed) { touch(peerId); sendHello(peerId); } });
  link.onPeerLeave(dropPeer);
  link.onError?.((e) => emit(SESSION_EVENT.error, { message: String(e?.message ?? e) }, playerId));

  const timer = setInterval(() => {
    link.send(HB, 0);
    const now = Date.now();
    for (const [peerId, p] of peers) if (now - p.lastSeen > SILENCE_MS) dropPeer(peerId);
  }, HEARTBEAT_MS);

  const sendToHost = (type, data) => {
    if (isHost) queueMicrotask(() => { if (!closed) emit(type, data, playerId); });
    else if (hostPeerId) link.send(type, data, hostPeerId);
    else if (!PERISHABLE.has(type)) {   // host link down (silence / replaced connection): keep it for when the host is back
      const now = Date.now();
      outbox = outbox.filter((m) => now - m.at <= QUEUE_MAX_AGE_MS);
      outbox.push({ type, data, at: now });
      if (outbox.length > QUEUE_MAX) outbox.shift();
    }
  };

  return {
    gameId,
    transport: typeof transport === 'string' ? transport : 'custom',
    selfPlayerId: playerId,
    isHost,
    hostPlayerId: () => (isHost ? playerId : (peers.get(hostPeerId)?.info.playerId ?? null)),
    peers: () => [...peers.values()].filter((p) => p.info).map((p) => ({ ...p.info })),
    sendIntent: (intent) => sendToHost(MSG.intent, { intent }),
    send(type, data, toPlayerId) {
      const peerId = peerOf.get(toPlayerId);
      if (peerId) link.send(type, data, peerId);
    },
    sendToHost,
    broadcast(type, data, { self = false } = {}) {
      link.send(type, data);
      if (self) queueMicrotask(() => { if (!closed) emit(type, data, playerId); });
    },
    on(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
      return () => handlers.get(type)?.delete(handler);
    },
    ping(toPlayerId) {
      const peerId = peerOf.get(toPlayerId);
      if (!peerId) return Promise.reject(new Error(`unknown player ${toPlayerId}`));
      return link.ping(peerId).then((ms) => { const info = peers.get(peerId)?.info; if (info) info.pingMs = ms; return ms; });
    },
    leave() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      link.leave();
      handlers.clear();
    },
  };
}
