// Minigame registry. Adding a minigame = adding a folder `src/minigames/<id>/index.js` (default export = the module, see contracts section 10). Nothing else.
import { moduleProblem } from './validate.js';

let found = {};
// Vite replaces this call at build time; plain node has no import.meta.glob (the call throws, tests then simply see an empty registry).
try { found = import.meta.glob('./*/index.js', { eager: true }); } catch { found = {}; }

const byId = new Map();
for (const [path, m] of Object.entries(found)) {
  const problem = moduleProblem(m.default, path.split('/')[1]);
  if (problem) console.warn(`[minigames] ${path} ignored: ${problem}`);
  else byId.set(m.default.id, m.default);
}

/** @returns the module for `id`, or undefined */
export const getMinigame = (id) => byId.get(id);
/** @returns all valid modules (each has `.id`) */
export const listMinigames = () => [...byId.values()];
