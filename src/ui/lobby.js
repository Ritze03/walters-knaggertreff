// Lobby panel: players, invite link, host-only settings. Returns { el, first, update(state) }.
import { MIN_PLAYERS, STAR_TARGET } from '../contracts.js';
import { h, row } from './dom.js';
import { blob } from './avatar.js';

/**
 * @param o.isHost    this tab hosts the game
 * @param o.selfSeat  own seat index (-1 unknown)
 * @param o.boards    BOARDS (BoardDef[]: id, name, blurb)
 * @param o.send      (PlayerIntent) => void
 */
export function buildLobby({ state, selfSeat, isHost, inviteLink, boards, send, onLeave, toast }) {
  const list = h('ul', { class: 'players', testid: 'player-list' });
  const settings = (patch) => send({ type: 'setSettings', ...patch });
  const clampStars = (n) => Math.max(STAR_TARGET.min, Math.min(STAR_TARGET.max, n));

  const stars = isHost
    ? h('input', {
      testid: 'star-target', type: 'number', min: STAR_TARGET.min, max: STAR_TARGET.max, step: 1, 'aria-label': 'Sterne zum Sieg',
      onchange: () => {
        const n = parseInt(stars.value, 10);
        if (Number.isInteger(n) && n >= 1) settings({ starTarget: clampStars(n) }); else stars.value = state.settings.starTarget;
      },
    })
    : h('output', { testid: 'star-target' });
  const step = (d) => () => settings({ starTarget: clampStars((parseInt(stars.value, 10) || STAR_TARGET.default) + d) });

  const boardBtns = boards.map((b) => h('button', {
    class: 'tile', testid: `board-${b.id}`, disabled: !isHost, title: b.blurb, onclick: () => settings({ boardId: b.id }),
  }, h('b', null, b.name), h('small', null, b.blurb)));

  const copy = async () => {
    try { await navigator.clipboard.writeText(inviteLink); toast('Link kopiert. Ab damit in den Discord!'); } catch {
      linkInput.select();
      toast(document.execCommand?.('copy') ? 'Link kopiert. Ab damit in den Discord!' : 'Kopieren geht nicht, markier den Link von Hand.');
    }
  };
  const copyBtn = h('button', { testid: 'copy-invite', onclick: copy }, 'Kopieren');
  const linkInput = h('input', { testid: 'invite-link', type: 'text', readonly: true, value: inviteLink, 'aria-label': 'Einladungslink' });
  const start = h('button', { class: 'big', testid: 'start', onclick: () => send({ type: 'startGame' }) }, 'Start');
  const hint = h('p', { class: 'message', testid: 'lobby-hint' });

  const el = h('div', { class: 'card lobby', testid: 'lobby' },
    h('h2', null, 'Lobby'),
    h('div', { class: 'field' }, 'Einladungslink', row({ class: 'linkrow' }, linkInput, copyBtn)),
    list,
    h('div', { class: 'field' }, 'Sterne zum Sieg',
      isHost ? row({ class: 'stepper' }, h('button', { testid: 'star-dec', 'aria-label': 'Weniger', onclick: step(-1) }, '−'), stars,
        h('button', { testid: 'star-inc', 'aria-label': 'Mehr', onclick: step(1) }, '+')) : stars),
    h('div', { class: 'field' }, 'Brett', row({ class: 'tiles', testid: 'board-select' }, boardBtns)),
    row({ class: 'actions' }, isHost && start, h('button', { testid: 'leave', onclick: onLeave }, 'Verlassen')),
    hint,
  );

  function update(s) {
    list.replaceChildren(...s.seats.map((seat) => h('li', {
      testid: `player-${seat.index}`, class: [seat.connected ? '' : 'away', seat.index === selfSeat ? 'self' : ''].join(' ').trim(),
    }, blob(seat.profile, 36), h('span', { class: 'name' }, seat.profile.name),
    seat.isHost && h('em', null, 'Host'), seat.isBot && h('em', null, 'Bot'), seat.index === selfSeat && h('em', null, 'Du'),
    !seat.connected && h('em', null, 'weg'))));
    if (document.activeElement !== stars) stars.value = s.settings.starTarget;
    boardBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(boards[i].id === s.settings.boardId)));
    const connected = s.seats.filter((x) => x.connected).length;
    start.disabled = connected < MIN_PLAYERS;
    hint.textContent = !isHost ? 'Warte, bis der Host startet…' : connected < MIN_PLAYERS ? `Mindestens ${MIN_PLAYERS} Spieler nötig. Schick den Link rum.` : 'Alle da? Dann los.';
  }
  update(state);
  return { el, first: copyBtn, update };
}
