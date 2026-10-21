import { test, expect } from '@playwright/test';
import { runMinigame } from './helpers.js';

test('pfand: runs with 4 bots and awards placements', async ({ context }) => {
  const r = await runMinigame(context, 'pfand');
  expect(r.placements.flat().length).toBe(4);
  expect(r.errors).toEqual([]);
  // every seat reports a Pfand amount in German notation ("3,75 €"); the bots are good enough to have fed at least one bottle
  const labels = Object.values(r.results.labels ?? {});
  expect(labels.length).toBe(4);
  for (const l of labels) expect(l).toMatch(/^\d+,\d{2} €$/);
  expect(labels.some((l) => l !== '0,00 €')).toBe(true);
});
