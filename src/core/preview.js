import { getBoard } from './boards.js';

const byId = new WeakMap();
function spaceOf(board, id) {
  let m = byId.get(board);
  if (!m) { m = new Map(board.spaces.map((s) => [s.id, s])); byId.set(board, m); }
  return m.get(id);
}

/**
 * Where does a move end? Pure, same counting as the engine's walk(): the first step (`firstStepId`) already costs one step, every
 * further step follows `next[0]`, and the walk stops early when it stands on a fork with steps left (the player then has to choose
 * again). Star / shop prompts on the way do not change the step count (the walk simply resumes), so they are not modelled; neither are
 * trap and event-space effects (a warp event can still move the player after landing).
 *
 * @param {object} board  Board definition (contracts Board)
 * @param {string} fromId space the player stands on (the fork)
 * @param {string} firstStepId one of spaceOf(fromId).next
 * @param {number} steps  steps left INCLUDING the first one (state.turn.stepsLeft at the path prompt)
 * @returns {{ path: string[], end: string, landed: boolean, stepsLeft: number }}
 *   path = every space stepped onto, in order; end = last of them; landed = the move is over there;
 *   false = it stops at another fork (end) with stepsLeft > 0 and the player will be asked again.
 */
export function previewPath(board, fromId, firstStepId, steps) {
  const from = spaceOf(board, fromId);
  if (!from || !from.next.includes(firstStepId) || !(steps >= 1)) return { path: [], end: fromId, landed: true, stepsLeft: Math.max(0, steps | 0) };
  const path = [firstStepId];
  let left = steps - 1;
  let cur = spaceOf(board, firstStepId);
  while (left > 0) {
    if (cur.next.length > 1) return { path, end: cur.id, landed: false, stepsLeft: left };
    cur = spaceOf(board, cur.next[0]);
    path.push(cur.id);
    left--;
  }
  return { path, end: cur.id, landed: true, stepsLeft: 0 };
}

/** previewPath for the current path prompt: state.turn.step === 'path', `optionId` one of state.turn.options. Uses stepsLeft as rolled
 *  (a Goldener Doener / double dice only changes how many steps were rolled, never how they are counted). null when there is no prompt. */
export function previewLanding(state, optionId) {
  const t = state.turn;
  if (state.phase !== 'boardTurn' || !t || t.step !== 'path' || !t.options.includes(optionId)) return null;
  return previewPath(getBoard(state.settings.boardId), state.players[t.seat].spaceId, optionId, t.stepsLeft);
}
