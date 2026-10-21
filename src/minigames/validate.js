// Shape check for a minigame module (used by the registry and by registry.test.js). Pure.
import { MINIGAMES } from '../contracts.js';

/** @returns {string|null} a short problem description, or null when `mod` (default export of src/minigames/<folder>/index.js) is fine */
export function moduleProblem(mod, folder) {
  if (!mod || typeof mod !== 'object') return 'no default export';
  if (mod.id !== folder) return `id "${mod.id}" does not match the folder name "${folder}"`;
  if (!Object.hasOwn(MINIGAMES, mod.id)) return 'id is not in the MINIGAMES table (contracts.js)';
  if (typeof mod.name !== 'string' || !mod.name) return 'name missing';
  if (typeof mod.instructions !== 'string' || !mod.instructions) return 'instructions missing';
  if (!Array.isArray(mod.controlHints) || !mod.controlHints.length || mod.controlHints.some((h) => typeof h !== 'string')) return 'controlHints must be a non-empty string[]';
  if (!(mod.durationMs > 0)) return 'durationMs must be > 0';
  if (typeof mod.clientMount !== 'function') return 'clientMount missing';
  if (mod.hostAdopt !== undefined && typeof mod.hostAdopt !== 'function') return 'hostAdopt must be a function';
  if (MINIGAMES[mod.id].kind !== 'solo' && !(typeof mod.hostInit === 'function' && typeof mod.hostStep === 'function' && typeof mod.hostResult === 'function')) {
    return 'arena/team modules need hostInit, hostStep and hostResult';
  }
  return null;
}
