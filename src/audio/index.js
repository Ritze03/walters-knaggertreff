// AudioApi singleton (contracts.js section 9). Safe in node: nothing touches window/AudioContext/speechSynthesis at import time.
//
// Unlock: ZzFX creates its AudioContext when its module is imported, so we import it lazily (dynamic import) and reuse ZZFX.audioContext for
// SFX, music and the master gain. The import is triggered by the first of: a pointerdown/keydown (initAudio), or the first sfx()/music() call
// (this is the gamepad-only path: browsers that count a gamepad button as activation let the context start, otherwise it stays suspended).
// Every sfx()/music() call and every gesture retries ctx.resume(). While suspended, sfx are dropped (no backlog) and music starts when it resumes.
import { KEYS, MUSIC } from '../contracts.js';
import { pickLine, LINES } from './lines.js';
import { SFX_PARAMS } from './sfx.js';
import { createMusic } from './music.js';
import { initVoice, speak, stopSpeaking } from './voice.js';

const SFX_LEVEL = 0.45, MUSIC_LEVEL = 0.35;   // buses; music is quiet so Discord chatter stays on top

let zz = null, ctx = null, master = null, sfxBus = null, player = null;
let loading = false, armed = false, muted = null, masterVolume = 1, wanted = null;
const buffers = new WeakMap();   // sfx part -> AudioBuffer
const handlers = new Set();
const warned = new Set();
const warnOnce = (msg) => { if (!warned.has(msg)) { warned.add(msg); console.warn(`[audio] ${msg}`); } };

const store = () => { try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; } };

function applyGain() {
  if (master) master.gain.setTargetAtTime(isMuted() ? 0 : masterVolume, ctx.currentTime, 0.02);
}

function resume() {
  if (ctx && ctx.state !== 'running') { try { ctx.resume()?.catch(() => {}); } catch { /* still locked */ } }
}

function loadEngine() {
  if (loading || typeof AudioContext === 'undefined') return;
  loading = true;
  import('zzfx').then(({ ZZFX }) => {
    zz = ZZFX;
    ctx = ZZFX.audioContext;
    master = ctx.createGain();
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = SFX_LEVEL;
    sfxBus.connect(master);
    const musicBus = ctx.createGain();
    musicBus.gain.value = MUSIC_LEVEL;
    musicBus.connect(master);
    player = createMusic(ctx, musicBus);
    master.gain.value = isMuted() ? 0 : masterVolume;
    resume();
    player.play(wanted);
  }).catch((e) => { console.warn('[audio] unavailable, running silent', e); });
}

/** true when sound can play right now; also kicks off loading/resuming */
function ready() {
  loadEngine();
  if (!ctx) return false;
  if (ctx.state !== 'running') { resume(); return false; }
  return true;
}

export function initAudio() {
  if (armed) return;
  armed = true;
  isMuted();
  initVoice();
  if (typeof window === 'undefined' || !window.addEventListener) return;
  const unlock = () => { loadEngine(); resume(); };
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true, passive: true });
}

export function sfx(name, { volume = 1, rate = 1 } = {}) {
  const parts = SFX_PARAMS[name];
  if (!parts) return warnOnce(`unknown sfx "${name}"`);
  if (!ready() || isMuted()) return;
  try {
    const r = rate * (1 + (Math.random() * 2 - 1) * 0.05);   // slight pitch wobble so repeats do not sound robotic
    const t0 = ctx.currentTime + 0.01;
    for (const part of parts) {
      let buf = buffers.get(part);
      if (!buf) {
        const samples = zz.buildSamples(...part.p);
        if (!samples.length) continue;
        buf = ctx.createBuffer(1, samples.length, zz.sampleRate);
        buf.copyToChannel(samples, 0);
        buffers.set(part, buf);
      }
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf;
      src.playbackRate.value = r;
      g.gain.value = Math.max(0, Math.min(1, volume));
      src.connect(g).connect(sfxBus);
      src.start(t0 + part.at / r);
    }
  } catch (e) { warnOnce(`sfx "${name}" failed: ${e}`); }
}

export function music(track) {
  if (track !== null && !MUSIC[track]) return warnOnce(`unknown music "${track}"`);
  wanted = track ?? null;
  loadEngine();
  if (player) { resume(); player.play(wanted); }   // pending until unlock otherwise (engine start applies `wanted`)
}

export function say(idOrText, opts) {
  const text = pickLine(idOrText);
  if (!text) return;
  if (!Object.hasOwn(LINES, idOrText) && /^[a-z][A-Za-z0-9]*$/.test(idOrText)) warnOnce(`unknown line id "${idOrText}"`);
  for (const h of [...handlers]) { try { h(text); } catch (e) { console.error(e); } }   // captions: always, they are the no-voice fallback
  if (!isMuted()) speak(text, opts);
}

export function onCaption(handler) {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function isMuted() {
  if (muted === null) { try { muted = store()?.getItem(KEYS.muted) === '1'; } catch { muted = false; } }
  return muted;
}

export function setMuted(m) {
  muted = !!m;
  try { store()?.setItem(KEYS.muted, muted ? '1' : '0'); } catch { /* not persisted */ }
  applyGain();
  if (muted) stopSpeaking();
}

export function toggleMuted() {
  setMuted(!isMuted());
  return isMuted();
}

/** extra (not in the contract): 0..1 master volume for a future settings slider */
export function setMasterVolume(v) {
  masterVolume = Math.max(0, Math.min(1, v));
  applyGain();
}

