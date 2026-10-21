import { test, expect } from '@playwright/test';
import { runMinigame } from './helpers.js';

test('schlager: runs with 4 bots and awards placements', async ({ context }) => {
  const r = await runMinigame(context, 'schlager');
  expect(r.minigame.id).toBe('schlager');
  expect(r.placements.flat().length).toBe(4);
  for (const label of Object.values(r.results.labels ?? {})) expect(label).toMatch(/^\d{1,3}(\.\d{3})* Punkte$/);
  // bots hit most notes, so every one of them scores something
  for (const label of Object.values(r.results.labels ?? {})) expect(label).not.toBe('0 Punkte');
  expect(r.errors).toEqual([]);
});

test('schlager: also works as a 2-player duel', async ({ context }) => {
  const r = await runMinigame(context, 'schlager', { players: 2, seed: 3 });
  expect([...r.placements.flat()].sort()).toEqual([0, 1]);
  expect(r.errors).toEqual([]);
});
