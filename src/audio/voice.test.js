import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { LINES } from './lines.js';
import { speak, stopSpeaking, initVoice } from './voice.js';

const pub = new URL('../../public/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('voice/manifest.json', pub), 'utf8'));

test('every catalog variant has a voice clip in the manifest', () => {
  for (const [id, v] of Object.entries(LINES)) {
    for (const text of [].concat(v)) assert.ok(manifest[text], `no clip for ${id}: "${text}"`);
  }
});

test('every manifest file exists on disk and is a non-empty Ogg', () => {
  for (const [text, file] of Object.entries(manifest)) {
    const u = new URL(file, pub);
    assert.ok(existsSync(u), `missing ${file} for "${text}"`);
    assert.ok(statSync(u).size > 500, `${file} too small`);
    assert.equal(readFileSync(u).subarray(0, 4).toString('latin1'), 'OggS', `${file} is not Ogg`);
  }
});

test('voice.js is a safe no-op in node', () => {
  initVoice();
  speak('Sybau!', { volume: 1 });
  speak('irgendein Rohtext', { interrupt: false });
  stopSpeaking();
});
