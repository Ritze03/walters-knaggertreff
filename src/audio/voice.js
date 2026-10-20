// Web Speech API wrapper. Every function is a safe no-op without speechSynthesis (node, old browsers).
let voice = null, listening = false;

const synth = () => (typeof globalThis.speechSynthesis !== 'undefined' && typeof globalThis.SpeechSynthesisUtterance !== 'undefined' ? globalThis.speechSynthesis : null);
const lang = (v) => String(v.lang).replace('_', '-').toLowerCase();

function pickVoice() {
  const vs = synth()?.getVoices() ?? [];
  voice = vs.find((v) => lang(v) === 'de-de') ?? vs.find((v) => lang(v).startsWith('de')) ?? null; // none => browser default voice, lang still de-DE
}

/** Voices load async in most browsers: pick now and again on voiceschanged. */
export function initVoice() {
  const s = synth();
  if (!s || listening) return;
  listening = true;
  try {
    pickVoice();
    s.addEventListener?.('voiceschanged', pickVoice);
  } catch { /* speech not usable: captions only */ }
}

const rand = (a, b) => a + Math.random() * (b - a);

/** Speak `text` with a comedic random pitch/rate wobble. Never queues: a still-running line is cut off (interrupt, default) or the new one is dropped. */
export function speak(text, { rate, pitch, volume, interrupt = true } = {}) {
  const s = synth();
  if (!s) return;
  try {
    initVoice();
    if (s.speaking || s.pending) {
      if (!interrupt) return;
      s.cancel();
    }
    const u = new globalThis.SpeechSynthesisUtterance(text);
    u.lang = 'de-DE';
    if (voice) u.voice = voice;
    u.rate = rate ?? rand(0.95, 1.2);
    u.pitch = pitch ?? rand(0.7, 1.5);
    if (volume !== undefined) u.volume = Math.max(0, Math.min(1, volume));
    s.speak(u);
  } catch { /* captions only */ }
}

export function stopSpeaking() {
  try { synth()?.cancel(); } catch { /* ignore */ }
}
