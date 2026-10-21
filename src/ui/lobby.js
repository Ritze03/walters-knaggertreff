// Lobby panel: players, invite link, host-only settings. Returns { el, first, update(state) }.
import { MIN_PLAYERS, STAR_TARGET } from '../contracts.js';
import { h, row } from './dom.js';
import { blob } from './avatar.js';
import { menuHints } from './hints.js';

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
  // non-host: toggles the own seat's ready flag (label follows the state); the host readies by pressing Start
  let iAmReady = false;
  const readyBtn = !isHost && h('button', {
    class: 'big', testid: 'ready', onclick: () => send({ type: 'setReady', ready: !iAmReady }),
  }, 'Bereit!');
  const hint = h('p', { class: 'message', testid: 'lobby-hint' });

  // two columns on a landscape window (who + invite | settings + start), so even six players fit a 960x540 window without scrolling
  const el = h('div', { class: 'card lobby', testid: 'lobby' },
    h('h2', null, 'Lobby'),
    h('div', { class: 'lobby-cols' }, h('div', { class: 'lobby-col' },
      h('div', { class: 'field' }, 'Einladungslink', row({ class: 'linkrow' }, linkInput, copyBtn)),
      list,
    ), h('div', { class: 'lobby-col' },
      h('div', { class: 'field' }, 'Sterne zum Sieg',
        isHost ? row({ class: 'stepper' }, h('button', { testid: 'star-dec', 'aria-label': 'Weniger', onclick: step(-1) }, '−'), stars,
          h('button', { testid: 'star-inc', 'aria-label': 'Mehr', onclick: step(1) }, '+')) : stars,
        h('small', { testid: 'star-hint', style: 'font-size:.8rem;opacity:.75' }, `${STAR_TARGET.default} Sterne ≈ 45 Min. mit 4 Spielern, jeder Stern mehr oder weniger ≈ 9 Min.`)),
      h('div', { class: 'field' }, 'Brett', row({ class: 'tiles', testid: 'board-select' }, boardBtns)),
      row({ class: 'actions' }, isHost ? start : readyBtn, h('button', { testid: 'leave', onclick: onLeave }, 'Verlassen')),
      hint,
    )),
    menuHints(),
  );

  function update(s) {
    list.replaceChildren(...s.seats.map((seat) => h('li', {
      testid: `player-${seat.index}`, class: [seat.connected ? '' : 'away', seat.index === selfSeat ? 'self' : ''].join(' ').trim(),
    }, blob(seat.profile, 36), h('span', { class: 'name' }, seat.profile.name),
    seat.isHost && h('em', null, 'Host'), seat.isBot && h('em', null, 'Bot'), seat.index === selfSeat && h('em', null, 'Du'),
    !seat.connected && h('em', null, 'weg'),
    // the host counts as ready (starting is their "ready")
    h('span', {
      class: 'ready-mark', testid: `ready-${seat.index}`, 'data-ready': String(seat.isHost || !!seat.ready),
      title: seat.isHost ? 'Der Host startet' : seat.ready ? 'Bereit' : 'Noch nicht bereit',
    }, seat.isHost || seat.ready ? '✅' : '⏳'))));
    if (document.activeElement !== stars) stars.value = s.settings.starTarget;
    boardBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(boards[i].id === s.settings.boardId)));
    const connected = s.seats.filter((x) => x.connected).length;
    const waiting = s.seats.filter((x) => x.connected && !x.isHost && !x.ready);
    iAmReady = !!s.seats[selfSeat]?.ready;
    if (readyBtn) {
      readyBtn.textContent = iAmReady ? 'Doch nicht' : 'Bereit!';
      readyBtn.setAttribute('aria-pressed', String(iAmReady));
    }
    start.disabled = connected < MIN_PLAYERS || waiting.length > 0;
    const names = waiting.map((x) => x.profile.name).join(', ');
    hint.textContent = !isHost
      ? (iAmReady ? (waiting.length ? `Du bist bereit. Warte auf: ${names}` : 'Alle bereit. Warte, bis der Host startet…') : 'Drück „Bereit!“, wenn du so weit bist.')
      : connected < MIN_PLAYERS ? `Mindestens ${MIN_PLAYERS} Spieler nötig. Schick den Link rum.`
        : waiting.length ? `Warte auf: ${names}` : 'Alle bereit? Dann los.';
  }
  update(state);
  return { el, first: isHost ? copyBtn : readyBtn, update };
}
