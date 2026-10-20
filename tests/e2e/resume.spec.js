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

  // With the host gone nothing moves any more. The authoritative "last state" is the host's SAVE (same origin, so a client page can read it),
  // not what a client happens to show: the host saves BEFORE it broadcasts, and a broadcast sent right before the page died may never
  // arrive, so a client can be a rev (or a few) behind.
  const saveOf = () => c1.evaluate(() => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('wk:save:') && k.endsWith(':h'));
    return keys.length === 1 ? JSON.parse(localStorage.getItem(keys[0])) : keys;
  });
  const saved = await saveOf();
  expect(Array.isArray(saved)).toBe(false);
  expect(saved.round).toBeGreaterThanOrEqual(2);

  const last = await state(c1);
  await c1.waitForTimeout(1500);
  expect((await state(c1)).rev).toBe(last.rev);
  expect(await saveOf()).toEqual(saved);   // nothing writes the save any more
  // a client never runs ahead of the save, and when it did catch up it shows exactly the saved state
  expect(last.rev).toBeLessThanOrEqual(saved.rev);
  if (last.rev === saved.rev) expect(last.players).toEqual(saved.players);

  // The resumed host is a live game again: its bot / the autoplay of the absent seats start moving ~0.7-1.2 s after it appears. So the
  // resumed state must not be read from the page later on; record the very first save it writes (startRun stores the resumed state at once).
  const host2 = await openPage(context, m.errors, 'host2');
  await host2.addInitScript(() => {
    window.__firstSave = null;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (window.__firstSave === null && k.startsWith('wk:save:')) window.__firstSave = v;
      return set.call(this, k, v);
    };
  });
  await host2.goto(hostUrl);
  await host2.getByTestId('hud-coins-0').waitFor({ timeout: 60_000 });   // straight into the game: no title screen, no create

  const resumed = JSON.parse(await host2.evaluate(() => window.__firstSave));
  const brief = (st) => st.players.map((p) => ({ coins: p.coins, stars: p.stars, spaceId: p.spaceId, items: p.items }));
  expect(resumed.gameId).toBe(saved.gameId);
  expect(resumed.round).toBe(saved.round);
  expect(resumed.seats.map((s) => s.playerId)).toEqual(saved.seats.map((s) => s.playerId));
  expect(brief(resumed)).toEqual(brief(saved));
  expect(resumed.turn).toEqual(saved.turn);   // incl. a fork prompt (step 'path', options, stepsLeft)
  expect(resumed.rev).toBe(saved.rev + 1);   // resumeGame bumps the rev, so clients accept it

  for (const c of [c1, c2]) await expect(c.getByTestId('host-gone')).toBeHidden({ timeout: 60_000 });

  // all clients are re-seated and play goes on
  await host2.waitForFunction(() => window.__wk.getState().seats.every((s) => s.connected), null, { timeout: 60_000, polling: 100 });
  const rev = (await state(host2)).rev;
  await host2.waitForFunction((r) => window.__wk.getState().rev > r + 5, rev, { timeout: 90_000, polling: 100 });
  for (const c of [c1, c2]) expect((await state(c)).rev).toBeGreaterThan(rev);
  expect(m.errors).toEqual([]);
});
