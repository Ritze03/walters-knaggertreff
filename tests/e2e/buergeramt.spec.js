import { test, expect } from '@playwright/test';
import { runMinigame } from './helpers.js';

test('buergeramt: runs with 4 bots, labels are stamp counts and awards placements', async ({ context }) => {
  const r = await runMinigame(context, 'buergeramt');
  expect(r.minigame.id).toBe('buergeramt');
  expect(r.placements.flat().length).toBe(4);
  expect([...r.placements.flat()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  for (const s of r.minigame.seats) expect(r.results.labels?.[s]).toMatch(/^\d+ Stempel$/);
  expect(r.errors).toEqual([]);
});
