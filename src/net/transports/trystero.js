// Production transport: Trystero 0.26.0 (Nostr strategy = package default export), loaded lazily so node tests and ?local never pull it in.
// createTransport returns synchronously; the room is joined once the module has loaded. Until then sends are dropped (there are no peers yet).
import { APP_ID, MSG } from '../../contracts.js';

/** @param {string} gameId room id
 *  @param {string[]} types action names to create (<= 32 bytes each); every peer must create the same set up front */
export function createTransport(gameId, types = Object.values(MSG)) {
  const actions = {}, handlers = new Map();
  let room = null, selfId = null, left = false;
  let joinHandler = null, leaveHandler = null, errorHandler = null;

  (async () => {
    const trystero = await import('trystero');
    if (left) return;
    selfId = trystero.selfId;
    room = trystero.joinRoom({ appId: APP_ID }, gameId, { onJoinError: (e) => errorHandler?.(new Error(e.error)) });
    for (const type of types) {
      const action = room.makeAction(type);
      action.onMessage = (data, { peerId }) => handlers.get(type)?.(data, peerId);
      actions[type] = action;
    }
    room.onPeerJoin = (id) => joinHandler?.(id);
    room.onPeerLeave = (id) => leaveHandler?.(id);
  })().catch((e) => errorHandler?.(e));

  return {
    get selfId() { return selfId; },   // null until the Trystero module has loaded
    send(type, data, target) {
      actions[type]?.send(data, target ? { target } : undefined).catch(() => {});
    },
    onMessage: (type, handler) => handlers.set(type, handler),
    onPeerJoin(handler) { joinHandler = handler; if (room) room.onPeerJoin = (id) => joinHandler?.(id); },   // re-assigning replays peers already present
    onPeerLeave(handler) { leaveHandler = handler; },
    onError(handler) { errorHandler = handler; },   // extra, optional: import / join failures (session turns it into SESSION_EVENT.error)
    ping: (peerId) => (room ? room.ping(peerId) : Promise.reject(new Error('not connected'))),
    leave() { left = true; room?.leave().catch(() => {}); },
  };
}
