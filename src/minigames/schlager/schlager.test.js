import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../contracts.js';
import { buildChart, createPlay, multiplier, formatPoints, EIGHTH, NOTE_PERFEKT, NOTE_GUT, NOTE_DANEBEN, EKSTASE_SECS, END_SLOT, DURATION_MS, melodyEvents } from './song.js';

test('chart is deterministic per seed, sorted, in 4 lanes and fits the duration', () => {
  const a = buildChart(createRng(7)), b = buildChart(createRng(7)), c = buildChart(createRng(8));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(a.length >= 65 && a.length <= 120, `notes: ${a.length}`);
  for (let i = 1; i < a.length; i++) assert.ok(a[i].t >= a[i - 1].t);
  for (const n of a) assert.ok(n.lane >= 0 && n.lane <= 3 && n.t >= 8 * EIGHTH);
  assert.ok(a.at(-1).t + 1.5 < DURATION_MS / 1000);
  assert.ok(END_SLOT * EIGHTH < DURATION_MS / 1000);
  for (const lane of [0, 1, 2, 3]) assert.ok(a.some((n) => n.lane === lane), `lane ${lane} used`);
});

test('melody has 16 bars of onsets', () => {
  const ev = melodyEvents();
  assert.ok(ev.length > 60);
  assert.ok(ev.every((e) => e.len >= 1 && e.slot >= 8 && e.slot < 8 * 17));
});

test('judging: perfekt, gut, sloppy, stray, late', () => {
  const chart = [0, 1, 2, 3, 4].map((i) => ({ id: i, t: 2 + i, lane: i % 4, slot: i }));
  const p = createPlay(chart);
  let ev = p.press(0, 2 + NOTE_PERFEKT / 2);
  assert.equal(ev[0].grade, 'perfekt');
  ev = p.press(1, 3 + (NOTE_PERFEKT + NOTE_GUT) / 2);
  assert.equal(ev[0].grade, 'gut');
  assert.equal(p.combo, 2);
  ev = p.press(2, 4 + (NOTE_GUT + NOTE_DANEBEN) / 2);
  assert.equal(ev[0].reason, 'sloppy');
  assert.equal(p.combo, 0);
  ev = p.press(0, 9);
  assert.equal(ev[0].reason, 'stray');
  ev = p.tick(6 + NOTE_DANEBEN + 0.01);
  assert.equal(ev[0].reason, 'late');
  assert.ok(p.allDone());
  assert.deepEqual(p.counts, { perfekt: 1, gut: 1, daneben: 4 });
});

test('combo multiplier and Schlager-Ekstase at combo 10', () => {
  assert.deepEqual([0, 9, 10, 29, 30, 99].map(multiplier), [1, 1, 2, 3, 4, 4]);
  const chart = Array.from({ length: 12 }, (_, i) => ({ id: i, t: 1 + i * 0.5, lane: 0, slot: i }));
  const p = createPlay(chart);
  let ekstase = 0, last;
  for (let i = 0; i < 12; i++) { const ev = p.press(0, 1 + i * 0.5); last = ev; ekstase += ev.filter((e) => e.type === 'ekstase').length; }
  assert.equal(ekstase, 1);
  assert.equal(p.combo, 12);
  assert.ok(p.isEkstase(1 + 11 * 0.5));
  assert.ok(!p.isEkstase(1 + 9 * 0.5 + EKSTASE_SECS + 0.1));
  // notes 1-9: 300 each (x1); note 10 starts the Ekstase after it was scored (300 x2), notes 11-12: 300 x2 x2
  assert.equal(last.find((e) => e.type === 'hit').pts, 1200);
  assert.equal(p.score, 9 * 300 + 600 + 2 * 1200);
});

test('a broken combo ends the Ekstase', () => {
  const chart = Array.from({ length: 11 }, (_, i) => ({ id: i, t: 1 + i * 0.5, lane: 1, slot: i }));
  const p = createPlay(chart);
  for (let i = 0; i < 10; i++) p.press(1, 1 + i * 0.5);
  assert.ok(p.isEkstase(6));
  const ev = p.press(2, 6.1);
  assert.ok(ev.some((e) => e.type === 'ekstaseEnd'));
  assert.equal(p.combo, 0);
  assert.ok(!p.isEkstase(6.2));
});

test('formatPoints uses the German thousands dot', () => {
  assert.equal(formatPoints(12340), '12.340');
  assert.equal(formatPoints(0), '0');
  assert.equal(formatPoints(999), '999');
  assert.equal(formatPoints(1234567), '1.234.567');
});
