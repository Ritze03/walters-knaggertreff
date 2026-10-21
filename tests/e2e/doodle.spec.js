import { test, expect } from '@playwright/test';
import { runMinigame } from './helpers.js';

test('doodle: runs with 4 bots and awards placements', async ({ context }) => {
  const r = await runMinigame(context, 'doodle');
  expect(r.placements.flat().length).toBe(4);
  expect(new Set(r.placements.flat()).size).toBe(4);
  expect(r.errors).toEqual([]);
  // every seat has a German height label like "412 m" or "1.234 m" (thousands dot), and the bots really climbed
  const labels = r.results?.labels ?? {};
  for (const seat of r.placements.flat()) {
    const l = String(labels[seat]);
    expect(l).toMatch(/^\d{1,3}(\.\d{3})* m$/);
    expect(Number(l.replace(/\./g, '').replace(' m', ''))).toBeGreaterThan(50);
  }
});
