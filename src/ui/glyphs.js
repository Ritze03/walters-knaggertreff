// Button-hint convention shared by the DOM UI (src/ui/hints.js) and Kaplay (src/minigames/hint.js). Pure: no DOM, no Kaplay.
//
// A hint is a plain German string with tokens:
//   {A} {B} {X} {Y}   Xbox-style face buttons (coloured letter circles)
//   {LS}              left stick (grey circle "L")
//   {DPAD}            D-pad (grey circle with a cross)
//   {key:Enter}       a keyboard key-cap with that label (any text without "}", e.g. {key:Esc} {key:WASD} {key:←→})
// Everything else is text. Two or more spaces in a row = a wider gap between groups.
// Example: '{key:Enter} / {A} Bestätigen   {key:Esc} / {B} Zurück'

/** fill / letter colours of the gamepad glyphs (Xbox layout colours, no logos) */
export const PAD_GLYPHS = {
  A: { fill: '#5DC21E', ink: '#0f2a05', label: 'A' },
  B: { fill: '#E0403A', ink: '#ffffff', label: 'B' },
  X: { fill: '#3B82F6', ink: '#ffffff', label: 'X' },
  Y: { fill: '#F5C400', ink: '#2a2000', label: 'Y' },
  LS: { fill: '#5b5f6b', ink: '#ffffff', label: 'L' },
  DPAD: { fill: '#5b5f6b', ink: '#ffffff', label: '' },
};
export const GLYPH_RING = '#11131a';   // subtle outline around every pad glyph
export const KEYCAP = { fill: '#f2ede2', ink: '#1e1e28', edge: '#8f8778' };

const TOKEN = /\{(A|B|X|Y|LS|DPAD|key:[^}]+)\}/g;

/**
 * @returns {Array<{type:'text', text:string} | {type:'pad', id:'A'|'B'|'X'|'Y'|'LS'|'DPAD'} | {type:'key', label:string} | {type:'gap'}>}
 * Text parts are split at runs of 2+ spaces into separate parts with a {type:'gap'} between them.
 */
export function parseHint(str) {
  const out = [];
  const pushText = (s) => s.split(/( {2,})/).forEach((part) => {
    if (!part) return;
    if (/^ {2,}$/.test(part)) out.push({ type: 'gap' });
    else out.push({ type: 'text', text: part });
  });
  let last = 0;
  for (const m of String(str).matchAll(TOKEN)) {
    pushText(str.slice(last, m.index));
    const t = m[1];
    out.push(t.startsWith('key:') ? { type: 'key', label: t.slice(4) } : { type: 'pad', id: t });
    last = m.index + m[0].length;
  }
  pushText(String(str).slice(last));
  return out;
}

/** plain-text form for aria-labels / logs: '{key:Enter} / {A} OK' -> 'Enter / A OK' */
export const hintText = (str) => parseHint(str).map((p) => (p.type === 'text' ? p.text : p.type === 'gap' ? '   '
  : p.type === 'key' ? p.label : p.id === 'DPAD' ? 'Steuerkreuz' : p.id === 'LS' ? 'Stick' : p.id)).join('').replace(/\s+/g, ' ').trim();

/** ready-made hints (keyboard key-cap / pad glyph pairs) so every screen says the same thing */
export const HINT = {
  confirm: '{key:Enter} / {A}',
  back: '{key:Esc} / {B}',
  move: '{key:←→} / {DPAD}',
  action: '{key:E} / {X}',
};
