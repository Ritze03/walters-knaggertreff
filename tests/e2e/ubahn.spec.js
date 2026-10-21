import { test, expect } from '@playwright/test';
import { runMinigame, createMatch, waitState } from './helpers.js';

const CANVAS = '[data-testid="mg-canvas-3d"]';

test('ubahn: runs with 4 bots, awards placements and leaves no 3D canvas behind', async ({ context }) => {
  const r = await runMinigame(context, 'ubahn');
  expect(r.minigame.id).toBe('ubahn');
  expect(r.placements.flat().length).toBe(4);
  for (const label of Object.values(r.results.labels ?? {})) expect(label).toMatch(/^\d+ m$/);
  for (const p of r.pages) {
    expect(await p.locator(CANVAS).count(), 'WebGL canvas must be gone on the results screen').toBe(0);
    expect(await p.locator('[data-testid="mg-overlay-3d"]').count()).toBe(0);
  }
  expect(r.errors).toEqual([]);
});

test('ubahn: a 3D canvas runs while playing and a duel-sized match (2 players) works too', async ({ context }) => {
  const m = await createMatch(context, { clients: 1, query: 'stars=2&seed=3&mg=ubahn' });
  await waitState(m.host, (s) => s.phase === 'minigame', 0, 120_000);
  await expect(m.host.locator(CANVAS)).toHaveCount(1, { timeout: 20_000 });
  await Promise.all(m.pages.map((p) => waitState(p, (s) => s.phase === 'minigameResults' && !!s.minigame?.results, 0, 120_000)));
  const results = (await m.host.evaluate(() => window.__wk.getState())).minigame.results;
  expect(results.void).toBeFalsy();
  expect(results.placements.flat().sort()).toEqual([0, 1]);
  for (const p of m.pages) expect(await p.locator(CANVAS).count()).toBe(0);
  expect(m.errors).toEqual([]);
});
