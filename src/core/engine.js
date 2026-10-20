import {
  createRng, rankOf, ERR, INTENT, HOST_SEAT, MIN_PLAYERS, MAX_PLAYERS, MAX_ITEMS, NAME_MAX, STAR_TARGET, STATE_VERSION,
  PLAYER_COLORS, HATS, BOARD_ID, MINIGAMES, ITEM,
} from '../contracts.js';
import { RULES_FOR_STATE, DIE, SHOP_ITEMS, MG_HISTORY_LEN, LOG_LEN } from './rules.js';
import { getBoard, hasBoard } from './boards.js';
import { pickMinigame } from './minigames.js';

// ---------------------------------------------------------------------------------------------------------------------
// plumbing

class Fail extends Error { constructor(code) { super(code); this.code = code; } }
const fail = (code) => { throw new Fail(code); };
const NOOP = Symbol('noop');
const HOST_INTENTS = new Set(['seatJoin', 'seatPresence', 'advance', 'minigameDone']);

const clone = (o) => structuredClone(o);
const newPlayer = (rules) => ({ coins: rules.startCoins, stars: 0, items: [], spaceId: null, mgWins: 0, skipTurns: 0 });
const nameOf = (c, seat) => c.st.seats[seat]?.profile.name ?? '?';
const connectedSeats = (st) => st.seats.filter((s) => s.connected).map((s) => s.index);

const spaceMaps = new WeakMap();
function spaceOf(board, id) {
  let m = spaceMaps.get(board);
  if (!m) spaceMaps.set(board, (m = new Map(board.spaces.map((s) => [s.id, s]))));
  return m.get(id);
}
const boardOf = (c) => getBoard(c.st.settings.boardId);

function emit(c, e) { c.ev.push(e); }
function log(c, seat, text) {
  c.st.log.push({ seat, text });
  while (c.st.log.length > LOG_LEN) c.st.log.shift();
}

// ---------------------------------------------------------------------------------------------------------------------
// profiles

const colorTaken = (st, color, exceptIdx) => st.seats.some((s) => s.index !== exceptIdx && s.profile.color === color);

/** merges a partial profile into `base`: trims/clamps the name, validates hat, keeps the colour unique */
function mergeProfile(st, idx, base, p) {
  const out = { ...base };
  if (p && typeof p === 'object') {
    if (typeof p.name === 'string') { const n = p.name.trim().slice(0, NAME_MAX).trim(); if (n) out.name = n; }
    if (HATS.includes(p.hat)) out.hat = p.hat;
    if (PLAYER_COLORS.includes(p.color) && !colorTaken(st, p.color, idx)) out.color = p.color;
  }
  return out;
}

function newSeat(st, playerId, profile, isHost, isBot) {
  const index = st.seats.length;
  const color = PLAYER_COLORS.find((col) => !colorTaken(st, col, -1)) ?? PLAYER_COLORS[0];
  const base = { playerId, name: `Spieler ${index + 1}`, color, hat: 'none' };
  const seat = { index, playerId, profile: mergeProfile(st, -1, base, profile), connected: true, isHost, isBot: !!isBot };
  st.seats.push(seat);
  st.players.push(newPlayer(st.rules));
  return seat;
}

// ---------------------------------------------------------------------------------------------------------------------
// public: createGame / save / load

export function createGame({ gameId, hostPlayerId, hostProfile, seed, starTarget, boardId, forceMinigame = null, availableMinigames = null }) {
  const avail = Array.isArray(availableMinigames) ? [...new Set(availableMinigames.filter((id) => Object.hasOwn(MINIGAMES, id)))] : [];
  const st = {
    version: STATE_VERSION, gameId, rev: 0, seed: seed >>> 0, rng: createRng(seed).state(),
    phase: 'lobby',
    settings: {
      starTarget: Number.isInteger(starTarget) && starTarget >= 1 ? starTarget : STAR_TARGET.default,
      boardId: Object.hasOwn(BOARD_ID, boardId) ? boardId : 'spaeti',
      forceMinigame: forceMinigame && Object.hasOwn(MINIGAMES, forceMinigame) ? forceMinigame : null,
      availableMinigames: avail.length ? avail : null,   // null = every MINIGAMES id
    },
    rules: clone(RULES_FOR_STATE),
    seats: [], players: [], turnOrder: [], turnIndex: 0, round: 0, turn: null, starSpaceId: null, traps: {},
    endspurt: false, minigame: null, mgHistory: [], winner: null, log: [],
  };
  newSeat(st, hostPlayerId, hostProfile, true, false);
  return st;
}

export const serialize = (state) => JSON.stringify(state);

export function deserialize(json) {
  try {
    const s = JSON.parse(json);
    if (!s || typeof s !== 'object' || s.version !== STATE_VERSION || !Array.isArray(s.seats) || !Array.isArray(s.players)) return null;
    return s;
  } catch { return null; }
}

/** host reopened: everyone but the host is offline until they rejoin; a running minigame restarts at its intro */
export function resumeGame(state, hostPlayerId) {
  const st = clone(state);
  const hostIdx = Math.max(0, st.seats.findIndex((s) => s.playerId === hostPlayerId));
  for (const s of st.seats) s.connected = s.index === hostIdx;
  if (st.phase === 'lobby') removeDisconnected(st);
  if (st.phase === 'minigame') {
    st.phase = 'minigameIntro';
    st.minigame.ready = [];
  }
  st.rev++;
  return st;
}

/** lobby only: drop disconnected seats and re-pack indices */
function removeDisconnected(st) {
  st.players = st.players.filter((_, i) => st.seats[i].connected);
  st.seats = st.seats.filter((s) => s.connected);
  st.seats.forEach((s, i) => { s.index = i; });
}

// ---------------------------------------------------------------------------------------------------------------------
// public: applyIntent

export function applyIntent(state, actor, intent) {
  try {
    const c = { st: clone(state), ev: [], rng: createRng(state.rng) };
    const r = dispatch(c, actor, intent);
    if (r === NOOP) return { state, events: [], error: null };
    c.st.rng = c.rng.state();
    c.st.rev++;
    return { state: c.st, events: c.ev, error: null };
  } catch (e) {
    if (e instanceof Fail) return { state, events: [], error: e.code };
    throw e;
  }
}

function dispatch(c, actor, intent) {
  const t = intent?.type;
  if (typeof t !== 'string' || !Object.hasOwn(INTENT, t)) fail(ERR.invalid);
  if (HOST_INTENTS.has(t)) {
    if (actor !== HOST_SEAT) fail(ERR.forbidden);
  } else if (!Number.isInteger(actor) || actor < 0 || actor >= c.st.seats.length) fail(ERR.forbidden);
  return HANDLERS[t](c, actor, intent);
}

function requireHostSeat(c, actor, phase) {
  if (!c.st.seats[actor].isHost) fail(ERR.forbidden);
  if (c.st.phase !== phase) fail(ERR.wrongPhase);
}

function requireTurn(c, actor, step) {
  const { st } = c;
  if (st.phase !== 'boardTurn') fail(ERR.wrongPhase);
  if (st.turn.seat !== actor) fail(ERR.notYourTurn);
  if (st.turn.step !== step) fail(ERR.wrongStep);
  return st.turn;
}

// ---------------------------------------------------------------------------------------------------------------------
// lobby intents

const HANDLERS = {
  setProfile(c, actor, i) {
    if (c.st.phase !== 'lobby') fail(ERR.wrongPhase);
    if (!i.profile || typeof i.profile !== 'object') fail(ERR.invalid);
    const seat = c.st.seats[actor];
    const next = mergeProfile(c.st, actor, seat.profile, i.profile);
    if (JSON.stringify(next) === JSON.stringify(seat.profile)) return NOOP;
    seat.profile = next;
  },

  setSettings(c, actor, i) {
    requireHostSeat(c, actor, 'lobby');
    const { settings } = c.st;
    const next = { ...settings };
    if (i.starTarget !== undefined) {
      if (!Number.isInteger(i.starTarget) || i.starTarget < 1) fail(ERR.invalid);
      next.starTarget = Math.min(STAR_TARGET.max, Math.max(STAR_TARGET.min, i.starTarget));
    }
    if (i.boardId !== undefined) {
      if (!Object.hasOwn(BOARD_ID, i.boardId) || !hasBoard(i.boardId)) fail(ERR.invalid);
      next.boardId = i.boardId;
    }
    if (JSON.stringify(next) === JSON.stringify(settings)) return NOOP;
    c.st.settings = next;
  },

  startGame(c, actor) {
    requireHostSeat(c, actor, 'lobby');
    const { st } = c;
    if (connectedSeats(st).length < MIN_PLAYERS) fail(ERR.tooFewPlayers);
    if (!hasBoard(st.settings.boardId)) fail(ERR.invalid);
    const board = boardOf(c);
    for (const p of st.players) p.spaceId = board.startSpaceId;
    st.turnOrder = c.rng.shuffle(connectedSeats(st));
    st.starSpaceId = c.rng.pick(board.starSpaceIds);
    emit(c, { type: 'gameStarted' });
    log(c, null, 'Das Spiel beginnt!');
    startRound(c, 1);
  },

  rematch(c, actor) {
    requireHostSeat(c, actor, 'victory');
    const st = c.st;
    removeDisconnected(st);
    st.players = st.seats.map(() => newPlayer(st.rules));
    Object.assign(st, {
      phase: 'lobby', turnOrder: [], turnIndex: 0, round: 0, turn: null, starSpaceId: null, traps: {},
      endspurt: false, minigame: null, mgHistory: [], winner: null, log: [],
    });
  },

  // -------------------------------------------------------------------------------------------------------------------
  // board turn intents

  roll(c, actor) {
    const t = requireTurn(c, actor, 'roll');
    const dice = Array.from({ length: t.doubleDice ? 2 : 1 }, () => c.rng.int(DIE.min, DIE.max));
    const value = dice.reduce((a, b) => a + b, 0);
    t.doubleDice = false;
    t.lastRoll = value;
    t.stepsLeft = value;
    emit(c, { type: 'diceRolled', seat: actor, value, dice });
    walk(c, [], null);
  },

  useItem(c, actor, i) {
    const t = requireTurn(c, actor, 'roll');
    const { st } = c;
    const p = st.players[actor];
    const at = p.items.indexOf(i.item);
    if (at < 0) fail(ERR.invalid);
    const e = { type: 'itemUsed', seat: actor, item: i.item };
    if (i.item === ITEM.doubleDice) {
      if (t.doubleDice) fail(ERR.invalid);
      t.doubleDice = true;
    } else if (i.item === ITEM.goldenDoener) {
      t.extraRolls++;
    } else if (i.item === ITEM.steal) {
      const target = i.targetSeat;
      if (!Number.isInteger(target) || target === actor || target < 0 || target >= st.seats.length) fail(ERR.invalid);
      if (st.players[target].coins <= 0) fail(ERR.invalid);
      e.targetSeat = target;
      p.items.splice(at, 1);
      emit(c, e);
      const got = Math.min(st.rules.stealCoins, st.players[target].coins);
      changeCoins(c, target, -got, 'steal');
      changeCoins(c, actor, got, 'steal');
      log(c, actor, `${nameOf(c, actor)} klaut ${nameOf(c, target)} ${got} Münzen.`);
      return;
    } else if (i.item === ITEM.trap) {
      const sp = typeof i.spaceId === 'string' ? spaceOf(boardOf(c), i.spaceId) : null;
      if (!sp || sp.type === 'start' || sp.type === 'shop' || st.traps[sp.id] !== undefined) fail(ERR.invalid);
      st.traps[sp.id] = actor;
      e.spaceId = sp.id;
    } else fail(ERR.invalid);
    p.items.splice(at, 1);
    emit(c, e);
  },

  choosePath(c, actor, i) {
    const t = requireTurn(c, actor, 'path');
    if (typeof i.spaceId !== 'string' || !t.options.includes(i.spaceId)) fail(ERR.invalid);
    walk(c, [], i.spaceId);
  },

  buyStar(c, actor, i) {
    const t = requireTurn(c, actor, 'star');
    if (typeof i.accept !== 'boolean') fail(ERR.invalid);
    const { st } = c;
    const p = st.players[actor];
    if (i.accept) {
      const price = st.rules.starPrice;
      if (p.coins < price) fail(ERR.cantAfford);
      changeCoins(c, actor, -price, 'star');
      p.stars++;
      const others = boardOf(c).starSpaceIds.filter((id) => id !== st.starSpaceId);
      const newStarSpaceId = others.length ? c.rng.pick(others) : st.starSpaceId;
      st.starSpaceId = newStarSpaceId;
      emit(c, { type: 'starBought', seat: actor, price, total: p.stars, newStarSpaceId });
      log(c, actor, `${nameOf(c, actor)} kauft einen Stern!`);
      checkStars(c, actor);
      if (st.phase === 'victory') return;
    }
    t.step = 'roll';
    walk(c, [], null);
  },

  buyItem(c, actor, i) {
    const t = requireTurn(c, actor, 'shop');
    const { st } = c;
    const p = st.players[actor];
    if (i.item !== null) {
      const entry = t.offer.find((o) => o.item === i.item);
      if (!entry) fail(ERR.invalid);
      if (p.items.length >= MAX_ITEMS) fail(ERR.itemsFull);
      if (p.coins < entry.price) fail(ERR.cantAfford);
      changeCoins(c, actor, -entry.price, 'shop');
      p.items.push(entry.item);
      emit(c, { type: 'itemBought', seat: actor, item: entry.item, price: entry.price });
    }
    walk(c, [], null);
  },

  // -------------------------------------------------------------------------------------------------------------------
  // minigame intents

  ready(c, actor) {
    const { st } = c;
    if (st.phase !== 'minigameIntro') fail(ERR.wrongPhase);
    if (!st.minigame.seats.includes(actor)) fail(ERR.forbidden);
    if (st.minigame.ready.includes(actor)) return NOOP;
    st.minigame.ready.push(actor);
    st.minigame.ready.sort((a, b) => a - b);
    maybeStartMinigame(c);
  },

  // -------------------------------------------------------------------------------------------------------------------
  // host-internal intents

  seatJoin(c, _actor, i) {
    const { st } = c;
    if (typeof i.playerId !== 'string' || !i.playerId) fail(ERR.invalid);
    const known = st.seats.find((s) => s.playerId === i.playerId);
    if (known) {
      known.connected = true;
      known.isBot = !!i.isBot;
      known.profile = mergeProfile(st, known.index, known.profile, i.profile);
      emit(c, { type: 'seatJoined', seat: known.index, rejoin: true });
      return;
    }
    if (st.phase !== 'lobby') fail(ERR.started);
    if (st.seats.length >= MAX_PLAYERS) fail(ERR.full);
    const seat = newSeat(st, i.playerId, i.profile, false, i.isBot);
    emit(c, { type: 'seatJoined', seat: seat.index, rejoin: false });
  },

  seatPresence(c, _actor, i) {
    const { st } = c;
    if (!Number.isInteger(i.seat) || i.seat < 0 || i.seat >= st.seats.length || typeof i.connected !== 'boolean') fail(ERR.invalid);
    const seat = st.seats[i.seat];
    if (seat.connected === i.connected) return NOOP;
    if (!i.connected && st.phase === 'lobby') {
      if (seat.isHost) fail(ERR.invalid);
      st.seats.splice(i.seat, 1);
      st.players.splice(i.seat, 1);
      st.seats.forEach((s, k) => { s.index = k; });
      emit(c, { type: 'seatLeft', seat: i.seat });
      return;
    }
    seat.connected = i.connected;
    emit(c, i.connected ? { type: 'seatJoined', seat: i.seat, rejoin: true } : { type: 'seatLeft', seat: i.seat });
    if (!i.connected) maybeStartMinigame(c);
  },

  advance(c) {
    const { st } = c;
    if (st.phase === 'minigameIntro') {
      st.phase = 'minigame';
    } else if (st.phase === 'minigameResults') {
      const duel = st.minigame.purpose === 'duel';
      st.minigame = null;
      st.phase = 'boardTurn';
      if (duel) finishAction(c);
      else startRound(c, st.round + 1);
    } else return NOOP;
  },

  minigameDone(c, _actor, i) {
    const { st } = c;
    if (st.phase !== 'minigame') fail(ERR.wrongPhase);
    if (!Array.isArray(i.results?.placements)) fail(ERR.invalid);
    const mg = st.minigame;
    // normalise: only participants, each once, missing participants share a last group
    const seen = new Set();
    const groups = [];
    for (const g of i.results.placements) {
      if (!Array.isArray(g)) fail(ERR.invalid);
      const keep = g.filter((s) => mg.seats.includes(s) && !seen.has(s) && seen.add(s));
      if (keep.length) groups.push(keep.sort((a, b) => a - b));
    }
    const missing = mg.seats.filter((s) => !seen.has(s));
    if (missing.length) groups.push(missing);
    const results = { placements: groups };
    if (i.results.labels && typeof i.results.labels === 'object') results.labels = clone(i.results.labels);

    // teams compete as units: a team's rank is its place among the teams; solo/ffa uses standard competition ranks
    const rank = mg.mode === 'team'
      ? Object.fromEntries(groups.flatMap((g, k) => g.map((s) => [s, k + 1])))
      : rankOf(groups);
    const delta = Object.fromEntries(mg.seats.map((s) => [s, 0]));
    const duel = mg.purpose === 'duel';
    if (duel) {
      if (groups.length > 1 && groups[0].length === 1) {
        const [w] = groups[0], l = groups[1][0];
        const amt = Math.min(st.rules.duelStake, st.players[l].coins);
        delta[w] = amt;
        delta[l] = -amt;
      }
    } else {
      for (const s of mg.seats) {
        delta[s] = st.rules.minigameCoins[rank[s] - 1] ?? 0;
        if (rank[s] === 1) st.players[s].mgWins++;
      }
    }
    mg.results = clone(results);
    mg.coinDelta = delta;
    st.phase = 'minigameResults';
    emit(c, { type: 'minigameResults', results: clone(results), coinDelta: { ...delta } });
    for (const s of mg.seats) if (delta[s]) changeCoins(c, s, delta[s], duel ? 'duel' : 'minigame');
    const best = groups[0].map((s) => nameOf(c, s)).join(' & ');
    log(c, null, duel ? `Duell: ${best} gewinnt.` : `Minispiel: ${best} gewinnt.`);
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// coins, stars, win

/** applies delta (floored at 0), emits coinsChanged when something changed, returns the actual delta */
function changeCoins(c, seat, delta, reason) {
  const p = c.st.players[seat];
  const actual = Math.max(-p.coins, delta);
  p.coins += actual;
  if (actual !== 0) emit(c, { type: 'coinsChanged', seat, delta: actual, total: p.coins, reason });
  return actual;
}

/** Endspurt at max(1, N-2) stars (flag always set; event only if that does not already win), victory at N */
function checkStars(c, seat) {
  const { st } = c;
  const n = st.settings.starTarget;
  const stars = st.players[seat].stars;
  if (!st.endspurt && stars >= Math.max(1, n - 2)) {
    st.endspurt = true;
    if (stars < n) {
      emit(c, { type: 'endspurtStarted' });
      log(c, null, 'Endspurt! Münzfelder zählen doppelt.');
    }
  }
  if (stars >= n && st.phase !== 'victory') {
    st.phase = 'victory';
    st.winner = seat;
    st.turn = null;
    st.minigame = null;
    emit(c, { type: 'victory', seat });
    log(c, seat, `${nameOf(c, seat)} gewinnt das Spiel!`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// turn flow

function startRound(c, round) {
  const { st } = c;
  st.round = round;
  st.turnIndex = 0;
  st.phase = 'boardTurn';
  st.minigame = null;
  emit(c, { type: 'roundStarted', round });
  beginTurn(c);
}

/** sets st.turn for turnOrder[turnIndex], skipping seats that must sit out; past the last seat the round minigame starts */
function beginTurn(c) {
  const { st } = c;
  while (st.turnIndex < st.turnOrder.length) {
    const seat = st.turnOrder[st.turnIndex];
    const p = st.players[seat];
    if (p.skipTurns > 0) {
      p.skipTurns--;
      emit(c, { type: 'turnSkipped', seat });
      st.turnIndex++;
      continue;
    }
    st.turn = { seat, step: 'roll', stepsLeft: 0, options: [], offer: [], doubleDice: false, extraRolls: 0, lastRoll: null };
    emit(c, { type: 'turnStarted', seat });
    return;
  }
  endRound(c);
}

function nextTurn(c) {
  c.st.turnIndex++;
  beginTurn(c);
}

/** the turn's action is over (move + landing, duel included): Goldener Döner rolls again, else next player */
function finishAction(c) {
  const t = c.st.turn;
  if (t.extraRolls > 0) {
    t.extraRolls--;
    Object.assign(t, { step: 'roll', stepsLeft: 0, options: [], offer: [] });
  } else nextTurn(c);
}

function endRound(c) {
  const { st } = c;
  st.turn = null;
  const seats = connectedSeats(st);
  if (seats.length < 2) return startRound(c, st.round + 1);   // nobody to play with: skip the minigame
  const mg = pickFor(c, 'round', seats);
  if (!mg) return startRound(c, st.round + 1);   // no playable minigame: skip it
  enterMinigame(c, mg);
}

/** picks a minigame honouring ?mg and the availability allowlist; null when nothing is playable (no state change, no events) */
function pickFor(c, purpose, seats) {
  const { st } = c;
  return pickMinigame({
    seats, purpose, forceId: st.settings.forceMinigame, recent: st.mgHistory, rng: c.rng, allowed: st.settings.availableMinigames,
  });
}

function enterMinigame(c, mg) {
  const { st } = c;
  st.mgHistory.push(mg.id);
  while (st.mgHistory.length > MG_HISTORY_LEN) st.mgHistory.shift();
  st.minigame = mg;
  st.phase = 'minigameIntro';
  emit(c, { type: 'minigameStart', minigame: clone(mg) });
}

/** intro -> minigame as soon as every CONNECTED participant is ready */
function maybeStartMinigame(c) {
  const { st } = c;
  if (st.phase !== 'minigameIntro') return;
  const need = st.minigame.seats.filter((s) => st.seats[s].connected);
  if (need.every((s) => st.minigame.ready.includes(s))) st.phase = 'minigame';
}

// ---------------------------------------------------------------------------------------------------------------------
// movement

function flush(c, path) {
  if (path.length) c.ev.push({ type: 'moved', seat: c.st.turn.seat, path: [...path] });
  path.length = 0;
}

/**
 * Walks the current player. `chosen` = first space (from choosePath). Stops at: a fork (step 'path'), the star when
 * affordable (step 'star'), a shop with something to buy (step 'shop'), or when stepsLeft hits 0 (landing).
 * Star and shop prompts happen on PASSING as well as LANDING; the landing space's own effect still follows a landing prompt.
 */
function walk(c, path, chosen) {
  const { st } = c;
  const t = st.turn;
  const p = st.players[t.seat];
  const board = boardOf(c);
  t.step = 'roll';
  t.options = [];
  t.offer = [];
  let next = chosen;
  for (;;) {
    if (next === null) {
      if (t.stepsLeft === 0) { flush(c, path); return land(c); }
      const cur = spaceOf(board, p.spaceId);
      if (cur.next.length > 1) {
        flush(c, path);
        t.step = 'path';
        t.options = [...cur.next];
        return;
      }
      next = cur.next[0];
    }
    p.spaceId = next;
    t.stepsLeft--;
    path.push(next);
    next = null;
    if (arrivalPrompt(c)) { flush(c, path); return; }
  }
}

/** star (only when affordable) or shop (only if a purchase is possible) on the space just reached; sets the step */
function arrivalPrompt(c) {
  const { st } = c;
  const t = st.turn;
  const p = st.players[t.seat];
  const sp = spaceOf(boardOf(c), p.spaceId);
  if (sp.id === st.starSpaceId && p.coins >= st.rules.starPrice) {
    t.step = 'star';
    return true;
  }
  if (sp.type === 'shop' && p.items.length < MAX_ITEMS) {
    const offer = SHOP_ITEMS.map((item) => ({ item, price: st.rules.itemPrices[item] }));
    if (offer.some((o) => o.price <= p.coins)) {
      t.step = 'shop';
      t.offer = offer;
      return true;
    }
  }
  return false;
}

/** the move ended: trap, space effect, then a duel if someone else is standing here */
function land(c) {
  const { st } = c;
  const t = st.turn;
  const seat = t.seat;
  const p = st.players[seat];
  const board = boardOf(c);
  const sp = spaceOf(board, p.spaceId);
  const mult = st.endspurt ? st.rules.endspurtMultiplier : 1;
  let teleported = false;

  const owner = st.traps[sp.id];
  if (owner !== undefined && owner !== seat) {
    delete st.traps[sp.id];
    emit(c, { type: 'trapTriggered', spaceId: sp.id, ownerSeat: owner, victimSeat: seat });
    const lost = -changeCoins(c, seat, -st.rules.trapCoins, 'trap');
    changeCoins(c, owner, lost, 'trap');
    log(c, seat, `${nameOf(c, seat)} tappt in die Falle von ${nameOf(c, owner)}.`);
  }

  if (sp.type === 'blue') changeCoins(c, seat, st.rules.blueCoins * mult, 'space');
  else if (sp.type === 'red') changeCoins(c, seat, -st.rules.redCoins * mult, 'space');
  else if (sp.type === 'event') {
    const res = board.events[sp.eventId]({ state: st, seat, rng: c.rng, board });
    const e = { type: 'eventSpace', seat, eventId: sp.eventId, banner: res.banner, effects: clone(res.effects) };
    if (res.lineId) e.lineId = res.lineId;
    if (res.sfx) e.sfx = res.sfx;
    emit(c, e);
    log(c, seat, res.banner);
    teleported = applyEffects(c, board, seat, res.effects);
    if (st.phase === 'victory') return;
  }

  if (!teleported && st.seats[seat].connected) {
    const others = st.players.flatMap((q, i) => (i !== seat && st.seats[i].connected && q.spaceId === p.spaceId ? [i] : []));
    if (others.length) {
      const opp = c.rng.pick(others);
      const mg = pickFor(c, 'duel', [seat, opp]);
      if (mg) {   // no playable solo minigame => no duel
        emit(c, { type: 'duelStart', seats: [seat, opp] });
        log(c, null, `Duell: ${nameOf(c, seat)} gegen ${nameOf(c, opp)}!`);
        enterMinigame(c, mg);
        return;
      }
    }
  }
  finishAction(c);
}

/** applies board event effects; returns true if the moving player was teleported (=> no duel) */
function applyEffects(c, board, mover, effects) {
  const { st } = c;
  let moved = false;
  for (const e of effects) {
    const p = Number.isInteger(e.seat) ? st.players[e.seat] : null;
    if (!p) continue;
    if (e.type === 'coins') changeCoins(c, e.seat, e.delta, 'event');
    else if (e.type === 'stars') {
      p.stars = Math.max(0, p.stars + e.delta);
      if (e.delta > 0) checkStars(c, e.seat);
      if (st.phase === 'victory') return moved;
    } else if (e.type === 'moveTo') {
      if (!spaceOf(board, e.spaceId)) continue;
      emit(c, { type: 'teleported', seat: e.seat, from: p.spaceId, to: e.spaceId });
      p.spaceId = e.spaceId;
      if (e.seat === mover) moved = true;
    } else if (e.type === 'giveItem') {
      if (Object.hasOwn(ITEM, e.item) && p.items.length < MAX_ITEMS) p.items.push(e.item);
    } else if (e.type === 'skipTurns') p.skipTurns += Math.max(0, e.count | 0);
  }
  return moved;
}
