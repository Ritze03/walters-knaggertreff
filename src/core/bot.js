import { createRng, MAX_ITEMS } from '../contracts.js';
import { BOT } from './rules.js';
import { getBoard } from './boards.js';

/** BFS over Space.next: Map(spaceId -> steps) from `from` */
function distances(board, from) {
  const byId = new Map(board.spaces.map((s) => [s.id, s]));
  const dist = new Map([[from, 0]]);
  const q = [from];
  for (let i = 0; i < q.length; i++) {
    for (const n of byId.get(q[i]).next) if (!dist.has(n)) { dist.set(n, dist.get(q[i]) + 1); q.push(n); }
  }
  return dist;
}

/** trap space reachable by the most opponents within one roll (ties random); null if none */
function trapSpot(state, seat, board, rng) {
  const count = new Map();
  state.players.forEach((p, i) => {
    if (i === seat) return;
    for (const [id, d] of distances(board, p.spaceId)) if (d >= 1 && d <= state.rules.dieMax) count.set(id, (count.get(id) ?? 0) + 1);
  });
  const type = new Map(board.spaces.map((s) => [s.id, s.type]));
  const ok = [...count].filter(([id]) => type.get(id) !== 'start' && type.get(id) !== 'shop' && state.traps[id] === undefined);
  if (!ok.length) return null;
  const best = Math.max(...ok.map(([, n]) => n));
  return rng.pick(ok.filter(([, n]) => n === best))[0];
}

/**
 * The intent a sensible bot would send NOW for `seat`, or null. Pure: randomness is derived from (state.rng, seat, rev)
 * and state.rng is NOT advanced, so the same state always yields the same answer.
 */
export function botIntent(state, seat) {
  const rng = createRng((state.rng ^ Math.imul(seat + 1, 0x9E3779B1) ^ Math.imul(state.rev + 1, 0x85EBCA6B)) >>> 0);
  if (state.phase === 'minigameIntro') {
    const mg = state.minigame;
    return mg.seats.includes(seat) && !mg.ready.includes(seat) ? { type: 'ready' } : null;
  }
  if (state.phase !== 'boardTurn' || state.turn.seat !== seat) return null;
  const t = state.turn;
  const me = state.players[seat];
  const board = getBoard(state.settings.boardId);

  if (t.step === 'roll') {
    if (me.items.length && rng.next() < BOT.useItemChance) {
      const item = rng.pick(me.items);
      if (item === 'doubleDice' && !t.doubleDice) return { type: 'useItem', item };
      if (item === 'goldenDoener') return { type: 'useItem', item };
      if (item === 'steal') {
        const victims = state.players.map((p, i) => ({ i, coins: p.coins })).filter((v) => v.i !== seat && v.coins >= 3);
        if (victims.length) return { type: 'useItem', item, targetSeat: victims.sort((a, b) => b.coins - a.coins)[0].i };
      }
      if (item === 'trap') {
        const spaceId = trapSpot(state, seat, board, rng);
        if (spaceId) return { type: 'useItem', item, spaceId };
      }
    }
    return { type: 'roll' };
  }
  if (t.step === 'path') {
    const star = state.starSpaceId;
    const scored = t.options.map((id) => ({ id, d: distances(board, id).get(star) ?? Infinity }));
    const best = Math.min(...scored.map((s) => s.d));
    return { type: 'choosePath', spaceId: rng.pick(scored.filter((s) => s.d === best)).id };
  }
  if (t.step === 'star') return { type: 'buyStar', accept: me.coins >= state.rules.starPrice };
  if (t.step === 'shop') {
    const ok = t.offer.filter((o) => me.coins - o.price >= BOT.itemComfort);
    if (ok.length && me.items.length < MAX_ITEMS && rng.next() < BOT.buyItemChance) return { type: 'buyItem', item: rng.pick(ok).item };
    return { type: 'buyItem', item: null };
  }
  return null;
}
