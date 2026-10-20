import { validateBoard } from '../contracts.js';

const boards = new Map();

/** Validates and stores a board definition (replaces one with the same id). Throws listing the problems. */
export function registerBoard(def) {
  const problems = validateBoard(def);
  if (problems.length) throw new Error(`invalid board ${def?.id}: ${problems.join('; ')}`);
  boards.set(def.id, def);
}

export function getBoard(id) {
  const b = boards.get(id);
  if (!b) throw new Error(`board not registered: ${id}`);
  return b;
}

export const hasBoard = (id) => boards.has(id);
