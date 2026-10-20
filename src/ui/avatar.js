// Small CSS blob for DOM previews (the Kaplay avatar lives in src/avatar). Drawn in CSS + emoji, no assets (D17).
// Every hat is a single emoji; per-hat placement (tilt, offset) lives in ui.css under `.hat-<id>`. 🤠 is a face wearing a hat, so the
// `.crop` wrapper shows only its hat part (no second face on top of the blob).
import { h } from './dom.js';

const HAT_EMOJI = { cap: '🧢', cowboy: '🤠', crown: '👑', tophat: '🎩', hotdog: '🌭', cucumber: '🥒', propeller: '🚁' };
const CROPPED = new Set(['cowboy']);
export const HAT_LABEL = {
  none: 'Ohne', cap: 'Cappy', cowboy: 'Cowboy', crown: 'Krone', tophat: 'Zylinder', hotdog: 'Hotdog', cucumber: 'Gurke', propeller: 'Propeller',
};
export const hatEmoji = (hat) => HAT_EMOJI[hat] ?? '';

/** the hat glyph as an element (cropped where the emoji is more than a hat) */
export const hatGlyph = (hat) => (CROPPED.has(hat) ? h('span', { class: 'crop' }, h('span', null, hatEmoji(hat))) : hatEmoji(hat));

export function blob(profile, size = 40) {
  const eye = () => h('i', { class: 'eye' }, h('i'));
  const hat = HAT_EMOJI[profile.hat] ? profile.hat : 'none';   // unknown (old) hat ids draw a bare blob
  return h('span', { class: 'blob', style: `--s:${size}px;--c:${profile.color}` },
    eye(), eye(), h('b', { class: 'mouth' }), h('span', { class: `hat hat-${hat}` }, hatGlyph(hat)));
}
