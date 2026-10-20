import { test, expect } from '@playwright/test';
import { createMatch, openPage, state } from './helpers.js';

// The host saves after every state change (localStorage, namespaced by ?pid=). Reopening its own link (same pid, same #gameId)
// resumes from that save without any menu; the clients see host-gone, then the host is back and everybody is re-seated.
test('closing the host mid-match shows host-gone; reopening its URL resumes the save and play continues', async ({ context }) => {
  const m = await createMatch(context, { clients: 2, query: 'stars=3&seed=7&coins=40' });
  const [host, c1, c2] = m.pages;
  const hostUrl = host.url();
  expect(hostUrl).toMatch(/#\w+$/);

  await c1.waitForFunction(() => { const s = window.__wk?.getState(); return s?.phase === 'boardTurn' && s.round >= 2; }, null, { timeout: 5 * 60_000, polling: 100 });
  await host.close();

  for (const c of [c1, c2]) await expect(c.getByTestId('host-gone')).toBeVisible({ timeout: 30_000 });

  // with the host gone nothing moves any more: this is exactly the last state the host saved and broadcast
  const last = await state(c1);
  await c1.waitForTimeout(1500);
  expect((await state(c1)).rev).toBe(last.rev);
  expect(last.round).toBeGreaterThanOrEqual(2);

  const host2 = await openPage(context, m.errors, 'host2');
  await host2.goto(hostUrl);
  await host2.getByTestId('hud-coins-0').waitFor({ timeout: 60_000 });   // straight into the game: no title screen, no create

  const resumed = await state(host2);
  expect(resumed.gameId).toBe(last.gameId);
  expect(resumed.round).toBe(last.round);
  expect(resumed.seats.map((s) => s.playerId)).toEqual(last.seats.map((s) => s.playerId));
  expect(resumed.players.map((p) => ({ coins: p.coins, stars: p.stars, spaceId: p.spaceId, items: p.items })))
    .toEqual(last.players.map((p) => ({ coins: p.coins, stars: p.stars, spaceId: p.spaceId, items: p.items })));
  expect(resumed.rev).toBeGreaterThan(last.rev);   // resumeGame bumps the rev, so clients accept it

  for (const c of [c1, c2]) await expect(c.getByTestId('host-gone')).toBeHidden({ timeout: 60_000 });

  // all clients are re-seated and play goes on
  await host2.waitForFunction(() => window.__wk.getState().seats.every((s) => s.connected), null, { timeout: 60_000, polling: 100 });
  const rev = (await state(host2)).rev;
  await host2.waitForFunction((r) => window.__wk.getState().rev > r + 5, rev, { timeout: 90_000, polling: 100 });
  for (const c of [c1, c2]) expect((await state(c)).rev).toBeGreaterThan(rev);
  expect(m.errors).toEqual([]);
});
