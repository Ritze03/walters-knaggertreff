import test from 'node:test';
import assert from 'node:assert/strict';
import { LINE_IDS, FIXED_LINES, SFX, MUSIC } from '../contracts.js';
import { LINES, pickLine } from './lines.js';
import { SFX_PARAMS, ZZFX_PARAMS } from './sfx.js';
import { TRACKS, compileTrack } from './music.js';

const allText = () => Object.values(LINES).flat();

test('every required line id has non-empty German text', () => {
  for (const id of LINE_IDS) {
    const v = [LINES[id]].flat();
    assert.ok(v.length >= 1, id);
    for (const s of v) assert.ok(typeof s === 'string' && s.trim().length > 0, id);
  }
});

test('fixed lines are verbatim', () => {
  for (const [id, text] of Object.entries(FIXED_LINES)) assert.equal(LINES[id], text, id);
});

test('pickLine: id -> variant, other -> raw text', () => {
  assert.equal(pickLine('forza'), FIXED_LINES.forza);
  assert.equal(pickLine('Hallo Welt'), 'Hallo Welt');
  for (let i = 0; i < 20; i++) assert.ok(LINES.endspurt.includes(pickLine('endspurt')));
});

test('content rules: banned names absent', () => {
  const blob = allText().join('\n').toLowerCase();
  assert.ok(!blob.includes('apo' + 'red'));
  assert.ok(!blob.includes('hai' + 'der'));
});

test('every SFX id has valid zzfx parts', () => {
  for (const id of SFX) {
    const parts = SFX_PARAMS[id];
    assert.ok(Array.isArray(parts) && parts.length >= 1, id);
    for (const { at, p } of parts) {
      assert.ok(at >= 0, id);
      assert.equal(p.length, ZZFX_PARAMS.length, id);
      assert.ok(p.every((n) => typeof n === 'number' && Number.isFinite(n)), id);
    }
  }
  assert.deepEqual(Object.keys(SFX_PARAMS).sort(), [...SFX].sort());   // no stray entries
});

test('zzfx 1.4.0 builds finite, non-silent, non-clipping samples for every SFX', async () => {
  globalThis.AudioContext = class {};   // zzfx creates a context at import; stub it for node
  const { ZZFX } = await import('zzfx');
  delete globalThis.AudioContext;
  for (const id of SFX) {
    for (const { p } of SFX_PARAMS[id]) {
      const s = ZZFX.buildSamples(...p);
      assert.ok(s.length > 0 && s.length < 44100 * 2, `${id} length ${s.length}`);
      let peak = 0;
      for (const x of s) { assert.ok(Number.isFinite(x), id); peak = Math.max(peak, Math.abs(x)); }
      assert.ok(peak > 0.05 && peak <= 1.0001, `${id} peak ${peak}`);
    }
  }
});

test('every MUSIC id has a consistent track', () => {
  for (const id of Object.keys(MUSIC)) {
    assert.ok(TRACKS[id], id);
    const t = compileTrack(TRACKS[id]);
    assert.equal(t.steps % 16, 0, id);
    assert.ok(t.steps >= 64 && t.steps <= 128, `${id} ${t.steps}`);
  }
});

test('importing index.js in node does not throw; say() falls back to captions', async () => {
  const audio = await import('./index.js');
  audio.initAudio();
  audio.sfx('menuMove');
  audio.music('lobby');
  audio.music(null);
  const got = [];
  const off = audio.onCaption((t) => got.push(t));
  audio.say('forza');
  audio.say('Ganz freier Text');
  off();
  audio.say('forza');
  assert.deepEqual(got, [FIXED_LINES.forza, 'Ganz freier Text']);
  assert.equal(audio.isMuted(), false);
  assert.equal(audio.toggleMuted(), true);
  assert.equal(audio.toggleMuted(), false);
});
