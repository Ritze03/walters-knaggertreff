// Victory panel: winner, final standings, host-only rematch. Returns { el, first }.
import { h, row } from './dom.js';
import { blob } from './avatar.js';
import { menuHints } from './hints.js';

export function buildVictory({ state, isHost, send, onTitle }) {
  const winner = state.seats[state.winner] ?? state.seats[0];
  const order = state.seats.map((s) => s.index).sort((a, b) => {
    const pa = state.players[a], pb = state.players[b];
    return pb.stars - pa.stars || pb.coins - pa.coins || a - b;
  });
  const rematch = h('button', { class: 'big', testid: 'rematch', onclick: () => send({ type: 'rematch' }) }, 'Revanche');
  const back = h('button', { testid: 'to-title', onclick: onTitle }, 'Zurück zum Titel');
  const el = h('div', { class: 'card victory', testid: 'victory' },
    h('h2', null, '🏆 Wir haben einen Sieger!'),
    h('div', { class: 'winner', testid: 'winner' }, blob(winner.profile, 120), h('b', null, winner.profile.name)),
    h('p', { class: 'tagline' }, 'Aura +1000.'),
    h('ol', { class: 'standings', testid: 'standings' }, order.map((i, rank) => {
      const s = state.seats[i], p = state.players[i];
      return h('li', { testid: `standing-${i}`, class: i === state.winner ? 'self' : '' },
        h('span', { class: 'rank' }, `${rank + 1}.`), blob(s.profile, 32), h('span', { class: 'name' }, s.profile.name),
        h('span', null, `⭐ ${p.stars}`), h('span', null, `🪙 ${p.coins}`));
    })),
    row({ class: 'actions' }, isHost && rematch, back),
    !isHost && h('p', { class: 'message' }, 'Der Host entscheidet, ob es eine Revanche gibt.'),
    menuHints(),
  );
  return { el, first: isHost ? rematch : back };
}
