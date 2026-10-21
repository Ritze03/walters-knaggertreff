// Offline German voice-line generator. Renders every variant in src/audio/lines.js and every src/minigames/*/lines.js (ids mg-<game>-<key>-<n>) with Piper (de_DE-thorsten-high),
// applies a seeded comedic pitch/speed wobble, loudness-normalises and encodes mono Opus in Ogg into public/voice/.
// Usage: node tools/voice/generate.mjs --python <venv>/bin/python --model <de_DE-thorsten-high.onnx> [--force] [--only id,id]
// (or env VOICE_PYTHON / VOICE_MODEL / VOICE_ONLY). Needs ffmpeg (libopus, rubberband, loudnorm) on PATH. See tools/voice/README.md.
//
// Stability: the wobble (length_scale, pitch) is seeded from the line text, so it never changes. Piper itself samples noise, so a
// re-render sounds slightly different; therefore existing clips whose text is unchanged are kept unless --force / --only is given.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectLines } from './collect.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'public', 'voice');

const args = process.argv.slice(2);
const opt = (name, env) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : process.env[env]; };
const python = opt('python', 'VOICE_PYTHON');
const model = opt('model', 'VOICE_MODEL');
const force = args.includes('--force');
const only = opt('only', 'VOICE_ONLY')?.split(',');
if (!python || !model) { console.error('need --python <venv python> and --model <.onnx> (see tools/voice/README.md)'); process.exit(2); }

const BITRATE = '40k';
const TARGET_LUFS = -20;

// Comedic wobble (replaces the old speechSynthesis rate 0.95-1.2 / pitch 0.7-1.5): seeded per text.
const WOBBLE = { length: [0.85, 1.1], pitch: [0.82, 1.3] };
function rng(text) {   // fnv1a hash -> mulberry32
  let h = 2166136261;
  for (const c of text) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return () => { h = (h + 0x6D2B79F5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function run(cmd, a, input) {
  const r = spawnSync(cmd, a, { input, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`${cmd} ${a.join(' ')}\n${r.stderr}`);
  return r.stderr;
}

const trim = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.12,areverse';

function render(text, file, tmp) {
  const rand = rng(text);
  const lerp = ([a, b]) => a + rand() * (b - a);
  const length = lerp(WOBBLE.length), pitch = lerp(WOBBLE.pitch);
  const wav = join(tmp, 'raw.wav');
  run(python, ['-I', '-m', 'piper', '-m', model, '--length-scale', length.toFixed(3), '-f', wav], text.replaceAll('…', '...'));
  const pre = `${trim},rubberband=pitch=${pitch.toFixed(3)}:formant=preserved,aresample=48000`;
  const ln = `loudnorm=I=${TARGET_LUFS}:TP=-2:LRA=7`;
  // two-pass loudnorm (single pass is unreliable on 1-3 s clips): measure, then apply linearly
  const log = run('ffmpeg', ['-hide_banner', '-nostats', '-y', '-i', wav, '-af', `${pre},${ln}:print_format=json`, '-f', 'null', '-']);
  const m = JSON.parse(log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1));
  const norm = `${ln}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  run('ffmpeg', ['-hide_banner', '-nostats', '-y', '-i', wav, '-af', `${pre},${norm},aresample=48000`, '-ac', '1', '-c:a', 'libopus', '-b:a', BITRATE, '-vbr', 'on', '-application', 'voip', '-map_metadata', '-1', file]);
  return { length, pitch };
}

mkdirSync(outDir, { recursive: true });
const manifestPath = join(outDir, 'manifest.json');
let old = {};
try { old = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { /* first run */ }

const tmp = mkdtempSync(join(tmpdir(), 'wk-voice-'));
const manifest = {};
let rendered = 0;
try {
  for (const { id, n, text } of await collectLines()) {
    if (manifest[text]) continue;   // same text under two ids (core or minigame): one clip, first occurrence wins (core before minigames)
    const rel = `voice/${id}-${n}.ogg`;
    const file = join(root, 'public', rel);
    const skip = !force && old[text] === rel && existsSync(file) && !(only && only.includes(id));
    if (!skip) {
      const w = render(text, file, tmp);
      rendered++;
      console.log(`${rel}  length_scale ${w.length.toFixed(2)} pitch ${w.pitch.toFixed(2)}  "${text}"`);
    }
    manifest[text] = rel;
  }
} finally { rmSync(tmp, { recursive: true, force: true }); }

const keep = new Set(Object.values(manifest).map((f) => f.slice('voice/'.length)));
for (const f of readdirSync(outDir)) if (f.endsWith('.ogg') && !keep.has(f)) { rmSync(join(outDir, f)); console.log(`removed stale ${f}`); }
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n');
console.log(`done: ${rendered} rendered, ${Object.keys(manifest).length} in manifest`);
