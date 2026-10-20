// Small CSS blob for DOM previews (the Kaplay avatar lives in src/avatar). Drawn in CSS + emoji, no assets (D17).
import { h } from './dom.js';

const HAT_EMOJI = { cap: '🧢', cowboy: '🤠', crown: '👑', tophat: '🎩', party: '🥳', beanie: '🧶', propeller: '🚁' };
export const HAT_LABEL = {
  none: 'Ohne', cap: 'Cappy', cowboy: 'Cowboy', crown: 'Krone', tophat: 'Zylinder', party: 'Party', beanie: 'Mütze', propeller: 'Propeller',
};
export const hatEmoji = (hat) => HAT_EMOJI[hat] ?? '';

export function blob(profile, size = 40) {
  const eye = () => h('i', { class: 'eye' }, h('i'));
  return h('span', { class: 'blob', style: `--s:${size}px;--c:${profile.color}` },
    h('span', { class: 'hat' }, hatEmoji(profile.hat)), eye(), eye(), h('b', { class: 'mouth' }));
}
