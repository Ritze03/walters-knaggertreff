// SFX table for ZzFX 1.4.0 (pure data, safe in node). Each sound = list of parts { at (s), p (21 zzfx params) }.
// zzfx params in order: volume, randomness, frequency, attack, sustain, release, shape (0 sin,1 tri,2 saw,3 tan,4 noise,5 square),
// shapeCurve (square: duty), slide (Hz/s = 500*slide), deltaSlide, pitchJump (Hz), pitchJumpTime (s), repeatTime (s), noise, modulation,
// bitCrush, delay, sustainVolume, decay, tremolo, filter (+lowpass / -highpass, Hz).
// Rough slide maths: slide 1 = +500 Hz per second. Randomness is 0 here; the player varies playback rate instead.

export const ZZFX_PARAMS = ['volume', 'randomness', 'frequency', 'attack', 'sustain', 'release', 'shape', 'shapeCurve', 'slide', 'deltaSlide',
  'pitchJump', 'pitchJumpTime', 'repeatTime', 'noise', 'modulation', 'bitCrush', 'delay', 'sustainVolume', 'decay', 'tremolo', 'filter'];
const DEFAULTS = { volume: 1, randomness: 0, frequency: 220, attack: 0, sustain: 0, release: 0.1, shape: 0, shapeCurve: 1, sustainVolume: 1 };

/** named params -> positional zzfx array (typo in a name throws at load) */
const z = (o, at = 0) => {
  for (const k of Object.keys(o)) if (!ZZFX_PARAMS.includes(k)) throw new Error(`sfx: unknown zzfx param "${k}"`);
  return { at, p: ZZFX_PARAMS.map((k) => o[k] ?? DEFAULTS[k] ?? 0) };
};
/** one note per freq, `gap` seconds apart, same settings */
const run = (freqs, gap, o, at = 0) => freqs.map((frequency, i) => z({ ...o, frequency }, at + i * gap));

const SQ = 5, TRI = 1, SAW = 2, NOISE = 4;

export const SFX_PARAMS = {
  // --- ui ---
  menuMove: [z({ volume: 0.5, frequency: 700, sustain: 0.01, release: 0.04, shape: SQ, shapeCurve: 0.6 })],                    // tiny square blip
  menuSelect: [z({ volume: 0.7, frequency: 660, sustain: 0.04, release: 0.06, shape: TRI }), z({ volume: 0.7, frequency: 990, sustain: 0.06, release: 0.14, shape: TRI }, 0.06)], // happy two-tone ding
  menuBack: [z({ volume: 0.5, frequency: 520, slide: -8, sustain: 0.02, release: 0.07, shape: SQ })],                           // soft falling blip
  error: [z({ volume: 0.8, frequency: 190, sustain: 0.1, release: 0.05, shape: SAW, bitCrush: 0.1 }), z({ volume: 0.8, frequency: 140, sustain: 0.16, release: 0.1, shape: SAW, bitCrush: 0.1 }, 0.14)], // grumpy two-honk buzzer
  join: run([392, 523, 659, 784], 0.07, { volume: 0.54, sustain: 0.04, release: 0.1, shape: SAW, filter: 2200 }),                 // rising kazoo hello
  ready: [z({ volume: 0.7, frequency: 784, sustain: 0.05, release: 0.08, shape: TRI }), z({ volume: 0.7, frequency: 1175, sustain: 0.1, release: 0.2, shape: TRI, pitchJump: 40, pitchJumpTime: 0.08 }, 0.08)], // bright thumbs-up chime

  // --- board ---
  diceRoll: Array.from({ length: 12 }, (_, i) => z({ volume: 0.55, frequency: 260 + ((i * 5) % 7) * 70, sustain: 0.005, release: 0.035, shape: i % 2 ? SQ : NOISE, noise: 0.2 }, i * 0.05)), // slot-machine rattle
  diceLand: [z({ volume: 0.85, frequency: 150, slide: -5, sustain: 0.02, release: 0.14, shape: TRI, noise: 0.3 }), z({ volume: 0.42, frequency: 900, sustain: 0.002, release: 0.02, shape: NOISE }, 0.002)], // wooden thud clack
  step: [z({ volume: 0.35, frequency: 300, slide: 8, sustain: 0.01, release: 0.06 })],                                           // tiny rubbery hop
  coinGain: [z({ volume: 0.59, frequency: 260, slide: 14, sustain: 0.02, release: 0.06 }), z({ volume: 0.85, frequency: 1675, sustain: 0.06, release: 0.24, shape: TRI, shapeCurve: 1.8, pitchJump: 837, pitchJumpTime: 0.06 }, 0.07)], // wet bloop ching
  coinLoss: [z({ volume: 0.5, frequency: 520, slide: -12, sustain: 0.14, release: 0.22, shape: SAW, filter: 1500, tremolo: 0.4, repeatTime: 0.06 }), ...run([2400, 2900, 2600], 0.06, { volume: 0.14, sustain: 0.005, release: 0.07 }, 0.3)], // sad sinking womp
  star: [...run([523, 659, 784, 1047], 0.09, { volume: 0.59, sustain: 0.05, release: 0.08, shape: SAW, filter: 3000 }),
    z({ volume: 0.77, frequency: 1319, sustain: 0.35, release: 0.3, shape: SAW, filter: 3500, tremolo: 0.5, repeatTime: 0.07 }, 0.36),
    z({ volume: 0.26, frequency: 3136, sustain: 0.05, release: 0.4, pitchJump: 600, pitchJumpTime: 0.1 }, 0.36)],              // kazoo sparkle fanfare
  buy: [z({ volume: 0.5, frequency: 3500, sustain: 0.005, release: 0.03, shape: NOISE }), z({ volume: 0.8, frequency: 1568, sustain: 0.02, release: 0.25 }, 0.04), z({ volume: 0.8, frequency: 2093, sustain: 0.02, release: 0.4 }, 0.1)], // ka-ching register
  item: [z({ volume: 0.7, frequency: 300, slide: 30, sustain: 0.12, release: 0.06, shape: TRI, tremolo: 0.5, repeatTime: 0.03 }), z({ volume: 0.7, frequency: 1500, sustain: 0.05, release: 0.25 }, 0.2)], // bubbly magic whoosh-ping
  trap: [z({ volume: 0.8, frequency: 3000, sustain: 0.01, release: 0.05, shape: NOISE }), z({ volume: 0.9, frequency: 220, slide: -30, sustain: 0.03, release: 0.15, shape: SQ }, 0.02),
    z({ volume: 0.8, frequency: 150, slide: 12, sustain: 0.1, release: 0.25, tremolo: 0.6, repeatTime: 0.07 }, 0.2)],           // snap clang sproing
  duel: [z({ volume: 0.44, frequency: 196, sustain: 0.14, release: 0.1, shape: SAW, filter: 1200 }), z({ volume: 0.44, frequency: 262, sustain: 0.14, release: 0.1, shape: SAW, filter: 1200 }, 0.2),
    z({ volume: 0.55, frequency: 4000, sustain: 0.01, release: 0.12, shape: NOISE, filter: -1500 }, 0.42)],                         // western showdown twang-crack
  endspurt: [...run([620, 820, 620, 820, 620, 820], 0.16, { volume: 0.4, sustain: 0.11, release: 0.03, shape: SQ, shapeCurve: 0.8, filter: 2500 }), z({ volume: 0.45, frequency: 400, slide: 60, sustain: 0.25, release: 0.05, shape: SAW, filter: 3500 }, 0.98)], // Ordnungsamt wee-woo sprint
  whoosh: [z({ volume: 0.6, frequency: 70, attack: 0.08, sustain: 0.04, release: 0.2, shape: NOISE, slide: 1, noise: 1, filter: -900 })], // airy swoosh

  // --- countdown / results ---
  tick: [z({ volume: 0.8, frequency: 880, sustain: 0.01, release: 0.07, shape: TRI })],                                          // woodblock beat
  go: [z({ volume: 0.54, frequency: 330, sustain: 0.28, release: 0.2, shape: SAW, filter: 2500, tremolo: 0.2, repeatTime: 0.05 }), z({ volume: 0.54, frequency: 350, sustain: 0.28, release: 0.2, shape: SAW, filter: 2500, tremolo: 0.2, repeatTime: 0.05 }), // clashing air-horn
    z({ volume: 0.3, frequency: 660, sustain: 0.28, release: 0.2, shape: SQ, filter: 2000 })],
  win: [...run([392, 523, 659], 0.1, { volume: 0.52, sustain: 0.06, release: 0.06, shape: SAW, filter: 3000 }), z({ volume: 0.59, frequency: 784, sustain: 0.3, release: 0.25, shape: SAW, filter: 3000, tremolo: 0.3, repeatTime: 0.08 }, 0.3)], // cheeky trumpet riff
  lose: [z({ volume: 0.45, frequency: 311, sustain: 0.2, release: 0.1, shape: SAW, filter: 900, tremolo: 0.3, repeatTime: 0.07 }), z({ volume: 0.45, frequency: 293, sustain: 0.2, release: 0.1, shape: SAW, filter: 900, tremolo: 0.3, repeatTime: 0.07 }, 0.36),
    z({ volume: 0.45, frequency: 277, sustain: 0.2, release: 0.1, shape: SAW, filter: 900, tremolo: 0.3, repeatTime: 0.07 }, 0.72), z({ volume: 0.45, frequency: 233, slide: -4, sustain: 0.55, release: 0.3, shape: SAW, filter: 900, tremolo: 0.6, repeatTime: 0.12 }, 1.08)], // sad trombone wah-wah-wah-waaah
  fanfare: [...run([523, 523, 523, 659, 784], 0.14, { volume: 0.59, sustain: 0.08, release: 0.05, shape: SAW, filter: 3000 }),
    ...run([392, 392, 392, 523, 659], 0.14, { volume: 0.42, sustain: 0.08, release: 0.05, shape: SAW, filter: 3000 }),
    z({ volume: 0.77, frequency: 1047, sustain: 0.55, release: 0.4, shape: SAW, filter: 3500, tremolo: 0.3, repeatTime: 0.09 }, 0.7),
    z({ volume: 0.51, frequency: 784, sustain: 0.55, release: 0.4, shape: SAW, filter: 3000, tremolo: 0.3, repeatTime: 0.09 }, 0.7)], // big brassy ta-ta-ta-TAAA

  // --- minigames ---
  jump: [z({ volume: 0.6, frequency: 250, slide: 6, sustain: 0.06, release: 0.1, shape: TRI })],                                // classic boing hop
  bump: [z({ volume: 0.9, frequency: 120, slide: -4, sustain: 0.02, release: 0.1, shape: TRI, noise: 0.4 })],                  // dull bonk
  mash: [z({ volume: 0.5, frequency: 400, slide: 20, sustain: 0.005, release: 0.04})],                         // bubble pop
  splat: [z({ volume: 0.36, frequency: 90, sustain: 0.05, release: 0.25, shape: NOISE, noise: 0.5, filter: 700 }), z({ volume: 0.24, frequency: 200, slide: -3, sustain: 0.1, release: 0.15, shape: TRI, tremolo: 0.7, repeatTime: 0.03 }, 0.03)], // wet tomato splat
  stamp: [z({ volume: 0.25, frequency: 3000, sustain: 0.005, release: 0.03, shape: NOISE, filter: -1000 }), z({ volume: 0.5, frequency: 100, slide: -2, sustain: 0.03, release: 0.12, shape: SQ, shapeCurve: 0.8, filter: 600 }, 0.05)], // Amt ka-chunk
  jam: [z({ volume: 0.5, frequency: 2400, sustain: 0.01, release: 0.25 }), z({ volume: 0.4, frequency: 3100, sustain: 0.01, release: 0.2 }, 0.06),
    ...[0.3, 0.5, 0.7].map((at, i) => z({ volume: 0.7, frequency: 110 - i * 10, sustain: 0.08, release: 0.06, shape: SAW, bitCrush: 0.3 }, at))], // bottle clink then stuck grind
  boing: [z({ volume: 0.9, frequency: 130, slide: 3, sustain: 0.1, release: 0.15 }), z({ volume: 0.7, frequency: 200, slide: -1, sustain: 0.08, release: 0.2, tremolo: 0.6, repeatTime: 0.06 }, 0.2),
    z({ volume: 0.4, frequency: 260, sustain: 0.05, release: 0.2, tremolo: 0.7, repeatTime: 0.05 }, 0.42)],                        // cartoon spring boing
  bahnDing: [...run([659, 523, 784], 0.32, { volume: 0.7, sustain: 0.04, release: 0.5 }), ...run([1318, 1046, 1568], 0.32, { volume: 0.15, sustain: 0.02, release: 0.4 })], // ding-dong-ding announcement
};

