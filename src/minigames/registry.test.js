// Registry + module-shape checks. Plain node has no import.meta.glob, so the registry itself is empty here; instead every
// src/minigames/<id>/index.js is imported directly and checked with the same function the registry uses. A new minigame gets this test for free.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { MINIGAMES } from '../contracts.js';
import { moduleProblem } from './validate.js';
import { getMinigame, listMinigames } from './index.js';

const root = new URL('./', import.meta.url);
const folders = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(new URL(`${d.name}/index.js`, root))).map((d) => d.name);

test('the registry loads in node without throwing (glob is Vite-only)', () => {
  assert.ok(Array.isArray(listMinigames()));
  assert.equal(getMinigame('nope'), undefined);
});

test('forza and ordnungsamt exist as folders', () => {
  assert.ok(folders.includes('forza') && folders.includes('ordnungsamt'), folders.join(','));
});

for (const folder of folders) {
  test(`module ${folder}: valid shape, id = folder = MINIGAMES key`, async () => {
    const mod = (await import(`./${folder}/index.js`)).default;
    assert.equal(moduleProblem(mod, folder), null);
    assert.ok(Object.hasOwn(MINIGAMES, mod.id));
    assert.ok(mod.controlHints.every((h) => h.length < 80), 'control hints should be short');
    assert.ok(mod.instructions.length < 400);
  });
}

test('moduleProblem catches the usual mistakes', () => {
  const ok = { id: 'forza', name: 'x', instructions: 'y', controlHints: ['z'], durationMs: 1000, clientMount() {} };
  assert.equal(moduleProblem(ok, 'forza'), null);
  assert.match(moduleProblem(ok, 'pfand'), /folder/);
  assert.match(moduleProblem({ ...ok, id: 'quatsch' }, 'quatsch'), /MINIGAMES/);
  assert.match(moduleProblem({ ...ok, id: 'ordnungsamt' }, 'ordnungsamt'), /hostInit/);
  assert.match(moduleProblem({ ...ok, durationMs: 0 }, 'forza'), /durationMs/);
  assert.match(moduleProblem({ ...ok, hostAdopt: true }, 'forza'), /hostAdopt/);
  assert.match(moduleProblem({ ...ok, hostAdopt: 'yes' }, 'forza'), /hostAdopt/);
  assert.equal(moduleProblem({ ...ok, hostAdopt() {} }, 'forza'), null);
  assert.match(moduleProblem(undefined, 'forza'), /default export/);
});
