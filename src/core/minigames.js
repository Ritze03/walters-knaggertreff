import { MINIGAMES, MINIGAME_IDS, isTeamGameAllowed } from '../contracts.js';

/** Is minigame `id` legal for this participant count / purpose? (table-driven from MINIGAMES) */
function legal(id, n, purpose) {
  const m = MINIGAMES[id];
  if (!m || n < m.min || n > m.max) return false;
  if (purpose === 'duel') return m.kind === 'solo';
  return m.kind !== 'team' || isTeamGameAllowed(n);
}

/**
 * Picks a minigame and builds its descriptor (ready:[], results:null, coinDelta:null).
 * duel => solo kind, exactly 2 seats. team kinds only for an even count >= 4. forceId wins when legal.
 * `recent` is avoided; if that would leave nothing, the oldest entries are forgotten first.
 */
export function pickMinigame({ seats, purpose, forceId, recent = [], rng }) {
  const sorted = [...seats].sort((a, b) => a - b);
  const n = sorted.length;
  if (purpose === 'duel' && n !== 2) throw new Error('duel needs exactly 2 seats');
  if (n < 2) throw new Error('minigame needs at least 2 seats');
  const all = MINIGAME_IDS.filter((id) => legal(id, n, purpose));
  let id = forceId && all.includes(forceId) ? forceId : null;
  if (!id) {
    let cands = all;
    for (let from = 0; from <= recent.length; from++) {
      cands = all.filter((c) => !recent.slice(from).includes(c));
      if (cands.length) break;
    }
    id = rng.pick(cands.length ? cands : all);
  }
  const kind = MINIGAMES[id].kind;
  let teams = null;
  if (kind === 'team') {
    const sh = rng.shuffle(sorted);
    const h = n / 2;
    teams = [sh.slice(0, h).sort((a, b) => a - b), sh.slice(h).sort((a, b) => a - b)];
  }
  const mode = purpose === 'duel' ? 'duel' : kind === 'team' ? 'team' : 'ffa';
  return { id, kind, mode, purpose, seats: sorted, teams, seed: rng.u32(), ready: [], results: null, coinDelta: null };
}
