import { test, expect } from '@playwright/test';
import { createMatch, openPage } from './helpers.js';

// D31: after a host resume the absent seats are not auto-played for the first 15 s, so their players can rejoin first.
test('after a host resume an absent seat is not auto-played for 15 s, then it is', async ({ context }) => {
  test.setTimeout(180_000);
  const m = await createMatch(context, { clients: 1, query: 'stars=3&seed=7&coins=40' });
  const [host, c1] = m.pages;
  const hostUrl = host.url();
  await c1.waitForFunction(() => window.__wk.getState()?.round >= 1, null, { timeout: 60_000, polling: 100 });
  await c1.close();   // seat 1 is gone for good
  await host.close();

  const host2 = await openPage(context, m.errors, 'host2');
  await host2.addInitScript(() => {
    // t0 = first state of the resumed run; record when seat 1 is acted for (its turn taken, or it became ready in a minigame intro)
    window.__acted = null; window.__t0 = null;
    let prev = null;
    setInterval(() => {
      const s = window.__wk?.getState();
      if (!s) return;
      if (window.__t0 === null) window.__t0 = performance.now();
      if (prev && s.rev !== prev.rev && window.__acted === null) {
        const turnTaken = prev.phase === 'boardTurn' && prev.turn.seat === 1 && (s.phase !== 'boardTurn' || s.turn.seat !== 1 || JSON.stringify(s.turn) !== JSON.stringify(prev.turn));
        const readied = s.phase === 'minigameIntro' && s.minigame.ready.includes(1) && !(prev.minigame?.ready ?? []).includes(1);
        if (turnTaken || readied) window.__acted = performance.now() - window.__t0;
      }
      prev = s;
    }, 20);
  });
  await host2.goto(hostUrl);
  await host2.getByTestId('hud-coins-0').waitFor({ timeout: 60_000 });
  expect(await host2.evaluate(() => window.__wk.getState().seats[1].connected)).toBe(false);

  // the host bot plays its own seat until seat 1 is up; for 14 s nothing may act for seat 1
  await host2.waitForTimeout(14_000);
  expect(await host2.evaluate(() => window.__acted)).toBeNull();

  // after the grace the normal autoplay resumes (15 s + the 1.2 s autoplay delay)
  await host2.waitForFunction(() => window.__acted !== null, null, { timeout: 20_000, polling: 100 });
  expect(await host2.evaluate(() => window.__acted)).toBeGreaterThanOrEqual(14_900);
  expect(m.errors).toEqual([]);
});
