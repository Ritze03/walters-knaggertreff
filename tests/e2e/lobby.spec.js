import { test, expect } from '@playwright/test';
import { BASE, collectErrors, openPage, state } from './helpers.js';
import { PAD_STUB, padPress } from './pad.js';

// Lobby readiness: the host's Start stays locked until every other player is ready; ready/unready is visible on every page.
test('lobby: Start unlocks only when all non-host players are ready; the ready mark follows everywhere', async ({ context }) => {
  const errors = [];
  const host = await openPage(context, errors, 'host');
  await host.goto(`${BASE}?local&pid=h&stars=1&seed=7`);
  await host.getByTestId('create').click();
  const link = await host.getByTestId('invite-link').inputValue();

  const human = await context.newPage();   // a human client, driven with the pad only
  collectErrors(human, errors, 'human');
  await human.addInitScript(PAD_STUB);
  await human.goto(link.replace('?local', '?local&pid=c1'));
  await human.getByTestId('join').click();   // no ?bot: a human has to press Beitreten
  const bot = await openPage(context, errors, 'bot');
  await bot.goto(link.replace('?local', '?local&pid=c2&bot'));
  await host.getByTestId('player-2').waitFor();
  const pages = [host, human, bot];

  // the bot readies itself, the human has not: Start is locked and says who it waits for
  await expect(host.getByTestId('ready-2')).toHaveAttribute('data-ready', 'true');
  await expect(host.getByTestId('ready-1')).toHaveAttribute('data-ready', 'false');
  await expect(host.getByTestId('start')).toBeDisabled();
  await expect(host.getByTestId('lobby-hint')).toHaveText(`Warte auf: ${(await state(host)).seats[1].profile.name}`);
  await expect(host.getByTestId('ready')).toHaveCount(0);   // the host has no ready button
  await expect(human.getByTestId('ready')).toHaveText('Bereit!');

  // the human readies up with the pad: every page flips the mark, Start unlocks
  await padPress(human, 'ready');
  for (const p of pages) await expect(p.getByTestId('ready-1')).toHaveAttribute('data-ready', 'true');
  await expect(human.getByTestId('ready')).toHaveText('Doch nicht');
  await expect(host.getByTestId('start')).toBeEnabled();

  // ... and back: unready locks Start again
  await human.getByTestId('ready').click();
  for (const p of pages) await expect(p.getByTestId('ready-1')).toHaveAttribute('data-ready', 'false');
  await expect(host.getByTestId('start')).toBeDisabled();
  if (process.env.WK_SHOT) {   // a manual look: taller viewport so the whole panel (Start + hint) is visible
    for (const [name, p] of [['host', host], ['client', human]]) {
      await p.setViewportSize({ width: 960, height: 1000 });
      await p.screenshot({ path: process.env.WK_SHOT.replace('.png', `-${name}.png`) });
    }
  }

  await human.getByTestId('ready').click();
  await expect(host.getByTestId('start')).toBeEnabled();
  await host.getByTestId('start').click();
  await host.getByTestId('hud-coins-0').waitFor();
  expect((await state(host)).phase).toBe('boardTurn');
  expect(errors).toEqual([]);
});
