// "Schlager Hero": the song, the note chart and the scoring rules. PURE (no Kaplay, no Web Audio, no Math.random), unit-tested in schlager.test.js.
// Time is seconds since go(). Bar 0 is a count-in (drums + bass only), bars 1..16 carry the melody and the chart.

export const BPM = 124;
export const SPB = 60 / BPM;           // seconds per beat
export const EIGHTH = SPB / 2;         // one grid slot
export const BARS = 16;                // melody bars
export const SLOTS_PER_BAR = 8;
export const END_SLOT = (BARS + 1) * SLOTS_PER_BAR;   // the closing chord hit
export const FALL = 1.6;               // seconds a note needs from the top to the hit line
export const NOTE_PERFEKT = 0.055;     // |dt| in seconds
export const NOTE_GUT = 0.12;
export const NOTE_DANEBEN = 0.16;      // beyond this a press is a stray press, a note is lost
export const EKSTASE_SECS = 8;
export const EKSTASE_AT = 10;          // combo that starts the Schlager-Ekstase (again at 30, 50, ...)
export const POINTS = { perfekt: 300, gut: 150 };
export const DURATION_MS = 36000;

// lane order = left to right = LEFT, DOWN, UP, RIGHT (the four directions of dpad / stick / WASD / arrows)
export const LANES = ['left', 'down', 'up', 'right'];

const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LETTER_IDX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
export const midi = (n) => { const m = /^([A-G])(\d)$/.exec(n); return 12 * (+m[2] + 1) + NAMES[m[1]]; };
export const hz = (n) => 440 * 2 ** ((midi(n) - 69) / 12);
const degree = (n) => LETTER_IDX[n[0]] + 7 * +n[1];

// 8 eighths per bar; '.' = hold / rest. C major, Discofox-simple and repetitive on purpose.
const MELODY = [
  'E5 . G5 . E5 G5 C6 .', 'A5 . F5 . A5 . C6 A5', 'B5 . G5 . B5 D6 B5 .', 'C6 . . . G5 . E5 .',
  'E5 G5 C6 G5 E6 . C6 .', 'F6 . C6 A5 F5 . A5 C6', 'D6 . B5 G5 B5 . D6 .', 'C6 . G5 . C6 . . .',
  'E5 G5 C6 . E6 . D6 C6', 'C6 . A5 . E6 . C6 A5', 'A5 . C6 . F6 . E6 D6', 'D6 . B5 . G5 B5 D6 .',
  'E6 . D6 C6 G5 . E5 .', 'F6 . E6 D6 C6 . A5 .', 'G6 . D6 B5 G5 . B5 D6', 'C6 . . . C6 . . .',
].map((s) => s.split(' '));
// chord per bar (bar 0 = count-in): root bass note, fifth, chord stab notes
const CH = {
  C: { r: 'C2', f: 'G2', st: ['E4', 'G4', 'C5'] },
  F: { r: 'F2', f: 'C3', st: ['F4', 'A4', 'C5'] },
  G: { r: 'G1', f: 'D2', st: ['D4', 'G4', 'B4'] },
  A: { r: 'A1', f: 'E2', st: ['E4', 'A4', 'C5'] },
};
const PROG = 'C F G C C F G C C A F G C F G C'.split(' ');
export const chordOf = (bar) => CH[bar <= 0 ? 'C' : PROG[Math.min(BARS, bar) - 1]];

/** melody note onsets: [{ slot (absolute 8th), note, len (in slots) }] */
export function melodyEvents() {
  const out = [];
  MELODY.forEach((bar, b) => {
    bar.forEach((tok, i) => {
      if (tok === '.') return;
      let len = 1;
      while (i + len < 8 && bar[i + len] === '.') len++;
      out.push({ slot: (b + 1) * SLOTS_PER_BAR + i, note: tok, len });
    });
  });
  return out;
}

/** The chart: one note per melody onset (thinned out in the early bars), lane follows the pitch. Same seed = same chart. */
export function buildChart(rng) {
  const notes = [];
  const keep = (bar) => (bar <= 4 ? 0.8 : bar <= 8 ? 0.95 : 1);
  for (const ev of melodyEvents()) {
    const bar = Math.floor(ev.slot / SLOTS_PER_BAR);
    const r = rng.next(), jitter = rng.next(), dir = rng.next();   // always draw all three: the stream must not depend on a branch
    if (r > keep(bar)) continue;
    let lane = Math.min(3, Math.max(0, Math.floor((degree(ev.note) - 35) / 3)));
    if (jitter < 0.3) lane = Math.min(3, Math.max(0, lane + (dir < 0.5 ? -1 : 1)));
    notes.push({ id: notes.length, t: ev.slot * EIGHTH, lane, slot: ev.slot });
  }
  return notes;
}

export const multiplier = (combo) => 1 + Math.min(3, Math.floor(combo / 10));

/** "12340" -> "12.340" */
export const formatPoints = (n) => String(Math.max(0, Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/**
 * Rule engine. press(lane, t) and tick(t) return arrays of events:
 *  {type:'hit', grade:'perfekt'|'gut', note, pts} | {type:'miss', reason:'late'|'sloppy'|'stray', lane, note?} | {type:'ekstase'} | {type:'ekstaseEnd'}
 */
export function createPlay(chart) {
  const notes = chart.map((n) => ({ ...n, done: false }));
  const play = {
    notes, score: 0, combo: 0, maxCombo: 0, ekstaseUntil: 0, counts: { perfekt: 0, gut: 0, daneben: 0 },
    isEkstase: (t) => t < play.ekstaseUntil,
    press(lane, t) {
      const ev = [];
      let best = null;
      for (const n of notes) {
        if (n.done || n.lane !== lane) continue;
        if (n.t - t > NOTE_DANEBEN) break;      // notes are sorted by time
        const d = Math.abs(n.t - t);
        if (d <= NOTE_DANEBEN && (!best || d < Math.abs(best.t - t))) best = n;
      }
      if (!best) { breakCombo(ev); play.counts.daneben++; ev.push({ type: 'miss', reason: 'stray', lane }); return ev; }
      best.done = true;
      const d = Math.abs(best.t - t);
      if (d > NOTE_GUT) { breakCombo(ev); play.counts.daneben++; ev.push({ type: 'miss', reason: 'sloppy', lane, note: best }); return ev; }
      const grade = d <= NOTE_PERFEKT ? 'perfekt' : 'gut';
      play.counts[grade]++;
      play.combo++;
      play.maxCombo = Math.max(play.maxCombo, play.combo);
      const pts = POINTS[grade] * multiplier(play.combo) * (play.isEkstase(t) ? 2 : 1);
      play.score += pts;
      ev.push({ type: 'hit', grade, note: best, pts });
      if (play.combo >= EKSTASE_AT && (play.combo - EKSTASE_AT) % 20 === 0) { play.ekstaseUntil = t + EKSTASE_SECS; ev.push({ type: 'ekstase' }); }
      return ev;
    },
    tick(t) {
      const ev = [];
      if (play.ekstaseUntil && t >= play.ekstaseUntil) { play.ekstaseUntil = 0; ev.push({ type: 'ekstaseEnd' }); }
      for (const n of notes) {
        if (n.done) continue;
        if (n.t + NOTE_DANEBEN >= t) break;
        n.done = true; play.counts.daneben++;
        breakCombo(ev);
        ev.push({ type: 'miss', reason: 'late', lane: n.lane, note: n });
      }
      return ev;
    },
    allDone: () => notes.every((n) => n.done),
    lastNoteTime: () => (notes.length ? notes[notes.length - 1].t : 0),
  };
  function breakCombo(ev) {
    play.combo = 0;
    if (play.ekstaseUntil) { play.ekstaseUntil = 0; ev.push({ type: 'ekstaseEnd' }); }
  }
  return play;
}
