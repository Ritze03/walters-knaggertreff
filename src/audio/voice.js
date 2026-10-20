// Voice lines: pre-rendered German clips (public/voice/*.ogg, made offline by tools/voice/generate.mjs) played through ZzFX's shared AudioContext.
// Nothing here touches window/document/fetch/AudioContext at import time, so it is safe in node. Every function is a safe no-op without the browser APIs.
// Text -> clip lookup goes through public/voice/manifest.json ({ text: "voice/<id>-<n>.ogg" }); text without a clip (raw strings) is caption-only, silently.
let ctx = null, ctxLoading = false;
let manifestP = null;           // Promise<{[text]: file}>
const clips = new Map();        // file -> Promise<ArrayBuffer> (raw bytes, fetched once)
const decoded = new Map();      // file -> Promise<AudioBuffer>
let current = null;             // playing { src }
let token = 0, pendingToken = 0; // pendingToken !== 0: a clip is still loading
let prefetched = false;

// Clips are normalised to about -20 LUFS (same level as the SFX at slider 100 %). `volume` from index.js is the final linear gain, so no extra trim.
const VOICE_TRIM = 1;

const base = () => (typeof document !== 'undefined' && document.baseURI) || null;
const url = (rel) => new URL(rel, base()).href;
const warned = new Set();
const warnOnce = (m) => { if (!warned.has(m)) { warned.add(m); console.warn(`[voice] ${m}`); } };

function loadContext() {
  if (ctx || ctxLoading || typeof AudioContext === 'undefined') return;
  ctxLoading = true;
  import('zzfx').then(({ ZZFX }) => { ctx = ZZFX.audioContext; }).catch(() => { ctxLoading = false; });   // same module instance as index.js: one shared context
}

function loadManifest() {
  if (!manifestP) {
    const b = base();
    if (!b || typeof fetch === 'undefined') return Promise.resolve({});
    manifestP = fetch(url('voice/manifest.json')).then((r) => (r.ok ? r.json() : {})).catch(() => { manifestP = null; return {}; });
  }
  return manifestP;
}

const bytes = (file) => {
  if (!clips.has(file)) {
    clips.set(file, fetch(url(file)).then((r) => { if (!r.ok) throw new Error(`${r.status} ${file}`); return r.arrayBuffer(); }).catch((e) => { clips.delete(file); throw e; }));
  }
  return clips.get(file);
};

function buffer(file) {
  if (!decoded.has(file)) {
    decoded.set(file, bytes(file).then((ab) => ctx.decodeAudioData(ab.slice(0))).catch((e) => { decoded.delete(file); throw e; }));
  }
  return decoded.get(file);
}

/** After the first line has played, quietly fetch the remaining clips' bytes (about 1 MB, 3 at a time) so later lines start instantly. */
function prefetchRest(manifest) {
  if (prefetched) return;
  prefetched = true;
  const todo = [...new Set(Object.values(manifest))].filter((f) => !clips.has(f));
  const worker = async () => { for (let f; (f = todo.pop());) { try { await bytes(f); } catch { /* fetched on demand later */ } } };
  for (let i = 0; i < 3; i++) worker();
}

/** Start loading the manifest and audio context early (called from initAudio). */
export function initVoice() {
  loadContext();
  loadManifest();
}

/** Play the clip for `text` (looked up in the manifest) at final linear gain `volume`. Never queues: a still-running line is cut off (interrupt, default) or the new one is dropped. rate/pitch are baked into the clips and ignored. */
export function speak(text, { volume = 1, interrupt = true } = {}) {
  if (!base() || typeof fetch === 'undefined' || typeof AudioContext === 'undefined') return;
  loadContext();
  if (!(volume > 0)) return;
  if (!interrupt && (current || pendingToken)) return;
  stopSpeaking();
  const mine = ++token;
  pendingToken = mine;
  loadManifest().then(async (manifest) => {
    const file = manifest[text];
    if (!file) return;
    prefetchRest(manifest);
    if (!ctx) await new Promise((r) => setTimeout(r, 50));   // zzfx import still in flight
    if (!ctx) return;
    const buf = await buffer(file);
    if (mine !== token) return;                               // superseded or stopped while loading
    if (ctx.state !== 'running') { try { ctx.resume()?.catch(() => {}); } catch { /* still locked */ } return; }   // locked: drop, no backlog
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf;
    g.gain.value = Math.min(1, volume) * VOICE_TRIM;
    src.connect(g).connect(ctx.destination);
    src.onended = () => { if (current?.src === src) current = null; };
    current = { src };
    src.start();
  }).catch((e) => warnOnce(`clip failed: ${e?.message ?? e}`)).finally(() => { if (pendingToken === mine) pendingToken = 0; });
}

export function stopSpeaking() {
  token++;
  pendingToken = 0;
  if (current) { try { current.src.stop(); } catch { /* already ended */ } current = null; }
}
