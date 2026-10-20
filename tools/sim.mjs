// Balance simulator: plays bot-only games through the real core engine and prints pacing numbers.
//   npm run sim -- --players 4 --target 5 [--games 300] [--rounds 80] [--board spaeti|ring:LOOP:forks:starSpots] [--sec 130] [--max-duels N] [--json]
// Minigame results are random placements (no minigame code runs). Endspurt IS simulated (the game ends at `--target` stars).
import { applyIntent, botIntent, createGame, registerBoard } from '../src/core/index.js';
import { HOST_SEAT } from '../src/contracts.js';

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i < 0 ? dflt : (argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[i + 1]); };
const GAMES = +opt('games', 300), MAX_ROUNDS = +opt('rounds', 80), NP = +opt('players', 4), TARGET = +opt('target', 5);
const MAX_DUELS = opt('max-duels', null);   // override rules.maxDuelsPerRound (e.g. 99 = uncapped) to compare
const BOARD = String(opt('board', 'spaeti')), SEC_PER_ROUND = +opt('sec', 130), JSON_OUT = opt('json', false) === true;

/** generated ring board for "how long should a lap be" experiments: LOOP main spaces, `forks` 4-space detours, evenly spread star spots */
function ring(loop, forks, nStar) {
  const types = ['blue', 'blue', 'red', 'blue', 'event', 'blue', 'blue', 'red', 'shop', 'blue'];
  const ids = Array.from({ length: loop }, (_, i) => 'r' + i);
  const spaces = ids.map((id, i) => ({
    id, x: i, y: 0, next: [ids[(i + 1) % loop]],
    type: i === 0 ? 'start' : i % 10 === 5 ? 'shop' : (types[i % types.length] === 'event' || types[i % types.length] === 'shop') ? 'blue' : types[i % types.length],
  }));
  Array.from({ length: forks }, (_, k) => Math.floor((k + 0.5) * loop / forks) - 3).forEach((f, k) => {
    const det = [0, 1, 2, 3].map((j) => ({ id: `d${k}_${j}`, type: j === 3 ? 'red' : 'blue', x: 0, y: 0, next: [j < 3 ? `d${k}_${j + 1}` : ids[(f + 3) % loop]] }));
    spaces[f].next.push(det[0].id);
    spaces.push(...det);
  });
  const bump = (i) => (spaces[i].type === 'shop' || spaces[i].type === 'start' ? i + 1 : i);   // a star spot is never a shop
  const starSpaceIds = Array.from({ length: nStar }, (_, k) => ids[bump(1 + Math.floor((k + 0.5) * (loop - 1) / nStar))]);
  return { id: 'spaeti', name: 'ring', startSpaceId: 'r0', world: { w: 1, h: 1 }, spaces, starSpaceIds, events: {} };
}
let board, boardId = 'spaeti';
if (BOARD.startsWith('ring:')) { const [, l, f, s] = BOARD.split(':').map(Number); board = ring(l, f, s); }
else { board = (await import(`../src/board/boards/${BOARD}.js`)).default; boardId = board.id; }
registerBoard(board);
const mainLoop = BOARD.startsWith('ring:') ? +BOARD.split(':')[1] : null;

const prof = (i) => ({ name: 'B' + i, color: ['#e63946', '#2a9d8f', '#e9c46a', '#457b9d', '#9b5de5', '#f15bb5'][i], hat: 'none' });
const rnd = (n) => Math.floor(Math.random() * n);
const shuffled = (xs) => { const s = [...xs]; for (let i = s.length - 1; i > 0; i--) { const j = rnd(i + 1); [s[i], s[j]] = [s[j], s[i]]; } return s; };
const pct = (xs, q) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f1 = (x) => (Number.isFinite(x) ? +x.toFixed(1) : null);

function play() {
  let st = createGame({ gameId: 'sim', hostPlayerId: 'p0', hostProfile: prof(0), seed: (Math.random() * 2 ** 32) >>> 0, starTarget: TARGET, boardId });
  if (MAX_DUELS !== null) st = { ...st, rules: { ...st.rules, maxDuelsPerRound: +MAX_DUELS } };
  const ap = (actor, intent) => {
    const r = applyIntent(st, actor, intent);
    if (r.error) throw new Error(`${JSON.stringify(intent)} -> ${r.error}`);
    st = r.state;
    return r.events;
  };
  for (let i = 1; i < NP; i++) ap(HOST_SEAT, { type: 'seatJoin', playerId: 'p' + i, profile: prof(i), isBot: true });
  for (let i = 1; i < NP; i++) ap(i, { type: 'setReady', ready: true });
  ap(0, { type: 'startGame' });
  const rec = { src: {}, laps: 0, turns: 0, starPrompts: 0, duels: 0, duelsByRound: {}, firstTo: {}, leaderCoins: [], meanCoins: [], byRound: {}, finished: false, rounds: 0 };
  const onEvents = (evs) => {
    for (const e of evs) {
      if (e.type === 'coinsChanged') { const k = e.reason + (e.delta > 0 ? '+' : '-'); rec.src[k] = (rec.src[k] ?? 0) + e.delta; }
      else if (e.type === 'moved') rec.laps += e.path.filter((id) => id === board.startSpaceId).length;
      else if (e.type === 'duelStart') { rec.duels++; rec.duelsByRound[st.round] = (rec.duelsByRound[st.round] ?? 0) + 1; }
    }
    for (let th = 1; th <= TARGET; th++) if (rec.firstTo[th] === undefined && st.players.some((p) => p.stars >= th)) rec.firstTo[th] = st.round;
  };
  let guard = 0, lastRound = 0;
  while (st.round <= MAX_ROUNDS && st.phase !== 'victory' && guard++ < 400000) {
    if (st.round !== lastRound) {
      lastRound = st.round;
      if (st.round > 1) { rec.byRound[st.round] = [Math.max(...st.players.map((p) => p.coins)), Math.min(...st.players.map((p) => p.coins))]; }
      if (st.round > 1) { rec.leaderCoins.push(Math.max(...st.players.map((p) => p.coins))); rec.meanCoins.push(mean(st.players.map((p) => p.coins))); }
    }
    if (st.phase === 'boardTurn') {
      const seat = st.turn.seat;
      if (st.turn.step === 'roll' && st.turn.stepsLeft === 0) rec.turns++;
      if (st.turn.step === 'star') rec.starPrompts++;
      const it = botIntent(st, seat);
      if (!it) throw new Error('bot has no intent: ' + JSON.stringify(st.turn));
      onEvents(ap(seat, it));
    } else if (st.phase === 'minigameIntro') {
      let any = false;
      for (const s of st.minigame.seats) { const it = botIntent(st, s); if (it) { onEvents(ap(s, it)); any = true; } }
      if (!any) onEvents(ap(HOST_SEAT, { type: 'advance' }));
    } else if (st.phase === 'minigame') {
      onEvents(ap(HOST_SEAT, { type: 'minigameDone', results: { placements: shuffled(st.minigame.seats).map((x) => [x]) } }));
    } else if (st.phase === 'minigameResults') onEvents(ap(HOST_SEAT, { type: 'advance' }));
    else throw new Error('unexpected phase ' + st.phase);
  }
  rec.finished = st.phase === 'victory';
  rec.rounds = st.round;
  rec.winnerCoins = st.winner === null ? null : st.players[st.winner].coins;
  return rec;
}

const games = Array.from({ length: GAMES }, play);
const done = games.filter((g) => g.finished);
const totalRounds = games.reduce((a, g) => a + g.rounds, 0);
const toTarget = done.map((g) => g.rounds);
const firstTo = {};
for (let th = 1; th <= TARGET; th++) {
  const r = games.map((g) => g.firstTo[th]).filter((x) => x !== undefined);
  firstTo[th] = { reached: `${r.length}/${GAMES}`, p25: pct(r, 0.25), median: pct(r, 0.5), p75: pct(r, 0.75) };
}
const srcKeys = [...new Set(games.flatMap((g) => Object.keys(g.src)))].sort();
const duelRounds = {};
for (let r = 1; r <= 8; r++) duelRounds[r] = f1(games.reduce((a, g) => a + (g.duelsByRound[r] ?? 0), 0) / games.filter((g) => g.rounds >= r).length);
const laps = games.reduce((a, g) => a + g.laps, 0);
const out = {
  config: { board: BOARD, players: NP, target: TARGET, games: GAMES, secPerRound: SEC_PER_ROUND },
  finished: `${done.length}/${GAMES}`,
  roundsToTarget: { p25: pct(toTarget, 0.25), median: pct(toTarget, 0.5), p75: pct(toTarget, 0.75) },
  minutesToTarget: { p25: f1(pct(toTarget, 0.25) * SEC_PER_ROUND / 60), median: f1(pct(toTarget, 0.5) * SEC_PER_ROUND / 60), p75: f1(pct(toTarget, 0.75) * SEC_PER_ROUND / 60) },
  firstToStars: firstTo,
  coinsHeldAtRoundStart: { leaderMedian: pct(games.flatMap((g) => g.leaderCoins), 0.5), leaderP95: pct(games.flatMap((g) => g.leaderCoins), 0.95), meanPerPlayer: f1(mean(games.flatMap((g) => g.meanCoins))) },
  coinsByRound: Object.fromEntries([2, 4, 7, 10, 15, 20].map((r) => { const v = games.map((g) => g.byRound[r]).filter(Boolean); return [r, v.length ? `leader ${pct(v.map((x) => x[0]), 0.5)} / last ${pct(v.map((x) => x[1]), 0.5)}` : null]; })),
  winnerCoinsAtVictory: pct(done.map((g) => g.winnerCoins), 0.5),
  duelsPerRound: { overall: f1(games.reduce((a, g) => a + g.duels, 0) / totalRounds), byRound: duelRounds },
  roundsPerLap: f1(NP * totalRounds / laps),
  starPromptRatePerTurn: f1(100 * games.reduce((a, g) => a + g.starPrompts, 0) / games.reduce((a, g) => a + g.turns, 0)) + '%',
  coinsPerPlayerPerRound: Object.fromEntries(srcKeys.map((k) => [k, +(games.reduce((a, g) => a + (g.src[k] ?? 0), 0) / (NP * totalRounds)).toFixed(2)])),
  mainLoopSpaces: mainLoop ?? board.spaces.length + ' spaces total',
};
if (JSON_OUT) console.log(JSON.stringify(out, null, 1));
else {
  const o = out, rt = o.roundsToTarget, mt = o.minutesToTarget;
  console.log(`Sim: ${NP} players, target ${TARGET} stars, board ${BOARD}, ${GAMES} games (${o.finished} finished)`);
  console.log(`rounds to target   median ${rt.median}  (p25 ${rt.p25}, p75 ${rt.p75})`);
  console.log(`minutes @${SEC_PER_ROUND}s/round  median ${mt.median}  (p25 ${mt.p25}, p75 ${mt.p75})`);
  console.log('first to N stars (median round): ' + Object.entries(firstTo).map(([k, v]) => `${k}:${v.median}`).join('  '));
  console.log(`coins at round start: leader median ${o.coinsHeldAtRoundStart.leaderMedian}, leader p95 ${o.coinsHeldAtRoundStart.leaderP95}, mean/player ${o.coinsHeldAtRoundStart.meanPerPlayer}; winner at victory ${o.winnerCoinsAtVictory}`);
  console.log('coins at round start, median leader / last: ' + Object.entries(o.coinsByRound).filter(([, v]) => v).map(([r, v]) => `r${r} ${v}`).join('  |  '));
  console.log(`duels per round: ${o.duelsPerRound.overall} overall; by round ${JSON.stringify(duelRounds)}`);
  console.log(`rounds per lap (per player): ${o.roundsPerLap}; star prompt rate ${o.starPromptRatePerTurn} of turns`);
  console.log('coins/player/round by source: ' + JSON.stringify(o.coinsPerPlayerPerRound));
}
