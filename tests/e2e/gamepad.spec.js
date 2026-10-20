import { test, expect } from '@playwright/test';
import { BASE, collectErrors, openPage, state, TRACK_EVENTS } from './helpers.js';
import { PAD, PAD_STUB, padPress, padTap } from './pad.js';

test('menus: pick a colour, create, and reach start in the lobby with the pad only', async ({ context }) => {
  const errors = [];
  const host = await context.newPage();
  collectErrors(host, errors, 'host');
  await host.addInitScript(PAD_STUB);
  await host.goto(`${BASE}?local&pid=h&stars=1&seed=7`);   // no ?bot: this seat is a human

  const swatch = host.getByTestId('color-3');
  const colour = (await swatch.getAttribute('style')).match(/--c:\s*([^;]+)/)[1].trim();
  await padPress(host, 'color-3');
  await expect(swatch).toHaveAttribute('aria-pressed', 'true');
  await padPress(host, 'create');
  await host.getByTestId('lobby').waitFor();
  expect((await state(host)).seats[0].profile.color).toBe(colour);

  // a second player (bot) so that Start unlocks; the host walks to it with the d-pad
  const link = await host.getByTestId('invite-link').inputValue();
  const bot = await openPage(context, errors, 'bot');
  await bot.goto(link.replace('?local', '?local&pid=c1&bot'));
  await host.getByTestId('player-1').waitFor();
  await expect(host.getByTestId('start')).toBeEnabled();
  await padPress(host, 'start');
  await host.getByTestId('hud-coins-0').waitFor();
  expect((await state(host)).phase).toBe('boardTurn');
  expect(errors).toEqual([]);
});

test('minigame: A on the pad stops the Forza bar', async ({ context }) => {
  const errors = [];
  const host = await context.newPage();
  collectErrors(host, errors, 'host');
  await host.addInitScript(TRACK_EVENTS);
  await host.addInitScript(PAD_STUB);
  await host.goto(`${BASE}?local&pid=h&stars=5&seed=7&mg=forza`);   // human host, Forza forced, no ?bot
  await host.getByTestId('create').click();
  const link = await host.getByTestId('invite-link').inputValue();
  const bot = await openPage(context, errors, 'bot');   // the bot is also the observer: it receives the human's mgProgress
  await bot.goto(link.replace('?local', '?local&pid=c1&bot'));
  await host.getByTestId('player-1').waitFor();
  await host.getByTestId('start').click();
  await host.getByTestId('hud-coins-0').waitFor();
  const humanId = await host.evaluate(() => window.__wk.session.selfPlayerId);
  const me = await host.evaluate(() => window.__wk.selfSeat());

  // the human plays its board turns with the pad too (A rolls, picks the first path, buys a star; B leaves a shop) until the round's minigame
  const deadline = Date.now() + 5 * 60_000;
  let lastTap = 0;
  for (;;) {
    const s = await state(host);
    if (s.phase === 'minigameIntro') break;
    expect(Date.now(), 'reached the minigame in time').toBeLessThan(deadline);
    if (s.phase === 'boardTurn' && s.turn.seat === me && Date.now() - lastTap > 2500) {   // a lost tap (prompt not armed yet) is simply repeated
      lastTap = Date.now();
      await padTap(host, s.turn.step === 'shop' ? PAD.B : PAD.A);
    } else await host.waitForTimeout(250);
  }
  await host.waitForFunction(() => window.__wk.getState().minigame?.id === 'forza');
  await padTap(host, PAD.A);   // ready (runner intro screen)
  await host.waitForFunction(() => window.__wk.getState().phase === 'minigame', null, { timeout: 60_000 });

  const progress = () => bot.evaluate((id) => window.__prog.filter((x) => x.from === id), humanId);
  // wait for the bar to run (d === 0), then stop it with A
  await expect.poll(async () => (await progress()).some((x) => x.p?.d === 0), { timeout: 60_000, intervals: [100] }).toBe(true);
  expect((await progress()).every((x) => (x.p.s ?? []).length === 0)).toBe(true);   // nothing stopped yet
  await padTap(host, PAD.A);

  // the stop arrives long before the bar would run to its cap on its own (>= ~7 s): attempt 1 has a score, the bar is paused
  await expect.poll(async () => (await progress()).some((x) => (x.p.s ?? []).length === 1), { timeout: 5000, intervals: [100] }).toBe(true);
  const stop = (await progress()).find((x) => (x.p.s ?? []).length === 1);
  expect(stop.p.a).toBe(0);
  expect(stop.p.d).toBeGreaterThanOrEqual(1);
  expect(stop.p.s[0]).toBeGreaterThanOrEqual(0);
  expect(stop.t).toBeLessThan(5000);
  expect(errors).toEqual([]);
});
