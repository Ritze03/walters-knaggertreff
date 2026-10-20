// Procedural music: tiny step sequencer on WebAudio (lookahead scheduler). No window/AudioContext access at module load.
// Notation: voice = "NOTE:steps" tokens (16 steps = 1 bar, '-' = rest, 'C4+E4+G4' = chord). Drums = x (hit) / o (soft) / . strings, looped.
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const midi = (n) => {
  const m = /^([A-G])([#b]?)(\d)$/.exec(n);
  if (!m) throw new Error(`music: bad note "${n}"`);
  return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
};
const bars = (...b) => b.join(' ');
// oom-pah: bass on beats 1+3, chord stabs on 2+4
const oomBass = (r1, r2) => `${r1}:3 -:5 ${r2}:3 -:5`;
const pahChord = (c) => `-:4 ${c}:2 -:2 -:4 ${c}:2 -:2`;
const eighths = (r) => Array(8).fill(`${r}:1 -:1`).join(' ');
const arp = (a) => [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 1, 3, 2].map((i) => `${a[i]}:1`).join(' ');

const C = 'C4+E4+G4', F = 'F3+A3+C4', G = 'G3+B3+D4', G7 = 'G3+B3+D4+F4';
const POLKA_BASS = [oomBass('C2', 'G2'), oomBass('C2', 'G2'), oomBass('G1', 'D2'), oomBass('C2', 'G2'), oomBass('C2', 'G2'), oomBass('F2', 'C2'), oomBass('G1', 'D2'), oomBass('C2', 'G2')];
const POLKA_CHORDS = [C, C, G7, C, C, F, G7, C].map(pahChord);
const POLKA_DRUMS = { kick: 'x.......x.......', snare: '....x.......x...', hat: 'o.o.o.o.o.o.o.o.' };

/** wave/gain/env [attack, decay(time const), sustain ratio, release] / lp (lowpass Hz). gain = level before the music bus. */
export const TRACKS = {
  // chill, a bit cheesy: Fahrstuhl-Schlager in C, shuffled
  lobby: {
    bpm: 92, swing: 0.14, drumGain: 0.5,
    voices: [
      { wave: 'triangle', gain: 0.22, env: [0.03, 0.3, 0.6, 0.4], notes: bars('C4+E4+G4:16', 'A3+C4+E4:16', 'F3+A3+C4:16', 'G3+B3+D4:16', 'C4+E4+G4:16', 'A3+C4+E4:16', 'F3+A3+C4:16', 'G3+B3+D4:16') },
      { wave: 'sine', gain: 0.4, env: [0.01, 0.15, 0.5, 0.1], notes: bars('C2:6 -:2 G2:6 -:2', 'A1:6 -:2 E2:6 -:2', 'F2:6 -:2 C2:6 -:2', 'G1:6 -:2 D2:6 -:2', 'C2:6 -:2 G2:6 -:2', 'A1:6 -:2 E2:6 -:2', 'F2:6 -:2 C2:6 -:2', 'G1:6 -:2 D2:6 -:2') },
      { wave: 'triangle', gain: 0.3, env: [0.01, 0.2, 0.5, 0.15], lp: 3000, notes: bars('E5:4 G5:4 E5:2 -:2 D5:2 C5:2', 'C5:4 E5:4 A5:6 -:2', 'A5:4 G5:2 F5:2 E5:4 F5:4', 'D5:6 -:2 G5:4 B5:2 D6:2', 'E5:4 G5:4 C6:4 B5:2 A5:2', 'A5:6 G5:2 E5:4 C5:4', 'F5:4 A5:4 G5:2 F5:2 E5:2 D5:2', 'G5:8 -:4 D5:2 G4:2') },
    ],
    drums: { kick: 'x.......x.......', snare: '....o.......o...', hat: '.o.o.o.o.o.o.o.o' },
  },
  // bouncy polka / oom-pah, German Schlager parody
  board: {
    bpm: 128, swing: 0, drumGain: 0.55,
    voices: [
      { wave: 'sawtooth', gain: 0.3, env: [0.005, 0.1, 0.4, 0.06], lp: 900, notes: bars(...POLKA_BASS) },
      { wave: 'square', gain: 0.2, env: [0.005, 0.06, 0.3, 0.05], lp: 2500, notes: bars(...POLKA_CHORDS) },
      { wave: 'square', gain: 0.22, env: [0.01, 0.12, 0.6, 0.08], lp: 3500, notes: bars('E5:2 G5:2 C6:4 G5:2 E5:2 C5:4', 'D5:2 E5:2 F5:2 E5:2 D5:4 -:4', 'G5:2 B5:2 D6:4 B5:2 G5:2 F5:4', 'E5:4 D5:2 C5:2 C5:8', 'E5:2 G5:2 C6:4 E6:2 C6:2 G5:4', 'A5:2 C6:2 F6:4 C6:2 A5:2 F5:4', 'D6:2 B5:2 G5:2 B5:2 D6:4 F6:4', 'E6:4 C6:4 G5:4 C5:4') },
    ],
    drums: POLKA_DRUMS,
  },
  // faster and tense: A minor, pumping 8ths, 16th arpeggio
  minigame: {
    bpm: 152, swing: 0, drumGain: 0.6,
    voices: [
      { wave: 'sawtooth', gain: 0.3, env: [0.003, 0.08, 0.5, 0.04], lp: 800, notes: bars(...['A1', 'F1', 'C2', 'G1', 'A1', 'F1', 'E1', 'E1'].map(eighths)) },
      { wave: 'square', gain: 0.14, env: [0.002, 0.05, 0.3, 0.03], lp: 3000, notes: bars(...[['A4', 'C5', 'E5', 'A5'], ['F4', 'A4', 'C5', 'F5'], ['C5', 'E5', 'G5', 'C6'], ['G4', 'B4', 'D5', 'G5'], ['A4', 'C5', 'E5', 'A5'], ['F4', 'A4', 'C5', 'F5'], ['E4', 'G#4', 'B4', 'E5'], ['E4', 'G#4', 'B4', 'E5']].map(arp)) },
      { wave: 'sawtooth', gain: 0.17, env: [0.01, 0.15, 0.6, 0.1], lp: 2800, notes: bars('A5:6 -:2 G5:4 E5:4', 'F5:6 -:2 E5:4 C5:4', 'E5:6 -:2 G5:4 C6:4', 'D5:6 -:2 B4:4 D5:4', 'A5:6 -:2 C6:4 E6:4', 'F6:6 -:2 E6:4 C6:4', 'B5:6 -:2 G#5:4 E5:4', 'B5:2 G#5:2 E5:2 G#5:2 B5:8') },
    ],
    drums: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'xoxoxoxoxoxoxoxo' },
  },
  // fanfare in bars 1-2, then a jolly oom-pah celebration; loops
  victory: {
    bpm: 124, swing: 0, drumGain: 0.55,
    voices: [
      { wave: 'sawtooth', gain: 0.3, env: [0.005, 0.1, 0.4, 0.06], lp: 900, notes: bars(oomBass('C2', 'G2'), oomBass('C2', 'G2'), oomBass('C2', 'G2'), oomBass('G1', 'D2'), oomBass('F2', 'C2'), oomBass('C2', 'G2'), oomBass('G1', 'D2'), oomBass('C2', 'G2')) },
      { wave: 'square', gain: 0.2, env: [0.005, 0.06, 0.3, 0.05], lp: 2500, notes: bars(...[C, C, C, G, F, C, G7, C].map(pahChord)) },
      { wave: 'sawtooth', gain: 0.24, env: [0.01, 0.12, 0.7, 0.08], lp: 3200, notes: bars('C5:2 C5:2 C5:2 -:2 E5:4 G5:4', 'C6:12 G5:2 C6:2', 'E5:2 G5:2 E5:2 G5:2 C6:8', 'D6:2 B5:2 G5:2 B5:2 D6:8', 'A5:2 C6:2 A5:2 C6:2 F6:8', 'G5:2 E5:2 G5:2 C6:2 E6:8', 'D6:4 B5:4 G5:4 F5:4', 'C6:4 G5:4 E5:4 C5:4') },
    ],
    drums: POLKA_DRUMS,
  },
};

function parseVoice(str) {
  const ev = new Map();
  let step = 0;
  for (const tok of str.trim().split(/\s+/)) {
    const [n, l] = tok.split(':');
    const len = +l;
    if (!(len > 0)) throw new Error(`music: bad token "${tok}"`);
    if (n !== '-') ev.set(step, { midis: n.split('+').map(midi), len });
    step += len;
  }
  return { ev, steps: step };
}

/** parse + validate (throws on inconsistent track). steps = loop length in 16ths. */
export function compileTrack(def) {
  const voices = def.voices.map((v) => ({ ...v, ...parseVoice(v.notes) }));
  const steps = voices[0].steps;
  for (const v of voices) if (v.steps !== steps) throw new Error(`music: voice length ${v.steps} != ${steps}`);
  for (const [k, p] of Object.entries(def.drums)) if (steps % p.length) throw new Error(`music: drum ${k} length ${p.length} does not divide ${steps}`);
  return { ...def, voices, steps };
}

const FADE = 0.7;          // crossfade seconds
const LOOKAHEAD = 0.3;     // seconds scheduled ahead
const TICK_MS = 50;

/** createMusic(ctx, out): { play(name|null) }. One scheduler, at most one non-fading track at a time. */
export function createMusic(ctx, out) {
  const compiled = {};
  let active = [];         // instances still audible (current + fading)
  let current = null;
  let timer = null;
  let noise = null;

  const noiseBuf = () => {
    if (!noise) {
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noise;
  };

  function noteOn(bus, v, midis, t, dur) {
    const [a, d, s, r] = v.env;
    const peak = v.gain / Math.sqrt(midis.length);
    for (const m of midis) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = v.wave;
      o.frequency.value = 440 * 2 ** ((m - 69) / 12);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + a);
      g.gain.setTargetAtTime(peak * s, t + a, d);
      g.gain.setTargetAtTime(0, t + dur, r / 3);
      o.connect(g).connect(bus);
      o.start(t);
      o.stop(t + dur + r * 2);
    }
  }

  function noiseHit(dest, t, vol, len, type, freq) {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf();
    f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + len + 0.02);
  }

  function drum(dest, kind, t, vol) {
    if (kind === 'kick') {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.connect(g).connect(dest);
      o.start(t); o.stop(t + 0.22);
    } else if (kind === 'snare') {
      noiseHit(dest, t, vol * 0.8, 0.14, 'highpass', 1800);
    } else {
      noiseHit(dest, t, vol * 0.35, 0.04, 'highpass', 7500);
    }
  }

  function scheduleStep(inst, step, t) {
    const tr = inst.tr, sec = inst.sec;
    tr.voices.forEach((v, i) => {
      const e = v.ev.get(step);
      if (e) noteOn(inst.buses[i], v, e.midis, t, e.len * sec * 0.9);
    });
    for (const [kind, pat] of Object.entries(tr.drums)) {
      const c = pat[step % pat.length];
      if (c !== '.') drum(inst.drums, kind, t, tr.drumGain * (c === 'o' ? 0.5 : 1));
    }
  }

  function tick() {
    const horizon = ctx.currentTime + LOOKAHEAD;
    for (const inst of active) {
      if (inst.ending) continue;
      while (inst.next < horizon) {
        const s = inst.step % inst.tr.steps;
        scheduleStep(inst, s, inst.next + (s & 1 ? inst.tr.swing * inst.sec : 0));
        inst.next += inst.sec;
        inst.step++;
      }
    }
  }

  function fadeOut(inst, secs) {
    inst.ending = true;
    const now = ctx.currentTime, p = inst.g.gain;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(0, now + secs);
    setTimeout(() => {
      inst.g.disconnect();
      active = active.filter((i) => i !== inst);
      if (!active.length && timer) { clearInterval(timer); timer = null; }
    }, secs * 1000 + 100);
  }

  return {
    play(name) {
      if (name === (current?.name ?? null)) return;
      if (current) fadeOut(current, name ? FADE : 0.4);
      current = null;
      if (!name || !TRACKS[name]) return;
      const tr = (compiled[name] ??= compileTrack(TRACKS[name]));
      const now = ctx.currentTime;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(1, now + FADE);
      g.connect(out);
      const mk = (lp) => {
        const b = ctx.createGain();
        if (!lp) { b.connect(g); return b; }
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = lp;
        b.connect(f).connect(g);
        return b;
      };
      const drums = ctx.createGain();
      drums.connect(g);
      current = { name, tr, g, drums, buses: tr.voices.map((v) => mk(v.lp)), sec: 60 / tr.bpm / 4, next: now + 0.08, step: 0, ending: false };
      active.push(current);
      timer ??= setInterval(tick, TICK_MS);
      tick();
    },
  };
}
