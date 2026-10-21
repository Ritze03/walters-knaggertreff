import { test, expect } from '@playwright/test';
import { runMinigame, createMatch, waitPhase } from './helpers.js';

const canvases = (page) => page.locator('[data-testid="mg-canvas-3d"]').count();

test('onlyup: runs with 4 bots, climbs in 3D, awards placements, leaves no canvas behind', async ({ context }) => {
  const r = await runMinigame(context, 'onlyup');
  expect(r.minigame.id).toBe('onlyup');
  expect(r.placements.flat().length).toBe(4);
  expect(r.errors).toEqual([]);
  // every seat reports a German height / summit label
  const labels = Object.values(r.results.labels ?? {});
  expect(labels.length).toBe(4);
  for (const l of labels) expect(l).toMatch(/^(\d+ m|Gipfel! \d+,\d s)$/);
  for (const p of r.pages) expect(await canvases(p)).toBe(0);
});

test('onlyup: the main lane has exactly one WebGL canvas while playing (thumbnails stay 2D)', async ({ context }) => {
  test.setTimeout(240_000);
  const m = await createMatch(context, { clients: 1, query: 'stars=2&seed=3&mg=onlyup' });
  await waitPhase(m.host, 'minigame');
  await m.host.waitForTimeout(2500);
  expect(await canvases(m.host)).toBe(1);
  expect(await m.host.locator('[data-testid="mg-overlay-3d"]').count()).toBe(1);
  await waitPhase(m.host, 'minigameResults', 120_000);
  expect(await canvases(m.host)).toBe(0);
  expect(m.errors).toEqual([]);
});
