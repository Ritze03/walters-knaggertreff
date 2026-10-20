// Identity + per-game storage (contracts section 3). Everything is sync, never throws, and works without localStorage (node, private windows).
import { KEYS } from '../contracts.js';

const memory = new Map();   // fallback so a page without usable storage keeps ONE playerId per pid for its lifetime

const read = (key) => { try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; } };
const write = (key, value) => { try { globalThis.localStorage?.setItem(key, value); } catch { /* quota / private mode: behave as "not stored" */ } };

/** crypto.randomUUID only exists in secure contexts; plain http (LAN testing) needs the getRandomValues path. */
function uuid() {
  const c = globalThis.crypto;
  if (c.randomUUID) return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function loadIdentity(pid = null) {
  const key = KEYS.playerId(pid);
  let playerId = read(key);
  if (!playerId) {
    playerId = memory.get(key) ?? uuid();
    memory.set(key, playerId);
    write(key, playerId);
  }
  let profile = null;
  try {
    const p = JSON.parse(read(KEYS.profile(pid)));
    if (p && typeof p === 'object' && !Array.isArray(p)) profile = { ...p, playerId };
  } catch { /* nothing stored or corrupt */ }
  return { playerId, profile };
}

export function saveProfile(profile, pid = null) {
  try { write(KEYS.profile(pid), JSON.stringify(profile)); } catch { /* unserialisable: ignore */ }
}

export const isHostOf = (gameId, playerId, pid = null) => !!playerId && read(KEYS.host(gameId, pid)) === playerId;
export const markHost = (gameId, playerId, pid = null) => write(KEYS.host(gameId, pid), playerId);

export const loadSave = (gameId, pid = null) => read(KEYS.save(gameId, pid));
export const storeSave = (gameId, json, pid = null) => write(KEYS.save(gameId, pid), json);
