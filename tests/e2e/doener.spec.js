import { test, expect } from '@playwright/test';
import { runMinigame } from './helpers.js';

test('doener: runs with 4 bots and awards placements', async ({ context }) => {
  const r = await runMinigame(context, 'doener');
  expect(r.placements.flat().length).toBe(4);
  expect(r.errors).toEqual([]);
  // every seat has a German "<n> Döner" result label, and the bots actually served something
  const labels = r.results?.labels ?? {};
  let total = 0;
  for (const seat of r.placements.flat()) {
    expect(String(labels[seat])).toMatch(/^\d+ Döner$/);
    total += parseInt(labels[seat], 10);
  }
  expect(total).toBeGreaterThan(0);
});

test('doener: works with exactly 2 players (duel size)', async ({ context }) => {
  const r = await runMinigame(context, 'doener', { players: 2, seed: 3 });
  expect(r.placements.flat().length).toBe(2);
  expect(r.errors).toEqual([]);
});
