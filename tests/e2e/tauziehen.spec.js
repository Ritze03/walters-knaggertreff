import { test, expect } from '@playwright/test';
import { runMinigame } from './helpers.js';

test('tauziehen: 2v2 with 4 bots pulls, finishes and awards team placements', async ({ context }) => {
  const r = await runMinigame(context, 'tauziehen');
  expect(r.minigame.id).toBe('tauziehen');
  expect(r.minigame.mode).toBe('team');
  expect(r.placements.flat().length).toBe(4);

  // team result: one group per team (best first), or a single group on a draw; groups follow the dealt teams
  const teams = r.minigame.teams.map((t) => [...t].sort((a, b) => a - b));
  const groups = r.placements.map((g) => [...g].sort((a, b) => a - b));
  if (groups.length === 2) {
    expect(teams).toContainEqual(groups[0]);
    expect(teams).toContainEqual(groups[1]);
  } else expect(groups).toEqual([[0, 1, 2, 3]]);

  // the host really counted the bots' button taps that travelled over the wire
  const labels = r.results.labels ?? {};
  for (const s of r.minigame.seats) {
    const m = /(\d+) Züge/.exec(labels[s] ?? '');
    expect(m, `label of seat ${s}: ${labels[s]}`).toBeTruthy();
    expect(Number(m[1])).toBeGreaterThan(20);
  }
  expect(r.errors).toEqual([]);
});
