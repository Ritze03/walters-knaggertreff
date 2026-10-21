// Entry point + host driver (contracts section 11). Core stays pure, so ALL time and IO lives here: one Kaplay instance, one Input,
// the DOM ui, and per game one "run" (session + screens + timers) that is torn down when the player leaves.
import kaplay from 'kaplay';
import './ui/ui.css';
import {
  ERR, HOST_SEAT, MSG, PHASE, PROTOCOL_VERSION, SCREEN, SESSION_EVENT, TIMING, parseDebugParams, seatIndexOf,
} from './contracts.js';
import * as core from './core/index.js';
import {
  createSession, loadIdentity, saveProfile, isHostOf, markHost, loadSave, storeSave, makeGameId, parseGameIdFromHash, buildInviteLink,
} from './net/index.js';
import { createInput } from './input/index.js';
import * as audio from './audio/index.js';
import { mountBoard, BOARDS } from './board/index.js';
import { createMinigameRunner } from './minigames/runner.js';
import { listMinigames } from './minigames/index.js';
import { createUi } from './ui/index.js';

const debug = parseDebugParams(location.search);
const identity = loadIdentity(debug.pid);
const playerId = identity.playerId;

/** German texts for ERR codes (toasts, reject reasons) */
const ERR_TEXT = {
  [ERR.forbidden]: 'Das darfst du nicht. Netter Versuch.',
  [ERR.wrongPhase]: 'Gerade nicht dran.',
  [ERR.notYourTurn]: 'Du bist nicht dran, Bro.',
  [ERR.wrongStep]: 'Falscher Moment.',
  [ERR.invalid]: 'Das geht so nicht.',
  [ERR.tooFewPlayers]: 'Zu wenig Leute. Hol noch jemanden dazu.',
  [ERR.notReady]: 'Nicht alle sind bereit. Ein bisschen Geduld.',
  [ERR.cantAfford]: 'Das Konto sagt nein.',
  [ERR.itemsFull]: 'Deine Taschen sind voll.',
  [ERR.full]: 'Die Lobby ist voll.',
  [ERR.started]: 'Das Spiel läuft schon, ohne dich.',
  [ERR.protocol]: 'Falsche Version. Lade die Seite neu.',
  [ERR.playerCount]: 'Dafür passt die Spielerzahl nicht.',
};
const errText = (code) => ERR_TEXT[code] ?? 'Das ging schief.';
const FATAL_REJECTS = new Set([ERR.full, ERR.started, ERR.protocol]);
const MINIGAME_PHASES = new Set([PHASE.minigameIntro, PHASE.minigame, PHASE.minigameResults]);
const MUSIC_OF = { lobby: 'lobby', boardTurn: 'board', minigameIntro: 'minigame', minigame: 'minigame', minigameResults: 'minigame', victory: 'victory' };
const CONNECT_HINT_MS = 12000;
const RESUME_GRACE_MS = 15000;   // after a host resume, absent seats are not auto-played for this long (D31): time to rejoin first
const VICTORY_DELAY_MS = 1800;   // lets the board finish the winning animation before the DOM victory panel covers it

// ---- boot ---------------------------------------------------------------------------------------------------------------------

audio.initAudio();
for (const board of BOARDS) core.registerBoard(board);   // before createGame / deserialize / startGame

const input = createInput({ target: window });
document.head.insertAdjacentHTML('beforeend', '<link rel="icon" href="data:,">');   // no favicon file yet: avoid a 404 in every console
const stage = document.querySelector('#app');
const canvas = document.createElement('canvas');
stage.append(canvas);
// Crisp rendering: with width/height set, Kaplay draws into a FIXED framebuffer of SCREEN * pixelDensity * scale and then stretches it
// onto the canvas. Before, that was 1280x720 (x DPR) blown up with the default "nearest" filter = blocky pixels on any big screen.
// Now the framebuffer matches the device pixels of the screen (logical coords stay 1280x720), capped at 2x SCREEN (= 2560x1440)
// to protect fps, and texFilter 'linear' smooths whatever scaling remains (glyph atlas, 4K monitors).
const dpr = window.devicePixelRatio || 1;
const pixelDensity = Math.min(2, dpr);
// size for the screen, not just the current window, so maximising / fullscreen later stays sharp
const fit = Math.min(Math.max(window.screen?.width || 0, window.innerWidth) / SCREEN.w, Math.max(window.screen?.height || 0, window.innerHeight) / SCREEN.h) || 1;
const k = kaplay({
  canvas, width: SCREEN.w, height: SCREEN.h, stretch: true, letterbox: true, global: false, background: [20, 17, 15],
  focus: false, debug: false, loadingScreen: false, texFilter: 'linear',
  pixelDensity, scale: Math.max(1, Math.min(2, fit * dpr) / pixelDensity),
});
k.onUpdate(() => input.update());   // the ONE place that calls input.update()
const ui = createUi({ parent: document.body, input, audio });

let current = null;   // the running game: { state, selfSeat, session, stop }
window.__wk = {       // read-only debug hook for tests
  getState: () => current?.state ?? null,
  selfSeat: () => current?.selfSeat ?? -1,
  get session() { return current?.session ?? null; },
  debug,
  trace: [],            // [{ t, what }]: board playback markers (+event / -event) and screen switches, to verify the order in tests
};
const trace = (what) => window.__wk.trace.push({ t: Math.round(performance.now()), what });

showTitle();

// ---- title / create / join ------------------------------------------------------------------------------------------------------

function showTitle(message = '') {
  audio.music('lobby');
  const hashId = parseGameIdFromHash(location.hash);
  if (hashId && !message && isHostOf(hashId, playerId, debug.pid)) {
    // host reopened its own link: resume from the save without asking anything
    try {
      const json = loadSave(hashId, debug.pid);
      const saved = json && core.deserialize(json);
      const profile = saved?.seats.find((s) => s.playerId === playerId)?.profile;
      if (profile) return startRun({ gameId: hashId, profile, isHost: true, initial: core.resumeGame(saved, playerId) });
    } catch (e) { console.error('[main] resume failed', e); }
  }
  ui.showTitle({
    stored: identity.profile, gameId: hashId, canCreate: !hashId || isHostOf(hashId, playerId, debug.pid), bot: debug.bot, message,
    onCreate(profile) {
      const gameId = hashId && isHostOf(hashId, playerId, debug.pid) ? hashId : makeGameId();
      saveProfile(profile, debug.pid);
      markHost(gameId, playerId, debug.pid);
      history.replaceState(null, '', `${location.pathname}${location.search}#${gameId}`);
      const full = { ...profile, playerId };
      let initial = core.createGame({
        gameId, hostPlayerId: playerId, hostProfile: full, seed: debug.seed ?? crypto.getRandomValues(new Uint32Array(1))[0],
        starTarget: debug.stars ?? undefined, forceMinigame: debug.mg, availableMinigames: listMinigames().map((m) => m.id).filter((id) => !debug.pool || debug.pool.includes(id)),
      });
      if (debug.coins !== null) {   // test knob ?coins=N: seatJoin takes new purses from rules.startCoins
        initial = { ...initial, rules: { ...initial.rules, startCoins: debug.coins }, players: initial.players.map((p) => ({ ...p, coins: debug.coins })) };
      }
      startRun({ gameId, profile, isHost: true, initial });
    },
    onJoin(profile, gameId) {
      saveProfile(profile, debug.pid);
      if (gameId !== hashId) history.replaceState(null, '', `${location.pathname}${location.search}#${gameId}`);
      startRun({ gameId, profile, isHost: false });
    },
  });
}

// ---- one running game ---------------------------------------------------------------------------------------------------------------

function startRun({ gameId, profile, isHost, initial = null }) {
  const full = { ...profile, playerId };
  const session = createSession({ gameId, transport: debug.local ? 'local' : 'trystero', profile: full, playerId, isHost, isBot: debug.bot, lagMs: debug.lag ?? 0 });
  const offs = [];
  const timers = new Set();
  let stopped = false;
  let hostState = initial;   // host only: THE state
  const graceUntil = isHost && initial ? performance.now() + RESUME_GRACE_MS : 0;   // resumed run only
  let lastRev = -1;
  let board = null, runner = null;
  let handing = false;   // the board is still playing out its last events + the minigame announcement; the runner mounts afterwards
  let botTimer = null, autoTimer = null, phaseTimer = null, phaseKey = null, victoryTimer = null;
  const run = { state: null, selfSeat: -1, session, stop };
  current = run;

  const later = (ms, fn) => {
    const t = setTimeout(() => { timers.delete(t); if (!stopped) fn(); }, ms);
    timers.add(t);
    return t;
  };
  const cancel = (t) => { if (t) { clearTimeout(t); timers.delete(t); } return null; };
  const inviteLink = buildInviteLink(gameId, { origin: location.origin, base: import.meta.env.BASE_URL, search: debug.local ? '?local' : '' });

  function stop() {
    if (stopped) return;
    stopped = true;
    timers.forEach(clearTimeout);
    offs.forEach((off) => off());
    board?.destroy(); runner?.destroy();
    board = runner = null;
    session.leave();
    ui.hidePanel(); ui.renderHud(null); ui.setHostGone(false);
    if (current === run) current = null;
  }

  const leave = (message = '') => {
    stop();
    if (!message) history.replaceState(null, '', `${location.pathname}${location.search}`);   // a refused join keeps the link for another try
    showTitle(message);
  };

  // -- host: the only place that runs core.applyIntent
  function apply(actor, intent, from = null) {
    const r = core.applyIntent(hostState, actor, intent);
    if (r.error) {
      if (from && from !== playerId) session.send(MSG.reject, { reason: r.error }, from);
      else if (from) ui.toast(errText(r.error));
      return r;
    }
    if (r.state === hostState) return r;   // no-op: nothing changed
    hostState = r.state;
    storeSave(gameId, core.serialize(hostState), debug.pid);
    session.broadcast(MSG.state, { rev: hostState.rev, state: hostState, events: r.events }, { self: true });
    return r;
  }

  if (isHost) {
    offs.push(session.on(MSG.intent, (m, from) => {
      const seat = seatIndexOf(hostState, from);
      if (seat >= 0 && m?.intent) apply(seat, m.intent, from);
    }));
    offs.push(session.on(SESSION_EVENT.peerJoin, (peer) => {
      if (peer.protocol !== PROTOCOL_VERSION) return session.send(MSG.reject, { reason: ERR.protocol }, peer.playerId);
      const r = apply(HOST_SEAT, { type: 'seatJoin', playerId: peer.playerId, profile: { ...peer.profile, playerId: peer.playerId }, isBot: peer.isBot });
      if (r.error) return session.send(MSG.reject, { reason: r.error }, peer.playerId);
      // always give the (re)joined peer the full state, even when seatJoin changed nothing; a beat later so its hello reached it first
      later(200, () => session.send(MSG.state, { rev: hostState.rev, state: hostState, events: [] }, peer.playerId));
    }));
    offs.push(session.on(SESSION_EVENT.peerLeave, ({ playerId: gone }) => {
      const seat = seatIndexOf(hostState, gone);
      if (seat >= 0) apply(HOST_SEAT, { type: 'seatPresence', seat, connected: false });
    }));
  } else {
    offs.push(session.on(SESSION_EVENT.hostGone, () => ui.setHostGone(true)));
    offs.push(session.on(SESSION_EVENT.hostBack, () => ui.setHostGone(false)));
    offs.push(session.on(MSG.reject, (m) => {
      if (FATAL_REJECTS.has(m?.reason)) leave(errText(m.reason)); else ui.toast(errText(m?.reason));
    }));
  }
  offs.push(session.on(SESSION_EVENT.error, (e) => ui.toast(`Verbindungsproblem: ${e?.message ?? '?'}`)));

  // -- every client (host included, via broadcast self:true) renders `state` messages
  offs.push(session.on(MSG.state, (m, from) => {
    if (!isHost && from !== session.hostPlayerId()) return;
    if (!m || !Number.isInteger(m.rev) || !m.state || m.rev <= lastRev) return;
    onState(m.state, m.events ?? [], m.rev);
  }));

  function onState(state, events, rev) {
    const selfSeat = seatIndexOf(state, playerId);
    if (selfSeat < 0) return;   // not (or no longer) part of this game
    lastRev = rev;
    run.state = state; run.selfSeat = selfSeat;
    syncScreens(state, events, selfSeat);
    if (handing) return;   // bots and host timers start when the runner is on screen (see handOver)
    scheduleBot(state, selfSeat);
    if (isHost) scheduleHostTimers(state);
  }

  function syncScreens(state, events, selfSeat) {
    const phase = state.phase;
    // board and runner are Kaplay screens; they live exactly as long as their phases (victory keeps the board behind the DOM panel).
    // Entering a minigame phase does NOT destroy the board at once: it first plays out its queue (last dice, hops, coins) and the
    // announcement banner (minigameStart / duelStart events), then handOver() swaps in the runner.
    const toMinigame = MINIGAME_PHASES.has(phase);
    if (board && toMinigame) {
      board.onState(state, events);
      if (!handing) { handing = true; board.whenIdle().then(handOver); }
    } else if (board && phase !== PHASE.boardTurn && phase !== PHASE.victory) { board.destroy(); board = null; }
    if (runner && !toMinigame) { runner.destroy(); runner = null; }
    if (phase === PHASE.boardTurn && !board) {
      handing = false;
      board = mountBoard({ k, session, input, audio, debug, trace });
    }
    if (toMinigame && !runner && !board) mountRunner();
    if (!toMinigame) board?.onState(state, events);
    runner?.onState(state, events);

    audio.music(handing ? 'board' : MUSIC_OF[phase]);
    ui.renderHud(phase === PHASE.boardTurn || handing ? state : null, selfSeat);

    if (phase === PHASE.lobby) {
      if (ui.panelKind() !== 'lobby') {
        const avail = state.settings.availableMinigames;
        const minigames = listMinigames().filter((m) => !avail || avail.includes(m.id)).map((m) => ({ id: m.id, name: m.name }))
          .sort((a, b) => a.name.localeCompare(b.name, 'de'));
        ui.showLobby({ state, selfSeat, isHost, inviteLink, boards: BOARDS, minigames, send: sendIntent, onLeave: () => leave() });
      } else ui.updateLobby(state);
    } else if (phase === PHASE.victory) {
      if (ui.panelKind() !== 'victory' && !victoryTimer) {
        victoryTimer = later(board ? VICTORY_DELAY_MS : 0, () => {
          victoryTimer = null;
          if (run.state.phase === PHASE.victory) ui.showVictory({ state: run.state, isHost, send: sendIntent, onTitle: () => leave() });
        });
      }
    } else {
      victoryTimer = cancel(victoryTimer);
      ui.hidePanel();
    }
  }

  function mountRunner() {
    trace('runner mounted');
    runner = createMinigameRunner({
      k, session, input, audio, debug,
      onHostResults: (results) => { if (isHost) apply(HOST_SEAT, { type: 'minigameDone', results }); },
    });
  }

  /** the board has nothing left to show: swap it for the runner and start the clocks that depend on the minigame being on screen */
  function handOver() {
    if (stopped || !handing) return;
    handing = false;
    const st = run.state;
    if (!board || !st || !MINIGAME_PHASES.has(st.phase)) return;   // the phase moved on while the banner was up: normal flow handles it
    trace(`board destroyed (pending ${board.pending()})`);
    board.destroy(); board = null;
    syncScreens(st, [], run.selfSeat);
    scheduleBot(st, run.selfSeat);
    if (isHost) scheduleHostTimers(st);
  }

  const sendIntent = (intent) => session.sendIntent(intent);

  // -- ?bot: this tab plays its own seat, once per state revision
  function scheduleBot(state, selfSeat) {
    if (!debug.bot) return;
    botTimer = cancel(botTimer);
    botTimer = later(TIMING.BOT_DELAY_MS, () => {
      if (run.state.rev !== state.rev) return;
      const intent = core.botIntent(state, selfSeat);
      if (intent) sendIntent(intent);
    });
  }

  // -- host timers: autoplay for absent seats, intro/results timeouts
  function scheduleHostTimers(state) {
    autoTimer = cancel(autoTimer);
    const absent = [];
    if (state.phase === PHASE.boardTurn && !state.seats[state.turn.seat].connected) absent.push(state.turn.seat);
    if (state.phase === PHASE.minigameIntro) {
      for (const seat of state.minigame.seats) if (!state.seats[seat].connected && !state.minigame.ready.includes(seat)) absent.push(seat);
    }
    if (absent.length) {
      // during the resume grace the autoplay is postponed to its end (the timer fires even if no new state arrives; rev check as usual)
      autoTimer = later(Math.max(TIMING.AUTOPLAY_DELAY_MS, graceUntil - performance.now() + TIMING.AUTOPLAY_DELAY_MS), () => {
        if (hostState.rev !== state.rev) return;
        for (const seat of absent) {
          const intent = core.botIntent(hostState, seat);
          if (intent) apply(seat, intent);
        }
      });
    }
    const key = `${state.phase}|${state.round}|${state.minigame?.seed}`;
    if (key === phaseKey) return;
    phaseKey = key;
    phaseTimer = cancel(phaseTimer);
    const ms = state.phase === PHASE.minigameIntro ? TIMING.INTRO_MAX_MS : state.phase === PHASE.minigameResults ? TIMING.RESULTS_MS : 0;
    if (ms) {
      phaseTimer = later(ms, () => {
        if (hostState.phase === state.phase) apply(HOST_SEAT, { type: 'advance' });
      });
    }
  }

  // -- go
  if (isHost) {
    storeSave(gameId, core.serialize(hostState), debug.pid);
    onState(hostState, [], hostState.rev);
  } else {
    ui.showConnecting('Verbinde mit dem Spiel…', () => leave());
    later(CONNECT_HINT_MS, () => {
      if (!run.state) ui.showConnecting('Noch kein Host in Sicht. Stimmt der Link? Ist der Host online?', () => leave());
    });
  }
}
