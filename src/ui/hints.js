// DOM renderer for button hints (token syntax: see glyphs.js). Styles: .hint / .pad / .kcap in ui.css.
import { h } from './dom.js';
import { parseHint, hintText } from './glyphs.js';

/** '{key:Enter} / {A} Bestätigen' -> <span class="hint"> with key-cap + green A circle */
export function hintEl(str) {
  return h('span', { class: 'hint', role: 'img', 'aria-label': hintText(str) },
    parseHint(str).map((p) => {
      if (p.type === 'text') return h('span', { 'aria-hidden': 'true' }, p.text);
      if (p.type === 'gap') return h('span', { class: 'hint-gap', 'aria-hidden': 'true' });
      if (p.type === 'key') return h('kbd', { class: 'kcap', 'aria-hidden': 'true' }, p.label);
      return h('span', { class: `pad pad-${p.id.toLowerCase()}`, 'aria-hidden': 'true' }, p.id === 'DPAD' ? '' : p.id === 'LS' ? 'L' : p.id);
    }));
}

/** a row of hints at the bottom of a panel */
export const hintBar = (...hints) => h('p', { class: 'hints', testid: 'hints' }, hints.map((s) => hintEl(s)));

/** the menu controls every DOM panel shares (see nav.js) */
export const menuHints = () => hintBar('{key:↑↓←→} / {LS} / {DPAD} wählen', '{key:Enter} / {A} bestätigen');
