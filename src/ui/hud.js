// HUD strip shown over the board: per seat avatar, name, coins, stars, items, presence; round, star target, Endspurt banner.
import { ITEM_INFO } from '../contracts.js';
import { h } from './dom.js';
import { blob } from './avatar.js';

/** "Runde 3 · noch 2 am Zug": the round minigame starts once everybody (incl. the current player) has rolled */
function roundText(state, compact) {
  if (!state.turn) return `Runde ${state.round}`;
  const left = state.turnOrder.slice(state.turnIndex).filter((i) => state.seats[i]?.connected).length;
  return `Runde ${state.round} · ${left <= 1 ? (compact ? 'letzter Zug' : 'letzter Zug, dann Minispiel') : `noch ${left} am Zug`}`;
}

/** Fully re-rendered from state on every update (pointer-events: none, no focus to lose). */
export function renderHud(el, state, selfSeat) {
  if (!state) { el.replaceChildren(); return; }
  const turnSeat = state.turn?.seat;
  const compact = state.seats.length >= 5;   // 5-6 chips + the round pill must share ONE row at 960px: smaller chips, shorter pill text (see .compact in ui.css)
  el.replaceChildren(
    h('div', { class: compact ? 'hud-seats compact' : 'hud-seats' }, state.seats.map((seat) => {
      const p = state.players[seat.index];
      return h('div', {
        testid: `hud-${seat.index}`,
        class: ['chip', seat.index === turnSeat ? 'turn' : '', seat.connected ? '' : 'away', seat.index === selfSeat ? 'self' : ''].join(' ').trim(),
      },
      blob(seat.profile, compact ? 22 : 30),
      h('div', { class: 'chip-body' },
        h('span', { class: 'name' }, seat.profile.name, seat.connected ? '' : ' (weg)'),
        h('span', { class: 'stats' },
          h('span', null, '🍾 ', h('b', { testid: `hud-coins-${seat.index}` }, String(p.coins))),
          h('span', null, '⭐ ', h('b', { testid: `hud-stars-${seat.index}` }, String(p.stars))),
          h('span', { class: 'items', testid: `hud-items-${seat.index}` }, p.items.map((it) => h('i', { title: ITEM_INFO[it].name }, ITEM_INFO[it].emoji))))));
    })),
    h('div', { class: 'hud-info', testid: 'hud-info' },
      h('span', { testid: 'hud-round' }, roundText(state, compact)), h('span', { testid: 'hud-target' }, `Ziel ⭐ ${state.settings.starTarget}`)),
    ...(state.endspurt ? [h('div', { class: 'endspurt', testid: 'endspurt' }, 'ENDSPURT! Flaschenfelder zählen doppelt')] : []),
  );
}
