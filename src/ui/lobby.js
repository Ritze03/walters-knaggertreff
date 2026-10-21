// Lobby panel: players, invite link, host-only settings. Returns { el, first, update(state) }.
import { MIN_PLAYERS, MAX_PLAYERS, STAR_TARGET, MINIGAMES, isTeamGameAllowed } from '../contracts.js';
import { h, row } from './dom.js';
import { blob } from './avatar.js';
import { menuHints } from './hints.js';

/**
 * @param o.isHost    this tab hosts the game
 * @param o.selfSeat  own seat index (-1 unknown)
 * @param o.boards    BOARDS (BoardDef[]: id, name, blurb)
 * @param o.minigames [{ id, name }] every registered minigame (the Testmodus picker; kind and player counts come from MINIGAMES)
 * @param o.send      (PlayerIntent) => void
 */
const KIND_TEXT = { solo: 'Solo', arena: 'Arena', team: 'Team' };
/** player counts a minigame can be started with (team games: even and >= 4, see isTeamGameAllowed) */
export function playableCounts(id) {
  const m = MINIGAMES[id];
  const out = [];
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) if (m && n >= m.min && n <= m.max && (m.kind !== 'team' || isTeamGameAllowed(n))) out.push(n);
  return out;
}
const countsText = (id) => {
  const c = playableCounts(id);
  if (!c.length) return '–';
  return c.length > 2 && c.every((n, i) => !i || n === c[i - 1] + 1) ? `${c[0]}–${c.at(-1)} Spieler` : `${c.join(' oder ')} Spieler`;
};

export function buildLobby({ state, selfSeat, isHost, inviteLink, boards, minigames = [], send, onLeave, toast }) {
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

  // ---- Testmodus: pick any minigame, fill the table with host-run bots, play it, come back here
  let picked = null;
  let cur = state;   // the latest state, for the Testmodus handlers
  const seatCount = () => cur.seats.filter((x) => x.connected).length;
  const botCount = () => cur.seats.filter((x) => x.hostBot).length;
  const gameTiles = minigames.map((m) => h('button', {
    class: 'tile', testid: `tm-game-${m.id}`, title: m.name, onclick: () => { picked = m.id; refreshTest(); },
  }, h('b', null, m.name), h('small', null, `${KIND_TEXT[MINIGAMES[m.id]?.kind] ?? ''} · ${countsText(m.id)}`)));
  const tmAdd = h('button', { testid: 'tm-add-bot', onclick: () => send({ type: 'addBot' }) }, '+ Bot');
  const tmRemove = h('button', { testid: 'tm-remove-bot', onclick: () => { const last = cur.seats.findLast((x) => x.hostBot); if (last) send({ type: 'removeBot', seat: last.index }); } }, '− Bot');
  const tmFill = h('button', {
    testid: 'tm-fill-bots', onclick: () => { const to = fillTarget(); if (to) send({ type: 'addBot', count: to - seatCount() }); },
  }, 'Bots auffüllen');
  const tmBots = h('span', { class: 'tm-count', testid: 'tm-bot-count' });
  const tmStart = h('button', { class: 'big', testid: 'tm-start', onclick: () => send({ type: 'testMinigame', id: picked }) }, 'Starten');
  const tmOff = h('button', { testid: 'tm-off', onclick: () => send({ type: 'setTestMode', on: false }) }, 'Normales Spiel');
  const tmOn = h('button', { testid: 'tm-on', onclick: () => send({ type: 'setTestMode', on: true }) }, 'Testmodus');
  const tmRows = [];
  for (let i = 0; i < gameTiles.length; i += 3) tmRows.push(row({ class: 'tm-games' }, gameTiles.slice(i, i + 3)));
  const testBlock = h('div', { class: 'testmode', testid: 'testmode' },
    row({ class: 'tm-bots' }, tmBots, tmRemove, tmAdd, tmFill),
    h('div', { class: 'tm-list' }, tmRows));
  const testNote = h('p', { class: 'message', testid: 'tm-note' }, 'Testmodus: Der Host sucht ein Minispiel aus.');
  /** the smallest playable table size for the picked game that is not smaller than today's, or 0 */
  const fillTarget = () => playableCounts(picked).find((n) => n >= Math.max(MIN_PLAYERS, seatCount())) ?? 0;
  function refreshTest() {
    if (!picked || !gameTiles.some((t) => t.dataset.testid === `tm-game-${picked}`)) picked = minigames.some((m) => m.id === cur.settings.testLast) ? cur.settings.testLast : (minigames[0]?.id ?? null);
    const n = seatCount();
    gameTiles.forEach((t, i) => {
      const id = minigames[i].id;
      t.setAttribute('aria-pressed', String(id === picked));
      t.classList.toggle('off', !playableCounts(id).includes(n));
    });
    tmBots.textContent = `Testmodus: ${n} am Tisch, ${botCount()} Bots. Nichts zählt.`;
    tmAdd.disabled = n >= MAX_PLAYERS;
    tmRemove.disabled = !botCount();
    const to = fillTarget();
    tmFill.disabled = !to || to === n;
    const ok = !!picked && playableCounts(picked).includes(n);
    tmStart.disabled = !ok;
    if (!picked) return;
    const name = minigames.find((m) => m.id === picked)?.name ?? picked;
    hint.textContent = ok ? `${name}: ${n} Spieler, kann losgehen.`
      : !to && n > MAX_PLAYERS - 1 && n > Math.max(...playableCounts(picked)) ? `${name} braucht ${countsText(picked)}. Nimm Bots raus.`
        : `${name} braucht ${countsText(picked)}. Du hast ${n}. „Bots auffüllen“ hilft.`;
  }

  const slot = h('div', { class: 'lobby-col lobby-mode' });
  const actions = row({ class: 'actions' });
  // two columns on a landscape window (who + invite | settings + start), so even six players fit a 960x540 window without scrolling
  const el = h('div', { class: 'card lobby', testid: 'lobby' },
    h('h2', null, 'Lobby'),
    h('div', { class: 'lobby-cols' }, h('div', { class: 'lobby-col' },
      h('div', { class: 'field' }, 'Einladungslink', row({ class: 'linkrow' }, linkInput, copyBtn)),
      list,
    ), h('div', { class: 'lobby-col' }, slot,
      actions,
      hint,
    )),
    menuHints(),
  );
  const normalBlock = h('div', { class: 'lobby-col' },
      h('div', { class: 'field' }, 'Sterne zum Sieg',
        isHost ? row({ class: 'stepper' }, h('button', { testid: 'star-dec', 'aria-label': 'Weniger', onclick: step(-1) }, '−'), stars,
          h('button', { testid: 'star-inc', 'aria-label': 'Mehr', onclick: step(1) }, '+')) : stars,
        h('small', { testid: 'star-hint', style: 'font-size:.8rem;opacity:.75' }, `${STAR_TARGET.default} Sterne ≈ 45 Min. mit 4 Spielern, jeder Stern mehr oder weniger ≈ 9 Min.`)),
      h('div', { class: 'field' }, 'Brett', row({ class: 'tiles', testid: 'board-select' }, boardBtns)));
  const leaveBtn = h('button', { testid: 'leave', onclick: onLeave }, 'Verlassen');
  let shownMode = null;   // which block the right column shows: 'normal' | 'test'; rebuilt only on a flip so focus survives state updates
  function showMode(testMode) {
    const mode = testMode ? 'test' : 'normal';
    if (mode === shownMode) return;
    const had = shownMode !== null && el.contains(document.activeElement);
    shownMode = mode;
    if (testMode) {
      slot.replaceChildren(isHost ? testBlock : testNote);
      actions.replaceChildren(...(isHost ? [tmStart, tmOff, leaveBtn] : [leaveBtn]));
    } else {
      slot.replaceChildren(normalBlock);
      actions.replaceChildren(...(isHost ? [start, tmOn, leaveBtn] : [readyBtn, leaveBtn]));
    }
    if (had) (isHost ? (testMode ? tmStart : start) : readyBtn ?? leaveBtn).focus();
  }

  function update(s) {
    cur = s;
    showMode(!!s.settings.testMode);
    list.replaceChildren(...s.seats.map((seat) => h('li', {
      testid: `player-${seat.index}`, class: [seat.connected ? '' : 'away', seat.index === selfSeat ? 'self' : ''].join(' ').trim(),
    }, blob(seat.profile, 36), h('span', { class: 'name' }, seat.profile.name),
    seat.isHost && h('em', null, 'Host'), (seat.isBot || seat.hostBot) && h('em', null, 'Bot'), seat.index === selfSeat && h('em', null, 'Du'),
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
    if (s.settings.testMode) {
      if (isHost) refreshTest(); else hint.textContent = 'Der Host probiert Minispiele aus. Gleich geht es los.';
      return;
    }
    const names = waiting.map((x) => x.profile.name).join(', ');
    hint.textContent = !isHost
      ? (iAmReady ? (waiting.length ? `Du bist bereit. Warte auf: ${names}` : 'Alle bereit. Warte, bis der Host startet…') : 'Drück „Bereit!“, wenn du so weit bist.')
      : connected < MIN_PLAYERS ? `Mindestens ${MIN_PLAYERS} Spieler nötig. Schick den Link rum.`
        : waiting.length ? `Warte auf: ${names}` : 'Alle bereit? Dann los.';
  }
  update(state);
  return { el, first: isHost ? copyBtn : readyBtn, update };
}
