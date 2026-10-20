import { test, expect } from '@playwright/test';
import { collectErrors } from './helpers.js';

// On demand only (`npm run test:online`): the LIVE GitHub Pages site over the real Trystero/Nostr transport. No ?local, so the two players
// must be in isolated browser contexts (two separate "browsers") and find each other through public Nostr relays (10-30 s is normal).
// Only meaningful after the current code is deployed. Override the target with WK_LIVE_URL.
const LIVE = process.env.WK_LIVE_URL ?? 'https://ritze03.github.io/walters-knaggertreff/';

test('two isolated browsers play a ?stars=1 bot match over Nostr on the live site', async ({ browser }) => {
  test.setTimeout(15 * 60_000);
  const errors = [];
  const ctxHost = await browser.newContext();
  const ctxClient = await browser.newContext();
  const host = await ctxHost.newPage();
  const client = await ctxClient.newPage();
  collectErrors(host, errors, 'host');
  collectErrors(client, errors, 'client');

  await host.goto(`${LIVE}?stars=1&bot`);
  await host.getByTestId('create').click();
  const link = await host.getByTestId('invite-link').inputValue();
  expect(link).toMatch(/#\w+$/);
  expect(link).not.toContain('local');

  await client.goto(`${LIVE}?stars=1&bot#${new URL(link).hash.slice(1)}`);
  await host.getByTestId('player-1').waitFor({ timeout: 120_000 });   // relay discovery
  await host.getByTestId('start').click();
  await Promise.all([host, client].map((p) => p.getByTestId('victory').waitFor({ timeout: 10 * 60_000 })));
  // Trystero tries many public Nostr relays and some are always down (502 etc.): that is external noise, everything else must be clean.
  expect(errors.filter((e) => !/WebSocket connection to 'wss:\/\/[^']+' failed/.test(e))).toEqual([]);
});
