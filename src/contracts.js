/**
 * Walters Knaggertreff -- FROZEN MODULE CONTRACTS (single source of truth between modules).
 *
 * Importable from browser AND plain node. No imports, no DOM/storage access at module load.
 * Real code here is limited to constants/enums and tiny pure helpers that two modules must share.
 * Everything else is JSDoc. If a signature here is wrong, tell the lead; do not fork it locally.
 *
 * GLOBAL CONVENTIONS
 *  - Identity inside a game is the SEAT INDEX (number, 0-based, == index into state.seats/state.players,
 *    stable once the game started). playerId (uuid) exists only at the net boundary + seat lookup.
 *  - All times are integer MILLISECONDS unless the name says otherwise. All state is plain JSON.
 *  - Board coordinates are world px (x right, y down). Minigame coordinates are the "logical" px of MG_VIEW.
 *    Input vectors are -1..1 (y positive = DOWN, like screen space).
 *  - Code/identifiers English, every user-visible string German (D9).
 *  - Host is authoritative. Only the host runs core.applyIntent. Clients render `state` messages.
 *
 * SECTIONS (grep the `=====` headers; each lists its consumers)
 *   1 Constants & enums        (all)            7 Net: messages/transport/session (net, ui, main, runner)
 *   2 Shared pure helpers      (all)            8 Input                           (input, board, minigames, ui)
 *   3 Identity & storage       (net, ui, main)  9 Audio                           (audio, board, minigames, ui)
 *   4 GameState                (core, ui, board)10 Minigame module + runner        (minigames, core, main)
 *   5 Board definition         (core, board)    11 Screens & main.js host driver  (main, board, minigames, ui)
 *   6 Intents, events, core API(core, board, ui, main)
 */

// ===== 1. Constants & enums  [all] =====

const freeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v); return Object.freeze(o); };
/** enum helper: en('a','b') -> {a:'a', b:'b'} (frozen) so typos become undefined instead of silent strings */
const en = (...names) => Object.freeze(Object.fromEntries(names.map((n) => [n, n])));

export const APP_ID = 'walters-knaggertreff-v1';   // Trystero appId; local transport channel = `wk:${gameId}`
export const PROTOCOL_VERSION = 2;                 // bump on any wire/state-shape change; mismatch => reject 'protocol' (2: + mgOwn)
export const STATE_VERSION = 1;                    // GameState.version; save with other version => deserialize() returns null
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const MAX_ITEMS = 3;
export const NAME_MAX = 16;
export const STAR_TARGET = freeze({ min: 1, max: 15, default: 5 });   // default 5 ~ 45 min (4 players, tools/sim.mjs); host UI clamps to min..max; `?stars=` bypasses the max
export const HOST_SEAT = -1;                       // `actor` for host-internal intents (see HostIntent)
export const SCREEN = freeze({ w: 1280, h: 720 }); // Kaplay canvas logical size (main.js creates it with letterbox)

/** Minigame logical viewport per kind (what a minigame draws into; runner scales it for thumbnails). */
export const MG_VIEW = freeze({ solo: { w: 960, h: 720 }, arena: { w: 1280, h: 720 }, team: { w: 1280, h: 720 } });

/** Rates and durations that more than one module relies on. */
export const TIMING = freeze({
  SOLO_PROGRESS_HZ: 10,   // solo: client -> all `mgProgress`
  CLIENT_INPUT_HZ: 30,    // arena/team: client -> host `mgInput`
  HOST_STATE_HZ: 20,      // arena/team: host -> all `mgState`
  HOST_SIM_HZ: 60,        // arena/team: host runs hostStep with fixed dtMs = 1000/60 (accumulator), broadcast every 3rd step
  OWN_STATE_HZ: 30,       // arena/team owner modules: client -> host `mgOwn` (the owner's own body state; replaces mgInput for that client)
  OWN_STALE_MS: 500,      // an owner report older than this (host sim ms, mg.t) no longer counts: the seat falls back to the input path and coasts to a stop
  COUNTDOWN_MS: 3000,     // after phase becomes 'minigame': 3-2-1 shown, instance.go() at the end
  MG_GRACE_MS: 2500,      // host waits this long past COUNTDOWN_MS+durationMs for solo finals / ends arena hard
  INTRO_MAX_MS: 20000,    // host sends HostIntent `advance` if not everyone is ready by then
  RESULTS_MS: 7000,       // host sends `advance` this long after phase 'minigameResults' began
  AUTOPLAY_DELAY_MS: 1200,// host plays an absent (disconnected) seat's turn after this delay
  BOT_DELAY_MS: 700,      // `?bot` tab waits this long before sending a bot intent
  NAV_REPEAT: { delayMs: 350, intervalMs: 110 }, // menu key repeat
});

export const PHASE = en('lobby', 'boardTurn', 'minigameIntro', 'minigame', 'minigameResults', 'victory');
export const TURN_STEP = en('roll', 'path', 'star', 'shop');
export const MINIGAME_KIND = en('solo', 'arena', 'team');   // D3
export const MODE = en('ffa', 'duel', 'team');              // how a minigame is being played
export const SPACE_TYPE = en('start', 'blue', 'red', 'event', 'shop'); // the star is an OVERLAY (state.starSpaceId), not a type
export const BOARD_ID = en('spaeti', 'bahnhof');            // D10, D14

/** Minigame table. AUTHORITATIVE for kind/min/max (core must work in node without loading modules).
 *  Minigame modules do NOT repeat these. min/max = participants. Team: even count only, >= 4 (2v2, 3v3). Duel (2 players) allowed for solo kind only. */
export const MINIGAMES = freeze({
  onlyup:      { kind: 'solo',  min: 2, max: 6 },
  forza:       { kind: 'solo',  min: 2, max: 6 },
  pfand:       { kind: 'solo',  min: 2, max: 6 },
  doener:      { kind: 'solo',  min: 2, max: 6 },
  buergeramt:  { kind: 'solo',  min: 2, max: 6 },
  ubahn:       { kind: 'solo',  min: 2, max: 6 },   // U-Bahn-Surfers (3D runner, lazy three.js)
  schlager:    { kind: 'solo',  min: 2, max: 6 },   // Schlager Hero (4-lane rhythm game on A/B/X/Y)
  flappytaube: { kind: 'solo',  min: 2, max: 6 },   // Flappy Taube
  doodle:      { kind: 'solo',  min: 2, max: 6 },   // Doodle-Knagger (endless platform jumper)
  ordnungsamt: { kind: 'arena', min: 2, max: 6 },
  aura:        { kind: 'arena', min: 2, max: 6 },
  bahnsteig:   { kind: 'arena', min: 2, max: 6 },
  tauziehen:   { kind: 'team',  min: 4, max: 6 },
  sitzplatz:   { kind: 'team',  min: 4, max: 6 },
});
export const MINIGAME_IDS = Object.freeze(Object.keys(MINIGAMES));

/** Items (max MAX_ITEMS held). Prices live in core constants and are copied into state.rules at game creation. */
export const ITEM = en('doubleDice', 'goldenDoener', 'steal', 'trap');
export const ITEM_INFO = freeze({
  doubleDice:   { name: 'Doppelwürfel',   emoji: '🎲', blurb: 'Würfle diese Runde doppelt.' },
  goldenDoener: { name: 'Goldener Döner', emoji: '🥙', blurb: 'Ein zusätzlicher Wurf.' },
  steal:        { name: 'Flaschenklau',       emoji: '🍾', blurb: 'Klau einem Mitspieler Flaschen.' },
  trap:         { name: 'Stolperfalle',   emoji: '🪤', blurb: 'Leg eine Falle auf ein Feld.' },
});

/** Avatar look. Profile.color is one of PLAYER_COLORS (core keeps colours unique per game), hat one of HATS. */
export const PLAYER_COLORS = Object.freeze(['#ff5a5f', '#ffb400', '#8ce99a', '#4dabf7', '#b197fc', '#ff8fd0', '#38d9a9', '#ffd43b']);
// 'hotdog'/'cucumber' replaced 'party'/'beanie' (old saved profiles/saves with those ids: picker falls back to a valid hat, avatars draw no hat).
export const HATS = Object.freeze(['none', 'cap', 'cowboy', 'crown', 'tophat', 'hotdog', 'cucumber', 'propeller']);

// ===== 2. Shared pure helpers  [all] =====

/** Tiny seeded RNG (mulberry32). THE generator for core AND minigames (shared-seed simulation must match bit for bit).
 *  `state()` is a uint32 number: `createRng(rng.state())` continues exactly the same sequence (JSON round-trips).
 *  @typedef {{ next(): number, u32(): number, int(min:number, max:number): number, pick<T>(arr:T[]): T, shuffle<T>(arr:T[]): T[], state(): number }} Rng
 *  next(): [0,1). u32(): 0..2^32-1. int(): INCLUSIVE both ends. shuffle(): returns a copy (Fisher-Yates). */
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    u32: () => Math.floor(next() * 4294967296),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle: (arr) => { const o = arr.slice(); for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } return o; },
    state: () => a,
  };
}

/** Debug URL params (D19/D20). EVERY module parses via this function, never ad hoc.
 *  `?local` BroadcastChannel transport. `?bot` this tab plays itself. `?seed=N` fixed host RNG. `?mg=<id>` force minigame (invalid id -> null).
 *  `?coins=N` start purse of every player (test knob: with a fat purse bot decisions no longer depend on minigame outcomes, so a seed replays the same board).
 *  `?stars=N` override starTarget (>=1, NOT clamped to STAR_TARGET.max). `?pid=name` storage namespace (see KEYS) so several `?local`
 *  tabs in ONE browser context (BroadcastChannel does not cross isolated Playwright contexts!) get distinct identities.
 *  `?pool=id,id,...` limit the minigame pool to these ids (main.js intersects with the registry; null when absent/empty). Keeps e2e specs robust against new minigames.
 *  @param {string} search e.g. location.search
 *  `?lag=ms` test knob: delay every message this peer sends and receives by ms (int clamped to 0..2000; null when absent). Read by main.js, applied by src/net/lag.js.
 *  @returns {{ local:boolean, bot:boolean, seed:(number|null), mg:(string|null), stars:(number|null), coins:(number|null), pid:(string|null), pool:(string[]|null), lag:(number|null) }} */
export function parseDebugParams(search = '') {
  const q = new URLSearchParams(search);
  const flag = (n) => q.has(n) && !['0', 'false', 'no'].includes(q.get(n).toLowerCase());
  const int = (n) => { const v = q.get(n); return v !== null && /^-?\d+$/.test(v.trim()) ? parseInt(v, 10) : null; };
  const seed = int('seed'), stars = int('stars'), coins = int('coins'), lag = int('lag'), mg = q.get('mg'), pid = q.get('pid');
  const pool = (q.get('pool') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return {
    local: flag('local'),
    bot: flag('bot'),
    seed: seed === null ? null : seed >>> 0,
    mg: mg && Object.hasOwn(MINIGAMES, mg) ? mg : null,
    stars: stars !== null && stars >= 1 ? stars : null,
    coins: coins !== null && coins >= 0 ? coins : null,
    pid: pid && /^[a-z0-9_-]{1,16}$/i.test(pid) ? pid : null,
    pool: pool.length ? pool : null,
    lag: lag === null ? null : Math.max(0, Math.min(2000, lag)),
  };
}

/** Team minigames are offered only for an EVEN participant count of at least 4 (2v2, 3v3). core re-exports this. */
export const isTeamGameAllowed = (playerCount) => playerCount >= 4 && playerCount % 2 === 0;

/** Seat index of a playerId in a state, or -1. */
export const seatIndexOf = (state, playerId) => state.seats.findIndex((s) => s.playerId === playerId);

/** Standard-competition ranks from placement groups: [[2],[0,3],[1]] -> {2:1, 0:2, 3:2, 1:4}. */
export function rankOf(placements) {
  const r = {}; let n = 1;
  for (const g of placements) { for (const s of g) r[s] = n; n += g.length; }
  return r;
}

/** Solo ranking: HIGHER score wins; equal scores tie; score null/NaN (no final) => one shared last group.
 *  @param {{seat:number, score:(number|null)}[]} entries @returns {number[][]} placement groups, best first */
export function placementsFromScores(entries) {
  const ok = (e) => e.score != null && Number.isFinite(e.score);
  const groups = [];
  let last;
  for (const e of entries.filter(ok).sort((a, b) => b.score - a.score)) {
    if (last && last.score === e.score) last.seats.push(e.seat); else groups.push((last = { score: e.score, seats: [e.seat] }));
  }
  const out = groups.map((g) => g.seats);
  const none = entries.filter((e) => !ok(e)).map((e) => e.seat);
  if (none.length) out.push(none);
  return out;
}

/** gameId = Trystero room id = invite hash. 8 chars of an unambiguous lowercase alphabet (no i,l,o,0,1). */
export function makeGameId(len = 8) {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789';
  const b = new Uint8Array(len); globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => A[x % A.length]).join('');
}
/** '#abc23xyz' | 'abc23xyz' -> 'abc23xyz' (lowercased) | null */
export function parseGameIdFromHash(hash) {
  const m = /^#?([a-z0-9]{4,32})$/i.exec(hash || '');
  return m ? m[1].toLowerCase() : null;
}
/** Invite link `<origin><base>[?local]#<gameId>`. `base` = import.meta.env.BASE_URL (Vite, e.g. '/walters-knaggertreff/').
 *  `search`: pass '?local' when the debug param local is on, else ''. Never include pid/bot/seed. */
export function buildInviteLink(gameId, { origin, base = '/', search = '' }) {
  return `${origin}${base.endsWith('/') ? base : base + '/'}${search}#${gameId}`;
}

/** Board authoring check (use in tests and in core.registerBoard). Returns a list of problems, [] = valid. */
export function validateBoard(def) {
  const err = [];
  if (!def || typeof def.id !== 'string' || typeof def.name !== 'string') return ['id/name missing'];
  const ids = new Map((def.spaces || []).map((s) => [s.id, s]));
  if (!ids.size || ids.size !== def.spaces.length) err.push('spaces empty or duplicate ids');
  for (const s of def.spaces || []) {
    if (!Object.hasOwn(SPACE_TYPE, s.type)) err.push(`${s.id}: bad type ${s.type}`);
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) err.push(`${s.id}: x/y`);
    if (!s.next?.length || s.next.some((n) => !ids.has(n))) err.push(`${s.id}: next empty or dangling`);
    if (s.type === 'event' && !def.events?.[s.eventId]) err.push(`${s.id}: eventId ${s.eventId} has no handler`);
  }
  if (ids.get(def.startSpaceId)?.type !== 'start') err.push('startSpaceId must be a space of type start');
  if (!def.starSpaceIds?.length || def.starSpaceIds.some((i) => !ids.has(i) || ['start', 'shop'].includes(ids.get(i).type))) err.push('starSpaceIds empty/unknown/start/shop');
  const seen = new Set([def.startSpaceId]), q = [def.startSpaceId];
  while (q.length) for (const n of ids.get(q.pop())?.next || []) if (!seen.has(n)) { seen.add(n); q.push(n); }
  for (const id of ids.keys()) if (!seen.has(id)) err.push(`${id}: unreachable from start`);
  return err;
}

// ===== 3. Identity & storage  [net, ui, main] =====
// One browser = one player (D13). playerId is permanent (crypto.randomUUID()), profile is remembered, host-ness is remembered per game.
// `pid` (from ?pid=) is a namespace suffix; null/'' => no suffix. Without ?pid in ?local mode, net keeps identity in sessionStorage (per tab).
// Every storage read/write MUST be try/catch-wrapped (private windows); a failed read behaves as "nothing stored".

/** @typedef {{ playerId:string, name:string, color:string, hat:string }} PlayerProfile  name<=NAME_MAX trimmed, color in PLAYER_COLORS, hat in HATS */
export const KEYS = freeze({
  playerId: (pid) => `wk:player${pid ? ':' + pid : ''}`,                 // string uuid
  profile: (pid) => `wk:profile${pid ? ':' + pid : ''}`,                 // JSON PlayerProfile (without playerId is fine; net re-adds it)
  host: (gameId, pid) => `wk:host:${gameId}${pid ? ':' + pid : ''}`,     // string playerId that created this game => "I am host of gameId"
  save: (gameId, pid) => `wk:save:${gameId}${pid ? ':' + pid : ''}`,     // core.serialize(state) string (D12); host only
  muted: 'wk:muted',                                                      // '1' | '0' (audio, global)
  volume: 'wk:volume',                                                    // '0'..'1' master volume (audio, global; ui slider); default 0.7
});

/** Identity helpers exported by src/net/identity.js (all sync, never throw):
 *  @typedef {{
 *    loadIdentity(pid?:(string|null)): { playerId:string, profile:(PlayerProfile|null) },   // creates+stores playerId on first call
 *    saveProfile(profile:PlayerProfile, pid?:(string|null)): void,
 *    isHostOf(gameId:string, playerId:string, pid?:(string|null)): boolean,                 // KEYS.host(gameId) === playerId
 *    markHost(gameId:string, playerId:string, pid?:(string|null)): void,                    // call when the title screen CREATES a game
 *    loadSave(gameId:string, pid?:(string|null)): (string|null),
 *    storeSave(gameId:string, json:string, pid?:(string|null)): void,
 *  }} IdentityApi */

// ===== 4. GameState  [core (owns), ui, board, minigames (read)] =====
// Plain JSON, JSON.stringify round-trips, no Maps/classes/undefined. Never mutated by readers. `rev` increments on every
// applyIntent that changed anything; clients drop `state` messages with rev <= the last applied one.

/** @typedef {'lobby'|'boardTurn'|'minigameIntro'|'minigame'|'minigameResults'|'victory'} Phase
 *  lobby -> boardTurn -> (end of every round) minigameIntro -> minigame -> minigameResults -> boardTurn(next round) ... -> victory.
 *  A DUEL is the same three minigame phases with minigame.purpose='duel'; state.turn is kept and resumes afterwards. */
/** @typedef {'blue'|'red'|'event'|'shop'|'start'} SpaceType */
/** @typedef {'doubleDice'|'goldenDoener'|'steal'|'trap'} ItemId */
/** @typedef {'spaeti'|'bahnhof'} BoardId */
/** @typedef {'solo'|'arena'|'team'} MinigameKind */
/** @typedef {'ffa'|'duel'|'team'} Mode */

/** @typedef {{ index:number, playerId:string, profile:PlayerProfile, connected:boolean, isHost:boolean, isBot:boolean, ready?:boolean, hostBot?:boolean }} Seat
 *  ready = lobby "Bereit" flag (intent setReady). Only meaningful in 'lobby' for non-host seats: a new seat joins ready:false, rematch resets everyone to false,
 *  the host seat never sets it (the host "readies" by pressing Start). Absent (old saves) = false, so readers use `!!seat.ready`; STATE_VERSION unchanged.
 *  index === position in state.seats. Seat 0 is the host. isBot is informational (tab runs ?bot, self-reported in `hello`).
 *  In 'lobby' a disconnected seat is REMOVED (indices re-packed); after startGame seats are permanent and only flip `connected`. */

/** @typedef {{ coins:number, stars:number, items:ItemId[], spaceId:(string|null), mgWins:number, skipTurns:number }} PlayerState
 *  items.length <= MAX_ITEMS. spaceId null only in lobby. mgWins = rounds won (rank 1) for a possible bonus. skipTurns: turns to sit out. */

/** @typedef {{
 *   seat:number, step:('roll'|'path'|'star'|'shop'),
 *   stepsLeft:number,                          // moves still to make; >0 only while waiting at 'path' or 'star'
 *   options:string[],                          // step 'path': legal next space ids (choosePath.spaceId must be one of them)
 *   offer:{item:ItemId, price:number}[],       // step 'shop': what can be bought here
 *   doubleDice:boolean, extraRolls:number,     // armed doubleDice this turn; Goldener Döner rolls still to come
 *   lastRoll:(number|null),
 * }} Turn   -- Whose input the board waits for = turn.seat (+ turn.step). */

/** @typedef {{
 *   id:string, kind:MinigameKind, mode:Mode, purpose:('round'|'duel'),
 *   seats:number[],                            // participants (connected seats at pick time), ascending; non-participants sit out (0 coins)
 *   teams:(number[][]|null),                   // mode 'team': [[seats of team 0],[seats of team 1]], else null
 *   seed:number,                               // uint32 from the game rng; all clients + host seed createRng(seed) with it
 *   ready:number[],                            // seats that pressed `ready` during minigameIntro
 *   results:(MinigameResults|null),            // set when phase becomes 'minigameResults'
 *   coinDelta:(Object<string,number>|null),    // seat -> coins awarded for display (core fills with results)
 * }} MinigameDescriptor */

/** @typedef {{ seat:(number|null), text:string }} LogEntry   German one-liner for the UI log, newest last, capped at 30 */

/** @typedef {{
 *   starPrice:number, blueCoins:number, redCoins:number, endspurtMultiplier:number,
 *   itemPrices:Object<ItemId,number>, minigameCoins:number[], duelStake:number,
 *   maxDuelsPerRound:number,                   // duels per round cap (saves without it use the core default)
 *   startCoins:number, stealCoins:number, trapCoins:number, dieMin:number, dieMax:number,   // start purse, steal/trap amounts, die faces
 * }} Rules   -- copied from the single core constants file at createGame so ui/board can show prices without importing core internals. */

/** @typedef {{
 *   version:number,                            // STATE_VERSION
 *   gameId:string,
 *   rev:number,                                // monotonically increasing, see above
 *   seed:number, rng:number,                   // initial seed (informational) / CURRENT Rng.state() -- core re-creates createRng(state.rng) per call and writes it back
 *   phase:Phase,
 *   settings:{ starTarget:number, boardId:BoardId, forceMinigame:(string|null), availableMinigames:(string[]|null), testMode?:boolean, testLast?:(string|null) },
 *       // forceMinigame = ?mg (host's URL). availableMinigames = ids of minigame modules that actually exist (main.js passes listMinigames() ids);
 *       // null = every MINIGAMES id. Set once by createGame, kept by rematch/serialize. Saves without the field behave like null.
 *   rules:Rules,
 *   seats:Seat[], players:PlayerState[],       // parallel arrays, same length, index = seat index
 *   turnOrder:number[], turnIndex:number,      // seat indices in rolling order (fixed at startGame); turn.seat === turnOrder[turnIndex]
 *   round:number,                              // 1-based during play, 0 in lobby
 *   duelsThisRound:number,                     // duels started in the current round, reset by roundStarted; capped by rules.maxDuelsPerRound (saves without it count as 0)
 *   turn:(Turn|null),                          // null in lobby/victory
 *   starSpaceId:(string|null),                 // current star location, one of board.starSpaceIds
 *   traps:Object<string,number>,               // spaceId -> owner seat (max one per space)
 *   endspurt:boolean,                          // true once anyone reached max(1, starTarget-2) stars; coin spaces x rules.endspurtMultiplier
 *   minigame:(MinigameDescriptor|null),
 *   mgHistory:string[],                        // last picked minigame ids (to avoid repeats)
 *   winner:(number|null),                      // seat, phase 'victory'
 *   log:LogEntry[],
 * }} GameState */

/** Save format (D12): localStorage KEYS.save(gameId) = core.serialize(state) = JSON.stringify(state). Host writes it after EVERY applyIntent
 *  that changed state (lobby changes included; cheap, a few KB). Resume = core.resumeGame(core.deserialize(str), hostPlayerId). */

// ===== 5. Board definition  [core (consumes), board (owns data + rendering)] =====
// `src/board/boards/<id>.js` default-exports a BoardDef. The file must be PURE (no DOM, no kaplay, no imports except this file)
// so core can run it headless in node tests and tools/sim.mjs. Rendering extras live in the same data (theme/label), never as code.
// Registry: core exposes `registerBoard(def)` (calls validateBoard, throws on problems) + `getBoard(id)`. main.js registers every
// board found by `import.meta.glob('./boards/*.js', {eager:true})` in src/board/index.js (export `BOARDS: BoardDef[]`);
// core unit tests register their own tiny fixture board, so core never imports src/board.

/** @typedef {{ id:string, type:SpaceType, x:number, y:number, next:string[], eventId?:string, label?:string }} Space
 *  next.length > 1 => fork: the mover gets Turn.step 'path'. Every space has >= 1 next (boards are loops). Exactly one 'start' (no effect).
 *  Landing: blue +rules.blueCoins, red -rules.redCoins (floored at 0), x endspurtMultiplier in Endspurt; event runs events[eventId]; shop opens Turn 'shop'. */

/** @typedef {{ state:GameState, seat:number, rng:Rng, board:BoardDef }} EventContext   state is READ-ONLY; rng is core's live rng (write-back by core) */
/** @typedef {(
 *   { type:'coins', seat:number, delta:number }
 * | { type:'stars', seat:number, delta:number }
 * | { type:'moveTo', seat:number, spaceId:string }          // teleport: NO landing effects, NO duel at the destination
 * | { type:'giveItem', seat:number, item:ItemId }           // ignored if the seat is full
 * | { type:'skipTurns', seat:number, count:number }
 * )} EventEffect */
/** @typedef {{ banner:string, lineId?:string, sfx?:string, effects:EventEffect[] }} EventResult   banner = German text shown by the board; lineId = optional audio LINE id */
/** @typedef {(ctx:EventContext) => EventResult} EventHandler   PURE + deterministic given (state, rng); no prompts/choices (events never wait for input) */

/** @typedef {{
 *   id:BoardId, name:string, blurb:string,
 *   world:{ w:number, h:number }, theme:{ bg:string, accent:string },
 *   startSpaceId:string, spaces:Space[],
 *   starSpaceIds:string[],                     // eligible star locations (not start/shop); star moves to another random one after each purchase
 *   events:Object<string,EventHandler>,        // eventId -> handler (every Space.eventId must resolve)
 * }} BoardDef */

// ===== 6. Intents, events, core API  [core (implements), board/ui/main (call)] =====

export const INTENT = en('setProfile', 'setSettings', 'startGame', 'rematch', 'roll', 'useItem', 'choosePath', 'buyStar', 'buyItem', 'ready', 'setReady',
  'setTestMode', 'addBot', 'removeBot', 'testMinigame',
  'seatJoin', 'seatPresence', 'advance', 'minigameDone');
export const ERR = en('forbidden', 'wrongPhase', 'notYourTurn', 'wrongStep', 'invalid', 'tooFewPlayers', 'notReady', 'cantAfford', 'itemsFull', 'full', 'started', 'protocol', 'playerCount');

/** Player intents travel client -> host as MSG.intent. The host NEVER trusts a seat in the payload: it maps `from` playerId -> seat.
 *  WHO / WHEN:
 *   setProfile  any seat, phase lobby only (core trims name, keeps colour unique)
 *   setSettings host seat only, lobby   (starTarget STAR_TARGET.min..max or ?stars, boardId)
 *   setReady    non-host seat, phase lobby only: {ready:boolean} sets own seat.ready (idempotent). Host seat -> forbidden, other phase -> wrongPhase, non-boolean -> invalid
 *   startGame   host seat only, lobby, >= MIN_PLAYERS connected seats (else tooFewPlayers) AND every connected non-host seat ready (else notReady)
 *               -> phase boardTurn, round 1, turn order shuffled, star placed
 *   rematch     host seat only, victory -> back to lobby keeping seats/settings (coins/stars reset, every seat.ready back to false)
 *   roll        turn.seat only, boardTurn step 'roll'
 *   useItem     turn.seat only, step 'roll' (before rolling). doubleDice/goldenDoener: no args. steal: targetSeat (other seat). trap: spaceId (no start/shop, no existing trap)
 *   choosePath  turn.seat only, step 'path': spaceId in turn.options
 *   buyStar     turn.seat only, step 'star':  accept=false declines (movement continues)
 *   buyItem     turn.seat only, step 'shop':  item=null leaves without buying
 *   ready       any participant seat, minigameIntro (idempotent). minigame input is NOT an intent (see MSG.mgInput).
 *  TEST MODE (lobby only, host seat only; never touches stars/coins; see core/engine.js):
 *   setTestMode {on:boolean}   settings.testMode. Off removes every host-run bot seat. While on, startGame is refused (invalid).
 *   addBot      {count?:1..}   testMode only: adds host-run bot seats (seat.hostBot = isBot = ready = true, playerId 'bot-...'), clamped to MAX_PLAYERS (full when none fits)
 *   removeBot   {seat}         testMode only: removes a hostBot seat (invalid for any other seat)
 *   testMinigame {id}          testMode only: starts minigame `id` with ALL connected seats (>= MIN_PLAYERS, else tooFewPlayers; count outside min..max or an odd team count -> playerCount;
 *                              id outside settings.availableMinigames -> invalid) -> minigameIntro (hostBot seats pre-ready). minigameDone then pays nothing (no coins, no mgWins, no log);
 *                              `advance` after the results returns to phase 'lobby' (the picker), disconnected seats dropped. settings.testLast = last started id.
 *  @typedef {(
 *   { type:'setProfile', profile:Partial<PlayerProfile> }
 * | { type:'setSettings', starTarget?:number, boardId?:BoardId }
 * | { type:'setTestMode', on:boolean } | { type:'addBot', count?:number } | { type:'removeBot', seat:number } | { type:'testMinigame', id:string }
 * | { type:'startGame' } | { type:'rematch' }
 * | { type:'roll' }
 * | { type:'useItem', item:ItemId, targetSeat?:number, spaceId?:string }
 * | { type:'choosePath', spaceId:string }
 * | { type:'buyStar', accept:boolean }
 * | { type:'buyItem', item:(ItemId|null) }
 * | { type:'ready' } | { type:'setReady', ready:boolean }
 * )} PlayerIntent */

/** Host-internal intents: only applyIntent(state, HOST_SEAT, ...) accepts them (else ERR.forbidden). Sent by the host driver (section 11), never over the wire.
 *   seatJoin     {playerId, profile, isBot}: known playerId -> seat.connected=true + profile refresh (event seatJoined rejoin:true; coins/stars/position untouched);
 *                unknown + lobby + free seat -> new seat; unknown otherwise -> error ERR.full (lobby full) / ERR.started (game running), state unchanged.
 *   seatPresence {seat, connected}: lobby+disconnect removes the seat; otherwise flips connected.
 *   advance      time-driven transition: minigameIntro -> start minigame (even if not all ready); minigameResults -> next round / resume duel turn / victory. Other phases: no-op.
 *   minigameDone {results}: phase minigame -> minigameResults; core converts placements to coins via rules.minigameCoins + rankOf (ties share the better rank, team mode: every member of a group gets that group's rank coins). results.void => no coins at all.
 *  @typedef {(
 *   { type:'seatJoin', playerId:string, profile:PlayerProfile, isBot:boolean }
 * | { type:'seatPresence', seat:number, connected:boolean }
 * | { type:'advance' }
 * | { type:'minigameDone', results:MinigameResults }
 * )} HostIntent */
/** @typedef {PlayerIntent|HostIntent} Intent */

/** Host -> clients, bundled with the state in ONE message (MSG.state) in playback order. UI animates from events and finally shows `state`.
 *  Events are only delivered to whoever is mounted at that moment; screens must render correctly from `state` alone (no event replay on remount).
 *  `total` fields are the value AFTER the event so HUDs can tick up during playback.
 *  @typedef {(
 *   { type:'seatJoined', seat:number, rejoin:boolean }
 * | { type:'seatLeft', seat:number }
 * | { type:'gameStarted' }
 * | { type:'roundStarted', round:number }
 * | { type:'turnStarted', seat:number }
 * | { type:'turnSkipped', seat:number }
 * | { type:'diceRolled', seat:number, value:number, dice:number[] }     // value = total movement (dice.length 1, or 2 with doubleDice)
 * | { type:'moved', seat:number, path:string[] }                       // space ids walked, excluding the start space, including the final one; may end early at a star/path prompt
 * | { type:'teleported', seat:number, from:string, to:string }
 * | { type:'coinsChanged', seat:number, delta:number, total:number, reason:('space'|'minigame'|'duel'|'shop'|'steal'|'trap'|'event'|'star') }
 * | { type:'starBought', seat:number, price:number, total:number, newStarSpaceId:string }
 * | { type:'itemBought', seat:number, item:ItemId, price:number }
 * | { type:'itemUsed', seat:number, item:ItemId, targetSeat?:number, spaceId?:string }
 * | { type:'trapTriggered', spaceId:string, ownerSeat:number, victimSeat:number }
 * | { type:'eventSpace', seat:number, eventId:string, banner:string, lineId?:string, sfx?:string, effects:EventEffect[] }
 * | { type:'duelStart', seats:[number, number] }
 * | { type:'endspurtStarted' }
 * | { type:'minigameStart', minigame:MinigameDescriptor }               // intro begins
 * | { type:'minigameResults', results:MinigameResults, coinDelta:Object<string,number> }
 * | { type:'victory', seat:number }
 * )} GameEvent */

/** @typedef {{ state:GameState, events:GameEvent[], error:(string|null) }} ApplyResult   error is an ERR code; on error state is the unchanged input and events is [] */

/** `src/core/index.js` exports EXACTLY these (pure, no DOM, no Date/Math.random inside rules -- all randomness from state.rng; never mutates inputs):
 *  @typedef {{
 *    createGame(o:{ gameId:string, hostPlayerId:string, hostProfile:PlayerProfile, seed:number, starTarget?:number, boardId?:BoardId, forceMinigame?:(string|null), availableMinigames?:string[] }): GameState,
 *        // phase 'lobby', seat 0 = host, rev 0, rules from core constants, defaults starTarget STAR_TARGET.default, boardId 'spaeti'.
 *        // availableMinigames: ids not in MINIGAMES are dropped; missing/empty => all of MINIGAMES (stored as settings.availableMinigames = null).
 *    applyIntent(state:GameState, actor:number, intent:Intent): ApplyResult,   // actor = seat index or HOST_SEAT
 *    botIntent(state:GameState, seat:number): (PlayerIntent|null),
 *        // the intent a sensible bot would send NOW for `seat` (roll, random path, buy star when affordable, sometimes buy/use items, ready; in the lobby: setReady{ready:true} for a not-ready non-host seat); null if that seat has nothing to do.
 *        // Pure (derives its own randomness from state.rng WITHOUT advancing it). Used by: ?bot tabs for their own seat; the host driver for absent seats; tools/sim.mjs.
 *    pickMinigame(o:{ seats:number[], purpose:('round'|'duel'), forceId:(string|null), recent:string[], rng:Rng, allowed?:string[] }): (MinigameDescriptor|null),
 *        // table-driven from MINIGAMES. duel => solo kind, exactly 2 seats. team only if isTeamGameAllowed(seats.length) (teams shuffled, equal size). forceId honoured only if legal for this count AND in `allowed`. avoids `recent`.
 *        // `allowed` (core passes state.settings.availableMinigames) restricts candidates; null/missing/empty = no restriction. Fallbacks: forget `recent` (oldest first, finally all);
 *        // if nothing allowed is legal for this count/purpose it returns null and core skips that minigame (round: next round starts; duel: no duelStart, turn goes on).
 *    isTeamGameAllowed(playerCount:number): boolean,                         // same function as exported here
 *    serialize(state:GameState): string,                                     // JSON.stringify(state)
 *    deserialize(json:string): (GameState|null),                             // null on bad JSON / wrong version
 *    resumeGame(state:GameState, hostPlayerId:string): GameState,            // host reopened: every seat except the host's -> connected:false; phase 'minigame' -> 'minigameIntro' (ready=[]); rev+1
 *    registerBoard(def:BoardDef): void, getBoard(id:string): BoardDef,
 *  }} CoreApi */

// ===== 7. Net: messages, transport, session  [net (implements), main/ui/board/runner (use)] =====
// Topology: Trystero is a full mesh with no host concept. Host-ness is app level: the browser that CREATED the game (KEYS.host === its playerId)
// runs with isHost:true and announces it in `hello`. gameId is the room id. A reopened host tab recognises itself through that flag and
// resumes from KEYS.save. Clients never migrate.

/** Wire messages. Trystero action name === type string (all <= 32 bytes). Payloads are JSON. The net layer stamps `from` (sender playerId)
 *  on delivery from its own peerId->playerId table (built from `hello`); receivers NEVER read a seat/playerId out of a payload.
 *  type       dir                 cadence / when                       payload
 *  hello      any -> each peer    once per connection (on peer join; host re-sends to a peer that rejoined)
 *                                                                      { protocol:number, playerId, profile:PlayerProfile, isHost:boolean, isBot:boolean }
 *  reject     host -> one         answer to a refused seatJoin         { reason:'full'|'started'|'protocol' }   (ui shows German message, session stays open)
 *  intent     client -> host      user action                          { intent:PlayerIntent }
 *  state      host -> all(+self)  after EVERY applyIntent that changed state, and to a newly (re)joined peer alone with events:[]
 *                                                                      { rev:number, state:GameState, events:GameEvent[] }   (FULL snapshots, no patches: <= 6 players, a few KB)
 *  mgInput    client -> host      arena/team only, 30 Hz               InputFrame & { seq:number }    (see section 8; host keeps only the latest per seat)
 *  mgProgress any -> all          solo only, 10 Hz                     { t:number /*ms since go*\/, p:Json /*module-defined, enough to draw a thumbnail, <= ~200 bytes*\/ }
 *  mgFinal    any -> all          solo, once when the lane is done     { score:number /*higher wins*\/, label?:string /*e.g. "12,4 s"*\/ }
 *  mgState    host -> all(+self)  arena/team only, 20 Hz               { t:number /*host sim ms*\/, s:Json /*the module's mgState, see section 10*\/ }   (+ an immediate extra one when mg.iid changed, see section 10)
 *  mgOwn      client -> host      arena/team OWNER modules only, 30 Hz  { seq:number, s:Json /*inst.ownState()*\/ }   (REPLACES mgInput for that client; host keeps the latest per seat, derives the seat from `from`)
 */
export const MSG = en('hello', 'reject', 'intent', 'state', 'mgInput', 'mgProgress', 'mgFinal', 'mgState', 'mgOwn');
/** Session-level events (not on the wire). Same `session.on(name, handler)` as messages, so names never collide with MSG. */
export const SESSION_EVENT = en('peerJoin', 'peerLeave', 'hostGone', 'hostBack', 'error');

/** @typedef {{ playerId:string, profile:PlayerProfile, isHost:boolean, isBot:boolean, pingMs:(number|null) }} PeerInfo */

/** Low level link, one per transport. src/net/transports/{trystero,local}.js each export `createTransport(gameId) => Transport`.
 *  Trystero: `joinRoom({appId:APP_ID}, gameId)` (Nostr strategy = package default, trystero@0.26.0), one makeAction(type) per MSG type.
 *  Local: BroadcastChannel(`wk:${gameId}`) with its own random selfId, announce/ack on open for peer join, 1 s heartbeat + `bye` on pagehide for peer leave, ping = round trip.
 *  Both MUST behave alike: onPeerJoin also fires for peers already present; messages never loop back to the sender.
 *  @typedef {{
 *    selfId:string,
 *    send(type:string, data:Json, targetPeerId?:string): void,                // no target => all peers
 *    onMessage(type:string, handler:(data:Json, peerId:string) => void): void,
 *    onPeerJoin(handler:(peerId:string) => void): void,
 *    onPeerLeave(handler:(peerId:string) => void): void,
 *    ping(peerId:string): Promise<number>,
 *    leave(): void,
 *  }} Transport */

/** @typedef {null|boolean|number|string|Json[]|{[k:string]:Json}} Json */

/** `src/net/index.js` exports `createSession(o)` + IdentityApi helpers (section 3) + re-exports of makeGameId/parseGameIdFromHash/buildInviteLink.
 *  createSession returns synchronously; connecting is async. The caller (main.js) decides isHost via isHostOf(). Per connection the session
 *  sends `hello` to every peer; peers answer with their own hello, so everybody learns everybody (incl. who isHost) without an extra protocol.
 *  HOST GONE/BACK: the peer that announced isHost:true leaves => emit hostGone (clients show "Host ist weg — warte…"); a hello with isHost:true
 *  arrives (again) => emit hostBack and re-send our own hello to it (so the host can seatJoin us with our playerId). A host tab that reopens simply
 *  re-hellos everyone. SEAT REMAP: net does NOT know seats. Host side: each hello'd peer raises `peerJoin` -> driver applies seatJoin (known playerId => same seat back).
 *  @typedef {{
 *    gameId:string, transport:('trystero'|'local'), selfPlayerId:string, isHost:boolean,
 *    hostPlayerId(): (string|null),                                   // null while the host is absent (clients) / own id (host)
 *    peers(): PeerInfo[],                                             // other hello'd peers, not self
 *    sendIntent(intent:PlayerIntent): void,                          // client -> host; on the host it loops back into its own on(MSG.intent) (from = selfPlayerId). No-op while host absent.
 *    send(type:string, data:Json, toPlayerId:string): void,
 *    sendToHost(type:string, data:Json): void,
 *    broadcast(type:string, data:Json, opts?:{ self?:boolean }): void,// all other peers; self:true also delivers to own handlers (async, microtask), `from` = selfPlayerId
 *    on(type:string, handler:(data:any, fromPlayerId:string) => void): () => void,   // MSG type or SESSION_EVENT name; returns unsubscribe. Session events: peerJoin(PeerInfo) peerLeave({playerId}) hostGone({}) hostBack({playerId}) error({message})
 *    ping(playerId:string): Promise<number>,                          // ms round trip
 *    leave(): void,
 *  }} Session
 *  createSession options:
 *  @typedef {{ gameId:string, transport:('trystero'|'local'), profile:PlayerProfile, playerId:string, isHost:boolean, isBot?:boolean }} SessionOptions
 *  const createSession: (o:SessionOptions) => Session */

// ===== 8. Input  [input (implements), board/minigames/ui/runner (use)] =====
// One shared Input instance, created by main.js: `createInput({ target = window })`, passed to everything. Modules NEVER read raw keys/pads (D5).
// Edges are computed in update(): call `input.update()` EXACTLY ONCE per frame (main.js, start of frame, before screens read). Gamepads are re-read from
// navigator.getGamepads() on every update() (so Playwright can stub it). Keyboard events from <input>/<textarea>/<select> targets are ignored;
// preventDefault on Space/arrows when the canvas page has focus; window blur clears all held keys.
//
// MAPPING (a physical control may feed several actions; never assume exclusivity)
//   move     keyboard WASD + arrow keys  | gamepad left stick (radial deadzone 0.25, rescaled) + D-pad     -> {x,y} each -1..1, length clamped to 1 (diagonals normalised)
//   jump     keyboard Space              | gamepad A (button 0)
//   action   keyboard E, Shift           | gamepad X (button 2), Y (button 3)
//   confirm  keyboard Enter, Space       | gamepad A (button 0)
//   back     keyboard Escape, Backspace (menus/lobby/board); Q, Backspace in minigames (Escape ignored there) | gamepad B (button 1)
// Standard-mapping pads only (Xbox/PlayStation/generic report 'standard'); all connected pads are merged.

export const ACTIONS = en('move', 'jump', 'action', 'confirm', 'back');
/** @typedef {{ move:{x:number, y:number}, jump:boolean, action:boolean, confirm:boolean, back:boolean }} InputState   what is held right now */
/** @typedef {InputState & { pressed:{ jump:boolean, action:boolean, confirm:boolean, back:boolean } }} InputFrame
 *  `pressed` = any press since the previous takeFrame() (latched, so a 20 ms tap survives a 33 ms send interval). */
/** @typedef {'up'|'down'|'left'|'right'|'confirm'|'back'} NavEvent   menu navigation; directions auto-repeat (TIMING.NAV_REPEAT); fired from update() */
/** @typedef {{
 *   state: InputState,                                  // value after the latest update() (physical device OR-ed with injected)
 *   update(): void,
 *   pressed(a:('jump'|'action'|'confirm'|'back')): boolean,   // true only on the frame it went down
 *   released(a:('jump'|'action'|'confirm'|'back')): boolean,
 *   pressedDir(d:('up'|'down'|'left'|'right')): boolean,     // edge of `move` crossing |axis| > 0.5 (for tap-direction games)
 *   takeFrame(): InputFrame,                            // runner calls at CLIENT_INPUT_HZ for mgInput
 *   onNav(handler:(n:NavEvent) => void): () => void,    // returns unsubscribe
 *   inject(partial:(Partial<InputState>|null)): void,   // synthetic input for ?bot and tests: booleans OR-ed with devices, `move` replaces device move when given; null clears
 *   destroy(): void,
 * }} Input */

// ===== 9. Audio  [audio (implements), board/minigames/ui (use)] =====
// `src/audio/index.js` is a singleton module (import * as audio from '../audio/index.js'); minigames receive the same namespace as ctx.audio.
// Everything is a safe no-op before unlock, when muted, in node, or with an unknown id (warn once, never throw). Audio unlocks on the first user gesture
// (pointerdown / keydown / gamepad button) -- initAudio() installs those listeners; call it once at startup.
// D9 content rules: NO ApoRed anything. Drachenlord = the single quote in `forza`, no depiction/imitation/house/hater content. No jokes about TimGiOh's
// illness/appearance (the "Monte man, yes!" line is fine). Avatars/art never depict real people.

export const SFX = Object.freeze([
  'menuMove', 'menuSelect', 'menuBack', 'error', 'join', 'ready',                 // ui
  'diceRoll', 'diceLand', 'step', 'coinGain', 'coinLoss', 'star', 'buy', 'item', 'trap', 'duel', 'endspurt', 'whoosh', // board
  'tick', 'go', 'win', 'lose', 'fanfare',                                         // countdown / results (tick = 3-2-1 beat, go = start horn)
  'jump', 'bump', 'mash', 'splat', 'stamp', 'jam', 'boing', 'bahnDing',           // minigames / bahnhof announcement jingle
]);
export const MUSIC = en('lobby', 'board', 'minigame', 'victory');

/** Voice-line catalog: src/audio/lines.js exports `LINES: Object<LineId, string|string[]>` (array = random variant). Texts are German. These ids MUST exist
 *  (others may be added by audio); other modules reference only ids from this list. FIXED_LINES texts are verbatim and must not be altered. */
export const LINE_IDS = Object.freeze([
  'endspurt',       // announcer when Endspurt starts: coin spaces double
  'forza',          // Forza minigame start (FIXED)
  'monteYes',       // big win / star (FIXED)
  'dasCrazy',       // bad luck, red space, trap (FIXED)
  'aura',           // aura minigame / lucky moments (FIXED)
  'mittwoch',       // easter egg, e.g. when a round starts on a real Wednesday (FIXED)
  'yallah',         // game start / turn nag (FIXED)
  'sybau',          // someone gets robbed
  'starBought', 'duel', 'yourTurn', 'rollDice', 'coinsLost', 'trapTriggered', 'shopWelcome', 'noMoney',
  'minigameGo', 'winner', 'zugFaelltAus', 'schienenersatz', 'jam' /* "Leergut wird nicht angenommen" */,
]);
export const FIXED_LINES = freeze({
  forza: 'So Leute, Forza ist fertig heruntergeladen',
  monteYes: 'Monte man, yes!',
  dasCrazy: 'Das crazy!',
  aura: 'Aura!',
  mittwoch: 'Es ist Mittwoch, meine Kerle!',
  yallah: 'Was geht, yallah?',
});

/** @typedef {typeof SFX[number]} SfxName */
/** @typedef {'lobby'|'board'|'minigame'|'victory'} MusicTrack */
/** @typedef {{
 *   initAudio(): void,
 *   sfx(name:SfxName, opts?:{ volume?:number /*0..1*\/, rate?:number /*pitch multiplier, 1 = normal*\/ }): void,
 *   music(track:(MusicTrack|null)): void,                       // crossfades; null stops; same track again = no restart
 *   say(lineIdOrText:string, opts?:{ rate?:number, pitch?:number, interrupt?:boolean }): void,
 *       // LINES id or raw German text. Plays a pre-rendered clip (public/voice/*.ogg, Piper, tools/voice) when one exists for that exact text, else silent;
 *       // ALWAYS also calls the onCaption handlers (the UI shows a caption bubble, which is the no-voice fallback). Free text is fine.
 *   onCaption(handler:(text:string) => void): () => void,
 *   setMuted(m:boolean): void, isMuted(): boolean, toggleMuted(): boolean,   // persisted in KEYS.muted; mutes sfx+music+speech immediately
 *   setMasterVolume(v:number): void, getMasterVolume(): number,  // 0..1, persisted in KEYS.volume (default 0.7); mute wins over it
 * }} AudioApi */

// ===== 10. Minigame module + runner  [minigames (implement), core (reads MINIGAMES), main (mounts runner)] =====
// `src/minigames/<id>/index.js` default-exports a MinigameModule. `src/minigames/index.js` exports `getMinigame(id)` (sync) and `listMinigames()` built
// from `import.meta.glob('./*/index.js', {eager:true})`. kind/min/max are NOT declared by modules (MINIGAMES table above is the truth).
//
// KAPLAY OWNERSHIP: main.js creates ONE Kaplay instance (global:false, SCREEN size, letterbox) and passes `k` to everything. Nobody else calls kaplay().
// Every instance draws inside its own `root` game object (provided in ctx); use root.add / root.onUpdate (not k.onUpdate) so destroying root removes
// everything. destroy() must also stop anything not tied to root (timers via root.wait/loop, audio loops). Restore camera if you touched it.
//
// SOLO (kind 'solo'; also duels): every client runs the SAME deterministic lane from ctx.seed locally (use ctx.rng, not Math.random, for anything that affects play).
//   The main instance calls ctx.sendProgress(p) whenever p changes (runner throttles to SOLO_PROGRESS_HZ) and ctx.finish({score,label}) exactly once when done
//   (at the latest durationMs after go()). Higher score wins (negate times; round floats so ties are real ties). Others' progress is shown by the runner mounting
//   one extra instance per other seat with view:'thumb' and calling thumb.update(p) with their latest `p` (D7). Thumb instances are non-interactive, send nothing.
//   Host side needs nothing: runner ranks the received mgFinal scores with placementsFromScores; seats without a final (disconnected) tie for last.
// ARENA/TEAM: host simulates. Runner (host) calls hostInit once at go, then hostStep at fixed dt (HOST_SIM_HZ) with the LATEST InputFrame per seat
//   (frame.pressed edges are consumed: runner clears them after each step), broadcasts mgState at HOST_STATE_HZ, and ends when mgState.done is true or at
//   COUNTDOWN_MS+durationMs+MG_GRACE_MS hard cap, then calls hostResult. Clients (view 'main' only, no thumbs) get instance.update(mgState) per message and
//   interpolate in their own root.onUpdate. By default clients do not send input themselves: the runner sends mgInput from input.takeFrame().
//   OWNER-AUTHORITATIVE MOVEMENT (optional, arena/team; so host lag does not delay a player's own body; friends' game, the host simply trusts the report):
//     A module opts in by exporting the pure `hostAdopt(mg, seat, report)` AND the instance exporting `ownState()`. The runner then sets ctx.owner = true on
//     the main instance of every participating human client (not host-run test-mode bots, not thumbs, not spectators; a `?bot` tab IS an owner) and that
//     client sends `mgOwn {seq, s: inst.ownState()}` at TIMING.OWN_STATE_HZ INSTEAD of mgInput (so discrete presses must travel as SERIAL counters inside
//     ownState, e.g. `dn` dash count, `jn` jacket count; the host sees a new serial and resolves the action at the reported position).
//     Host: before each sim batch the runner calls hostAdopt(hs, seat, latestReport) once per connected seat with a fresh, not yet applied report.
//     hostAdopt (use src/minigames/owner.js adoptFields) whitelists + clamps the owned fields, rejects NaN, sets p.ot = mg.t, and never writes host-owned fields.
//     hostStep treats a seat as owned while isOwned(p, mg.t) (p.ot within TIMING.OWN_STALE_MS): it skips the input-driven movement of that seat but keeps timers,
//     dead reckoning, clamps and ALL interactions. Non-owned seats (host bots, disconnected, stale) follow the normal input path.
//     The client runs the local sim itself (owner.js fixedStepper at 60 Hz) and treats the host snapshot as authoritative only for what the host owns.
//     IMPULSES (host-resolved hits on an owner's body): the host must not write the victim's kinematics directly. It calls owner.js pushImp(mg, q, seat, {kx, ky, st, dc}),
//     which appends `{i, s, kx, ky, st, dc}` to `mg.imp` (i = ++mg.iid, s = victim seat, kx/ky knockback velocity add, st = stun ms (max), dc = cancel dash), keeps
//     entries ~2 s of mg.t, sets the victim's `p.ia = i` and applies the same to the host copy. The runner flushes an extra mgState at once when mg.iid changed.
//     The victim's update(snap) applies entries with `s === own seat` and `i > lastImp` (owner.js takeImps), and reports `ack = <highest applied i>` in ownState().
//     Until `report.ack >= p.ia`, adoptFields ignores the kinematic fields of that report (they predate the hit), so the knockback is never overwritten.
//     On the first snapshot after (re)mount lastImp = the highest id seen (old impulses are not replayed). The remote players are drawn from a delayed buffer (src/minigames/interp.js).
//   mgState MUST be plain JSON (it is broadcast as-is, keep it small, positions rounded to 1 decimal), host-private (not saved), and MUST contain
//   `t:number` (sim ms since go, hostStep advances it) and `done:boolean`. hostStep may mutate and return the same object. Absent seats get a zero InputFrame.
//
// OWN CANVAS / 3D MINIGAMES (runner extras, see src/minigames/three3d.js for the full API doc):
//   * three.js is pinned in package.json and must only ever load lazily. NEVER `import ... from 'three'` statically in a file that src/minigames/<id>/index.js
//     reaches (the registry pulls every index.js into the MAIN bundle). Use `const t3 = await mount3D(ctx)` from '../three3d.js' (it does the dynamic import;
//     three then lands in its own chunk). `npm run build` must keep showing three only in a separate chunk.
//   * clientMount must still return its instance synchronously: `const inst = { go, update, botInput, destroy }; mount3D(ctx).then((t3) => {...build scene...}).catch(fallback);
//     return inst;`. Export `preload: () => preload3D()` on the module (optional field; runner calls it during the intro so the chunk is cached by go()).
//   * mount3D puts a WebGL <canvas> exactly over the lane (ctx.rect) of the letterboxed Kaplay canvas: HiDPI (DPR cap 2), resize, pointer-events none, above Kaplay,
//     below the DOM UI. Input still comes ONLY from ctx.input. HUD text: t3.label(...) on the DOM overlay (Kaplay text below the canvas is hidden). The runner mirrors
//     its countdown and caption onto that overlay.
//   * ONLY view 'main' may create a WebGL context (mount3D throws for 'thumb'). Thumbnails draw a cheap 2D Kaplay progress picture driven by update(p).
//   * Lifecycle: the runner destroys the canvas for you (ctx.onEnd hook registered by mount3D) when the minigame ends, on results, on leaving and on remount; t3.destroy()
//     is idempotent, call it from instance.destroy() too. Dispose what you create outside scene graph traversal (render targets, loaders' textures) yourself.
//   * Any other module may bring its own DOM canvas the same way with ctx.rect / ctx.alive() / ctx.onEnd(fn) / ctx.mirrorHud(fn) (all documented on MinigameCtx).
//
// VOICE LINES (D22, D34): each game keeps its German lines in `src/minigames/<id>/lines.js`. PURE DATA, NO IMPORTS (a node script scans it to pre-render the clips):
//     export default { start: ['Los geht\'s, Taube!', 'Flatter!'], hit: ['Autsch!'], win: ['Du bist die Taube!'], lose: ['Pfui.'] };
//   = one default-exported plain object, each value an ARRAY OF STRINGS (German, short: <= ~60 chars, one sentence each, no placeholders/interpolation: every
//   string is rendered to an audio clip as-is). Keys are free; use `start`, `win`, `lose` where they apply. Play with `ctx.audio.say(pick(lines.hit))`; pick with
//   ctx.rng ONLY if it affects play, else Math.random is fine. say() always shows a caption, a clip only plays when `tools/voice` pre-rendered that exact text
//   (the voice pass worker adds the clips), so just write lines and call say. Do not spam: rate-limit in your game (a few lines per run).
//   Minigame workers NEVER edit src/audio, src/contracts.js, tests/e2e/helpers.js or src/minigames/runner.js (D34); ask the lead.
//
// CONTROL HINTS: tokens `{A} {B} {X} {Y} {LS} {DPAD} {key:Label}` (rendered as pad buttons / key caps; see src/ui/glyphs.js); a double space makes a wider gap.
//   e.g. '{key:Enter} / {key:Leertaste} / {A} Download stoppen'. Plain text still works but looks unfinished.

/** @typedef {{ placements:number[][], labels?:Object<string,string>, void?:boolean }} MinigameResults
 *  placements = groups of seat indices, BEST FIRST; seats in one group tie; every participant appears exactly once. Solo/FFA: [[2],[0,3],[1]].
 *  Team: one group per team, best first ([[0,2],[1,3]], or a draw [[0,1,2,3]]). labels = optional per-seat result text for the results screen ("12,4 s").
 *  void:true = the minigame BROKE (module threw, never started, timed out): nobody wins. core pays NO coins, moves no duel stake and counts no mgWins
 *  (the minigameResults event still fires, coinDelta all 0). Set only by src/minigames/runner.js; a genuine tie is a normal one-group placement WITHOUT void. */

/** @typedef {{ seat:number, name:string, color:string, hat:string, index:number }} SeatSummary  alias of Seat.profile + index, for rendering */

/** @typedef {{
 *   k:any, root:any,   // k = the shared Kaplay instance; root = game object to parent everything under (origin = top-left of the logical viewport)
 *   view:('main'|'thumb'),
 *   seat:number,                       // main: the local player's seat. thumb: the OTHER player this thumbnail shows.
 *   selfSeat:number,                   // always the local player's seat
 *   seats:Seat[],                      // participants only
 *   mode:Mode, teams:(number[][]|null),
 *   seed:number, rng:Rng,              // createRng(seed): identical sequence for every client; each instance gets its own fresh copy
 *   logical:{ w:number, h:number },    // = MG_VIEW[kind]; draw inside it; runner scales root for thumbnails
 *   input:Input, audio:AudioApi,
 *   addAvatar(profile:PlayerProfile, opts?:{ size?:number, showName?:boolean, parent?:any }): any,   // goofy blob (D17), implemented in src/avatar/index.js
 *   sendProgress(p:Json): void, finish(r:{ score:number, label?:string }): void,                       // solo main only; no-ops otherwise
 *   isBot:boolean,
 *   owner:boolean,                     // arena/team main instance of a human participant in a module with hostAdopt: this client simulates its own body and reports it via ownState() (section 10). False for thumbs, spectators, host-run test bots.
 *   // runner extras (beyond the core fields above):
 *   spectator:boolean, durationMs:number,
 *   rect:{ x:number, y:number, w:number, h:number },   // this lane on the SCREEN (SCREEN.w x SCREEN.h px): solo main = left lane (scaled 0.8 with >3 opponents), thumb = its thumbnail, arena = full
 *   alive():boolean,                                  // false once the stage this instance belongs to was torn down (use after any await)
 *   onEnd(fn:() => void): void,                       // fn runs when the stage ends (minigame over / results / leave), just before instance.destroy(); runs at once if it already ended
 *   mirrorHud(fn:(h:{ countdown:({ text:string, color:string, opacity:number, scale:number }|null), caption:string }) => void): void,   // main view only: the runner's 3-2-1 and "Fertig" caption, pushed on change, for modules whose own canvas covers the Kaplay one
 * }} MinigameCtx */

/** @typedef {{
 *   go(): void,                        // countdown finished: start simulating/accepting input (before that: draw the scene frozen). Ignored by thumbs.
 *   update(data:Json): void,           // thumb: that seat's latest progress `p`. arena/team main: latest host mgState. solo main: never called.
 *   botInput(): Partial<InputState>,   // ?bot: sensible input NOW (runner injects it every frame via input.inject). Reads the instance's own sim/snapshot. Not required on thumbs.
 *   ownState?(): Json,                 // owner modules only (ctx.owner): the report the runner sends as `mgOwn.s` at OWN_STATE_HZ: owned kinematic fields (rounded), discrete-action serial counters, `ack`. Must be small plain JSON.
 *   destroy(): void,
 * }} MinigameInstance */

/** @typedef {{
 *   id:string,                         // one of MINIGAME_IDS
 *   name:string,                       // German title
 *   instructions:string,               // German, 1-3 short sentences shown during minigameIntro
 *   controlHints:string[],             // German, with button tokens, e.g. ['{key:Enter} / {key:Leertaste} / {A} Download stoppen'] (see CONTROL HINTS below)
 *   durationMs:number,                 // play time after go()
 *   clientMount(ctx:MinigameCtx): MinigameInstance,   // sync; 3D games load async inside, see OWN CANVAS above
 *   preload?(): (void|Promise<any>),                  // optional: runner calls it during the intro for participants (3D games: () => preload3D())
 *   hostInit?(o:{ seats:number[], seed:number, rng:Rng, mode:Mode, teams:(number[][]|null) }): ArenaState,   // arena/team only
 *   hostStep?(mg:ArenaState, inputsBySeat:Object<string,InputFrame>, dtMs:number): ArenaState,               // arena/team only
 *   hostResult?(mg:ArenaState): MinigameResults,                                                             // arena/team only
 *   hostAdopt?(mg:ArenaState, seat:number, report:Json): void,   // optional, arena/team: opt in to owner-authoritative movement (pure; apply the seat's ownState report to mg, see section 10 and owner.js adoptFields)
 * }} MinigameModule */
/** @typedef {{ t:number, done:boolean, [k:string]:Json }} ArenaState */

/** Per-minigame tests: tests/e2e/<id>.spec.js forces it with `?mg=<id>&bot`. */

// ===== 11. Screens & main.js host driver  [main (wires), board + runner (screens), ui (DOM)] =====
// LAYERS: <canvas> (Kaplay: board + minigames) with a DOM overlay (#ui, pointer-events:none except widgets) above it. src/ui = ONLY DOM: title,
// profile editor, create/join, lobby, HUD strip (coins/stars/items/turn), "Host ist weg — warte…" banner, toasts, caption bubble, victory. src/board and
// src/minigames = ONLY Kaplay. HUD during minigames is not shown.
//
// Screens implemented by board and runner share one interface; main.js mounts/destroys them by phase:
//   lobby -> ui lobby | boardTurn -> board | minigameIntro/minigame/minigameResults -> runner | victory -> ui victory (board may stay mounted behind)
//   A screen is mounted on first matching state and destroyed when the phase leaves its set. Board is remounted after minigames and renders from state only.
//   main.js feeds every `state` message (host: via broadcast self:true, so host and clients share ONE code path) to the mounted screens.
/** @typedef {{ onState(state:GameState, events:GameEvent[]): void, destroy(): void }} Screen */
/** src/board/index.js: `mountBoard(o:{ k, session:Session, input:Input, audio:AudioApi, debug:ReturnType<typeof parseDebugParams> }): Screen`, `BOARDS: BoardDef[]`.
 *    Board draws spaces/tokens/star/traps, dice, walking, camera; handles the local player's prompts (roll/useItem/choosePath/buyStar/buyItem) with
 *    input confirm/back/move by sending PlayerIntents via session.sendIntent; plays sfx/say in response to GameEvents (core never touches audio).
 *    Local seat = seatIndexOf(state, session.selfPlayerId). Players it is not waiting for get no prompts.
 *  src/minigames/runner.js: `createMinigameRunner(o:{ k, session:Session, input:Input, audio:AudioApi, debug, onHostResults:(r:MinigameResults) => void }): Screen`.
 *    Runner owns: instructions/controls screen + `ready` (confirm key sends PlayerIntent ready), 3-2-1 countdown (TIMING.COUNTDOWN_MS) then instance.go(),
 *    solo split view (main + thumbs), mgInput/mgProgress/mgFinal/mgState plumbing at the TIMING rates, host sim loop (when session.isHost), results overlay
 *    (placements + labels + state.minigame.coinDelta), ?bot injection (instance.botInput()). On host it calls onHostResults(results) exactly once per minigame.
 *  src/avatar/index.js: `addAvatar(k, parent, profile:PlayerProfile, opts?:{ size?:number, showName?:boolean }): GameObj` (goofy blob: colour, hat, name). Shared by board + minigames. */

/** HOST DRIVER (src/main.js, host tab only). Normative loop -- core stays pure, so ALL time and IO lives here:
 *  boot:   gameId = parseGameIdFromHash(location.hash); debug = parseDebugParams(location.search); id = loadIdentity(debug.pid);
 *          isHost = isHostOf(gameId, id.playerId, debug.pid). Host: json = loadSave(...); state = json ? resumeGame(deserialize(json), id.playerId)
 *          : createGame({ gameId, hostPlayerId, hostProfile, seed: debug.seed ?? random u32, starTarget: debug.stars ?? default, forceMinigame: debug.mg });
 *          session = createSession({ gameId, transport: debug.local ? 'local' : 'trystero', profile, playerId, isHost, isBot: debug.bot }).
 *          Registers every board (BOARDS -> core.registerBoard) before createGame/deserialize use it.
 *  apply(actor, intent): r = core.applyIntent(state, actor, intent); if r.error -> (if from a peer) session.send(MSG.reject / ignore), stop;
 *          else state = r.state; storeSave(gameId, serialize(state)); session.broadcast(MSG.state, { rev: state.rev, state, events: r.events }, { self: true }).
 *  inbound: on(MSG.intent, (m, from)) -> seat = seatIndexOf(state, from); seat < 0 ? ignore : apply(seat, m.intent).
 *           on(SESSION_EVENT.peerJoin, peer) -> protocol mismatch => reject 'protocol'; apply(HOST_SEAT, seatJoin{...}); on ERR.full/started => session.send(reject);
 *           else send that peer the current state alone (events []). on(peerLeave) -> apply(HOST_SEAT, seatPresence{seat, connected:false}).
 *  timers: AUTOPLAY: when phase boardTurn and seats[turn.seat].connected is false (or minigameIntro with absent participants), after AUTOPLAY_DELAY_MS
 *          apply(seat, botIntent(state, seat)). minigameIntro: INTRO_MAX_MS then apply(HOST_SEAT, advance). minigameResults: RESULTS_MS then advance.
 *          Minigame end: runner.onHostResults(r) -> apply(HOST_SEAT, minigameDone{results:r}). Host tab must stay visible while an arena game runs (timers throttle).
 *  bot tabs (debug.bot, host or client): on each new state rev, delay BOT_DELAY_MS, intent = botIntent(state, selfSeat); if non-null session.sendIntent(intent) (once per rev).
 *  client: apply `state` messages only if rev > last; show "Host ist weg — warte…" between hostGone and hostBack; on reject show German reason on the title/lobby screen.
 *  reload: a client reload re-runs boot with the same playerId and hellos -> host seatJoin(known) -> same seat; a host reload resumes from the save (all clients re-hello on hostBack). */
