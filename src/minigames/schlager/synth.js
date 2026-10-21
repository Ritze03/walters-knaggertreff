// The Schlager Hero band: a tiny Web Audio synth that plays the song from song.js (four-on-the-floor kick, oompah bass + chord stabs, claps,
// offbeat hats, accordion-ish lead). It uses the SAME AudioContext as the shared sfx/music (ZZFX's, reached via the same dynamic import
// src/audio uses), and its own gain stage that follows ctx.audio's mute + master volume. Nothing here runs at import time.
import { BPM, EIGHTH, END_SLOT, SLOTS_PER_BAR, chordOf, melodyEvents, hz } from './song.js';

const LEVEL = 0.55;   // our master vs. the shared music bus (which sits at about 0.3 after its own trims); the compressor below tames the sum

/** slider position -> linear gain; same cubic curve as src/audio (volumeToGain), duplicated so this file stays import-free */
const curve = (v) => { const n = Math.max(0, Math.min(1, Number(v) || 0)); return n * n * n; };

/** Resolves the shared AudioContext (or null when audio is unavailable). Safe to call many times. */
export async function sharedContext() {
  try {
    if (typeof AudioContext === 'undefined') return null;
    const { ZZFX } = await import('zzfx');
    return ZZFX.audioContext ?? null;
  } catch { return null; }
}

export function createBand(actx, audio) {
  const master = actx.createGain();
  const comp = actx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
  const bus = actx.createGain();
  bus.gain.value = 0.9;
  bus.connect(comp); comp.connect(master); master.connect(actx.destination);
  const noise = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;   // audio-only noise, never gameplay

  const lead = new Map(melodyEvents().map((e) => [e.slot, e]));
  let next = 0, closed = false;

  const syncVolume = () => {
    const g = audio.isMuted() ? 0 : curve(audio.getMasterVolume()) * LEVEL;
    master.gain.setTargetAtTime(g, actx.currentTime, 0.03);
  };
  syncVolume();

  const env = (g, t, peak, a, dur) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + 0.02, dur));
  };
  function tone(f, t, dur, { type = 'sawtooth', gain = 0.2, lp = 2400, a = 0.006, detune = 0, slideTo = 0 } = {}) {
    const o = actx.createOscillator(), g = actx.createGain(), fl = actx.createBiquadFilter();
    o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur * 0.9);
    fl.type = 'lowpass'; fl.frequency.value = lp;
    env(g, t, gain, a, dur);
    o.connect(fl).connect(g).connect(bus);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function hit(t, { hp = 7000, dur = 0.05, gain = 0.1, band = 0 } = {}) {
    const s = actx.createBufferSource(), g = actx.createGain(), f = actx.createBiquadFilter();
    s.buffer = noise;
    f.type = band ? 'bandpass' : 'highpass'; f.frequency.value = hp;
    env(g, t, gain, 0.002, dur);
    s.connect(f).connect(g).connect(bus);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  const kick = (t) => tone(130, t, 0.16, { type: 'sine', gain: 0.9, lp: 600, a: 0.002, slideTo: 42 });
  const clap = (t) => { hit(t, { hp: 1500, band: 1, dur: 0.09, gain: 0.35 }); hit(t + 0.012, { hp: 2200, band: 1, dur: 0.07, gain: 0.25 }); };

  /** schedule everything that happens in 8th-note `slot` at audio time `t` */
  function playSlot(slot, t) {
    const bar = Math.floor(slot / SLOTS_PER_BAR), pos = slot % SLOTS_PER_BAR;
    if (slot >= END_SLOT) {
      if (slot === END_SLOT) { kick(t); for (const n of ['C3', 'E4', 'G4', 'C5']) tone(hz(n), t, 0.9, { gain: 0.18, lp: 2200 }); }
      return;
    }
    const ch = chordOf(bar), beat = EIGHTH * 2;
    if (pos % 2 === 0) kick(t);                                          // four on the floor
    if (pos === 2 || pos === 6) clap(t);                                 // clap on 2 and 4
    if (pos % 2 === 1) hit(t, { hp: 8000, dur: 0.045, gain: 0.07 });    // offbeat hats
    if (pos === 0) tone(hz(ch.r), t, beat * 0.85, { type: 'sawtooth', gain: 0.32, lp: 700 });   // oom
    if (pos === 4) tone(hz(ch.f), t, beat * 0.85, { type: 'sawtooth', gain: 0.32, lp: 700 });   // oom
    if (pos === 2 || pos === 6) for (const n of ch.st) tone(hz(n), t, beat * 0.5, { type: 'square', gain: 0.045, lp: 2200 });   // pah
    if (bar === 0) return;                                               // count-in: drums + bass only
    const ev = lead.get(slot);
    if (ev) {   // accordion-ish: two slightly detuned saws
      const dur = ev.len * EIGHTH * 0.92;
      tone(hz(ev.note), t, dur, { gain: 0.085, lp: 3200, a: 0.012, detune: -7 });
      tone(hz(ev.note), t, dur, { gain: 0.085, lp: 3200, a: 0.012, detune: 7 });
    }
  }

  return {
    bpm: BPM,
    /** call every frame with the song clock (seconds); `now` = audio time that matches clock 0 */
    pump(clock, t0) {
      if (closed) return;
      syncVolume();
      while (next <= END_SLOT && next * EIGHTH < clock + 0.25) {
        const t = t0 + next * EIGHTH;
        if (t >= actx.currentTime - 0.02) playSlot(next, Math.max(t, actx.currentTime));
        next++;
      }
    },
    /** short rewarding blip when the player hits a note (pentatonic by lane) */
    blip(lane, grade) {
      if (closed) return;
      const f = hz(['C6', 'D6', 'E6', 'G6'][lane] ?? 'C6');
      tone(f, actx.currentTime, 0.12, { type: 'triangle', gain: grade === 'perfekt' ? 0.16 : 0.1, lp: 5000, a: 0.003 });
    },
    close() {
      if (closed) return;
      closed = true;
      try { master.gain.cancelScheduledValues(actx.currentTime); master.gain.setTargetAtTime(0, actx.currentTime, 0.12); } catch { /* context gone */ }
      setTimeout(() => { try { master.disconnect(); } catch { /* already disconnected */ } }, 1500);
    },
  };
}
