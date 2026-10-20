import { test, expect } from '@playwright/test';
import { createMatch, state } from './helpers.js';

// A reloaded client keeps its playerId (localStorage, namespaced by ?pid=), re-hellos, and the host seats it where it was.
test('reloading a client mid-match returns it to the same seat with the same coins and stars', async ({ context }) => {
  const m = await createMatch(context, { clients: 2, query: 'stars=3&seed=7&coins=40' });
  const [host, c1] = m.pages;

  // wait for a board turn after the first minigame, so coins have actually moved off the start purse
  await c1.waitForFunction(() => { const s = window.__wk?.getState(); return s?.phase === 'boardTurn' && s.round >= 2; }, null, { timeout: 5 * 60_000, polling: 100 });
  const seatBefore = await c1.evaluate(() => window.__wk.selfSeat());
  const before = await state(c1);
  expect(seatBefore).toBeGreaterThanOrEqual(1);

  await c1.reload();
  await c1.getByTestId('hud-coins-0').waitFor();
  await c1.waitForFunction(() => window.__wk?.getState()?.phase === 'boardTurn', null, { timeout: 60_000 });

  expect(await c1.evaluate(() => window.__wk.selfSeat())).toBe(seatBefore);
  const after = await state(c1);
  expect(after.seats[seatBefore].playerId).toBe(before.seats[seatBefore].playerId);
  expect(after.players).toHaveLength(before.players.length);

  // the host moved on while the page reloaded: compare against the host's snapshot of the SAME rev
  const hostAtRev = await host.evaluate((rev) => window.__revs[rev], after.rev);
  expect(hostAtRev, 'host saw the rev the reloaded client shows').toBeTruthy();
  expect(after.players.map((p) => ({ coins: p.coins, stars: p.stars }))).toEqual(hostAtRev.players.map((p) => ({ coins: p.coins, stars: p.stars })));
  // nothing is lost over a reload: coins/stars never go backwards for an untouched player, and the round never regresses
  expect(after.round).toBeGreaterThanOrEqual(before.round);
  expect(after.players[seatBefore].stars).toBeGreaterThanOrEqual(before.players[seatBefore].stars);

  // the HUD shows the same numbers as the state
  await expect(c1.getByTestId(`hud-coins-${seatBefore}`)).toHaveText(String(after.players[seatBefore].coins), { useInnerText: true });
  await expect(c1.getByTestId(`hud-stars-${seatBefore}`)).toHaveText(String(after.players[seatBefore].stars), { useInnerText: true });

  // and it keeps playing: its own seat gets a turn afterwards (the bot flag survived the reload)
  const rev = (await state(c1)).rev;
  await c1.waitForFunction((r) => window.__wk.getState().rev > r + 3, rev, { timeout: 60_000, polling: 100 });
  expect(m.errors).toEqual([]);
});
