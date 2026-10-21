import { test, expect } from '@playwright/test';
import { runMinigame } from './helpers.js';

test('aura: runs with 4 bots and awards placements', async ({ context }) => {
  const r = await runMinigame(context, 'aura');
  expect(r.placements.flat().length).toBe(4);
  expect(r.errors).toEqual([]);
  // every seat has a German "<n> Aura" result label
  const labels = r.results?.labels ?? {};
  for (const seat of r.placements.flat()) expect(String(labels[seat])).toMatch(/Aura$/);
});
