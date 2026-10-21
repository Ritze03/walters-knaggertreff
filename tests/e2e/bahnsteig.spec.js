import { test, expect } from '@playwright/test';
import { createMatch, state, waitState } from './helpers.js';

// Bahnsteig-Chaos (arena, three.js): 4 bots in one ?local context. While it runs every page shows exactly one WebGL canvas, afterwards none is left.
test('bahnsteig: runs with 4 bots in 3D, awards placements and leaves no canvas behind', async ({ context }) => {
  const m = await createMatch(context, { clients: 3, query: 'stars=2&seed=1&mg=bahnsteig' });
  const canvas = (p) => p.locator('[data-testid="mg-canvas-3d"]').count();

  await Promise.all(m.pages.map((p) => waitState(p, (s) => s.phase === 'minigame' && s.minigame?.id === 'bahnsteig', null, 180_000)));
  await expect.poll(async () => (await Promise.all(m.pages.map(canvas))).join(), { timeout: 30_000 }).toBe('1,1,1,1');
  if (process.env.WK_SHOT) {   // debugging aid: WK_SHOT=/path/prefix saves a screenshot every 2 s
    for (let i = 0; i < 18; i++) { await m.host.waitForTimeout(2000); await m.host.screenshot({ path: `${process.env.WK_SHOT}-${String(i).padStart(2, '0')}.png` }); }
  }

  const done = (s) => s.phase === 'minigameResults' && s.minigame?.id === 'bahnsteig' && !!s.minigame.results;
  await Promise.all(m.pages.map((p) => waitState(p, done, null, 120_000)));
  const st = await state(m.host);
  const res = st.minigame.results;
  expect(res.void).toBeFalsy();
  expect(res.placements.flat().sort()).toEqual([...st.minigame.seats].sort());
  expect(res.placements.flat().length).toBe(4);
  for (const s of st.minigame.seats) expect(res.labels[s]).toMatch(/Bahnsteig|abgefahren/);
  for (const p of m.pages) expect(await canvas(p), 'no leaked 3D canvas on the results screen').toBe(0);
  for (const p of m.pages) expect(await p.locator('[data-testid="mg-overlay-3d"]').count()).toBe(0);
  expect(m.errors).toEqual([]);
});
