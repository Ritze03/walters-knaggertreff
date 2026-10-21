// Artificial network latency for testing (?lag=<ms>): wraps a transport link so everything this tab SENDS and RECEIVES is
// delayed by `ms`. Peer join/leave/error events pass through untouched (connection state is not "traffic"). ms <= 0 returns the link as is.
// Order is kept: setTimeout with one equal delay fires in scheduling order (same delay => FIFO), so messages never overtake each other.
// Pings: the transport answers pongs inside itself (no hook), so ping() is delayed here instead: ms out + the real round trip + ms in,
// and the reported value is real RTT + 2*ms. That is what a peer that is really `ms` slower in both directions would measure.

export function withLag(link, ms) {
  ms = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
  if (!ms) return link;
  let closed = false;
  const later = (fn) => { setTimeout(() => { if (!closed) fn(); }, ms); };
  // the payload is snapshotted at send time, as a real wire would: the sender may reuse/mutate its object before the delayed delivery
  const snap = (data) => { try { return structuredClone(data); } catch { return data; } };
  const lagged = { ...link };
  lagged.send = (type, data, target) => { const d = snap(data); later(() => link.send(type, d, target)); };
  if (link.broadcast) lagged.broadcast = (type, data) => { const d = snap(data); later(() => link.broadcast(type, d)); };
  lagged.onMessage = (type, handler) => link.onMessage(type, (data, peerId) => later(() => handler(data, peerId)));
  if (link.ping) {
    lagged.ping = (peerId) => new Promise((resolve, reject) => {
      later(() => link.ping(peerId).then(
        (rtt) => setTimeout(() => (closed ? reject(new Error('left')) : resolve(rtt + 2 * ms)), ms),
        reject,
      ));
    });
  }
  lagged.leave = () => { closed = true; link.leave(); };
  return lagged;
}
