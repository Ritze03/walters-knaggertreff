// AudioApi singleton (contracts.js section 9). Safe in node: nothing touches window/AudioContext/speechSynthesis at import time.
//
// Unlock: ZzFX creates its AudioContext when its module is imported, so we import it lazily (dynamic import) and reuse ZZFX.audioContext for
// SFX, music and the master gain. The import is triggered by the first of: a pointerdown/keydown (initAudio), or the first sfx()/music() call
// (this is the gamepad-only path: browsers that count a gamepad button as activation let the context start, otherwise it stays suspended).
// Every sfx()/music() call and every gesture retries ctx.resume(). While suspended, sfx are dropped (no backlog) and music starts when it resumes.
import { KEYS, MUSIC } from '../contracts.js';
import { pickLine, LINES } from './lines.js';
import { SFX_PARAMS, SFX_TRIM_DB } from './sfx.js';
import { createMusic } from './music.js';
import { initVoice, speak, stopSpeaking } from './voice.js';

// Levels (measured, see sfx.js SFX_TRIM_DB): signal path = bus -> MIX_TRIM -> limiter -> master (slider curve) -> out.
// At slider 100 % the loudest sfx peaks about -8 dBFS / rms about -18 dBFS, music rms about -26 dBFS (sits clearly under sfx, Discord chatter stays on top).
const SFX_LEVEL = 0.5, MUSIC_LEVEL = 0.63, MIX_TRIM = 0.5;

/** slider position 0..1 -> linear gain. Cubic = perceptual (50 % is -18 dB, 20 % is -42 dB); 0 is exactly silent. */
export const volumeToGain = (v) => { const n = Math.max(0, Math.min(1, Number(v) || 0)); return n * n * n; };

let zz = null, ctx = null, master = null, sfxBus = null, player = null;
let loading = false, armed = false, muted = null, masterVolume = null, wanted = null;
const DEFAULT_VOLUME = 0.8;   // slider position (-5.8 dB on the cubic curve)
const buffers = new WeakMap();   // sfx part -> AudioBuffer
const handlers = new Set();
const warned = new Set();
const warnOnce = (msg) => { if (!warned.has(msg)) { warned.add(msg); console.warn(`[audio] ${msg}`); } };

const store = () => { try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; } };

function applyGain() {
  if (master) master.gain.setTargetAtTime(isMuted() ? 0 : volumeToGain(getMasterVolume()), ctx.currentTime, 0.02);
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
    master = ctx.createGain();   // slider volume (curved); mute ramps it to 0
    master.connect(ctx.destination);
    const limiter = ctx.createDynamicsCompressor();   // tames stacked sfx + music: gentle above -20 dB, fast attack so peaks never jump out
    limiter.threshold.value = -20; limiter.knee.value = 10; limiter.ratio.value = 6; limiter.attack.value = 0.003; limiter.release.value = 0.25;
    limiter.connect(master);
    const mix = ctx.createGain();   // fixed headroom in front of everything
    mix.gain.value = MIX_TRIM;
    mix.connect(limiter);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = SFX_LEVEL;
    sfxBus.connect(mix);
    const musicBus = ctx.createGain();
    musicBus.gain.value = MUSIC_LEVEL;
    musicBus.connect(mix);
    player = createMusic(ctx, musicBus);
    master.gain.value = isMuted() ? 0 : volumeToGain(getMasterVolume());
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
    const trim = 10 ** ((SFX_TRIM_DB[name] ?? 0) / 20);
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
      g.gain.value = Math.max(0, Math.min(1, volume)) * trim;
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
  if (!isMuted() && getMasterVolume() > 0) speak(text, { volume: volumeToGain(getMasterVolume()), ...opts });
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

/** 0..1 master volume (ui slider). Persisted in KEYS.volume; mute still wins (gain 0 while muted, volume kept for unmute). */
export function setMasterVolume(v) {
  const n = Number(v);
  masterVolume = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : DEFAULT_VOLUME;
  try { store()?.setItem(KEYS.volume, String(masterVolume)); } catch { /* not persisted */ }
  applyGain();
  if (masterVolume === 0) stopSpeaking();
}

export function getMasterVolume() {
  if (masterVolume === null) {
    let raw = null;
    try { raw = store()?.getItem(KEYS.volume) ?? null; } catch { /* nothing stored */ }
    const n = raw === null || raw === '' ? NaN : Number(raw);
    masterVolume = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : DEFAULT_VOLUME;
  }
  return masterVolume;
}
