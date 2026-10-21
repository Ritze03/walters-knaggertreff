// Collects every voice line that needs a pre-rendered clip: src/audio/lines.js (id = line id) and every src/minigames/*/lines.js
// (id = mg-<gameId>-<key>). Shared by generate.mjs and src/audio/lines.test.js. Pure node, no side effects.
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_RE = /^[a-z0-9]+$/, KEY_RE = /^[A-Za-z0-9_]+$/;

/** @returns {Promise<{id:string, n:number, text:string, source:string}[]>} core lines first, then minigames sorted by folder; throws on a malformed lines.js */
export async function collectLines(root = ROOT) {
  const out = [];
  const { LINES } = await import(pathToFileURL(join(root, 'src', 'audio', 'lines.js')).href);
  for (const [id, v] of Object.entries(LINES)) [].concat(v).forEach((text, n) => out.push({ id, n, text, source: `src/audio/lines.js ${id}` }));
  const mgDir = join(root, 'src', 'minigames');
  for (const game of readdirSync(mgDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const file = join(mgDir, game, 'lines.js');
    if (!existsSync(file)) continue;
    const src = `src/minigames/${game}/lines.js`;
    if (!GAME_RE.test(game)) throw new Error(`${src}: game folder name must match ${GAME_RE}`);
    const mod = (await import(pathToFileURL(file).href)).default;
    if (!mod || typeof mod !== 'object' || Array.isArray(mod)) throw new Error(`${src}: default export must be a plain object of string arrays`);
    for (const [key, arr] of Object.entries(mod)) {
      if (!KEY_RE.test(key)) throw new Error(`${src}: key "${key}" must match ${KEY_RE}`);
      if (!Array.isArray(arr)) throw new Error(`${src}: "${key}" must be an array of strings`);
      arr.forEach((text, n) => {
        if (typeof text !== 'string' || !text.trim()) throw new Error(`${src}: "${key}"[${n}] must be a non-empty string`);
        out.push({ id: `mg-${game}-${key}`, n, text, source: `${src} ${key}[${n}]` });
      });
    }
  }
  return out;
}
