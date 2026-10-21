import { test, expect } from '@playwright/test';
import { runMinigame } from './helpers.js';

test('sitzplatz: 2v2 team game runs with 4 bots and awards team placements', async ({ context }) => {
  const r = await runMinigame(context, 'sitzplatz');
  expect(r.errors).toEqual([]);
  expect([...r.placements.flat()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  // team game: the descriptor carries two teams of two, and teams are never split across placement groups
  const { mode, teams } = r.minigame;
  expect(mode).toBe('team');
  expect(teams.length).toBe(2);
  expect(teams.map((t) => t.length)).toEqual([2, 2]);
  const sorted = (g) => [...g].sort((a, b) => a - b);
  if (r.placements.length === 2) {
    expect(r.placements.map(sorted)).toEqual(expect.arrayContaining(teams.map(sorted)));
  } else {
    expect(r.placements.length).toBe(1);   // a draw: everybody in one group
  }
  // the results label names the team and its seat count
  const labels = r.results.labels ?? {};
  for (const s of r.minigame.seats) expect(labels[s]).toMatch(/^Team (Rot|Blau): \d+ von 40 Plätzen$/);
});
