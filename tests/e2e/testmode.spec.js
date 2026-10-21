import { test, expect } from '@playwright/test';
import { BASE, openPage, state, waitState } from './helpers.js';

// Testmodus: ONE human page (no ?bot) switches it on in the lobby, adds three host-run bots, plays an arena game (aura) and then a solo game (pfand),
// each straight from the picker, and lands back on the picker after the results. Nothing of it may count: no coins, stars or mgWins.
const resultsOf = (s, id) => s.phase === 'minigameResults' && s.minigame?.id === id && !!s.minigame.results;
const backAtPicker = (s) => s.phase === 'lobby' && s.settings.testMode && s.minigame === null;

test('Testmodus: pick aura then pfand with host-run bots; results come back to the picker, nothing counts', async ({ context }) => {
  const errors = [];
  const page = await openPage(context, errors, 'host');
  await page.goto(`${BASE}?local&pid=h&seed=3`);
  await page.getByTestId('create').click();
  await page.getByTestId('lobby').waitFor();

  // normal lobby first: Start exists, the picker does not
  await expect(page.getByTestId('start')).toBeVisible();
  await expect(page.getByTestId('testmode')).toHaveCount(0);

  await page.getByTestId('tm-on').click();
  await expect(page.getByTestId('testmode')).toBeVisible();
  await expect(page.getByTestId('start')).toHaveCount(0);
  expect((await state(page)).settings.testMode).toBe(true);
  // every registered game is listed with its in-game name and a player-count text
  expect(await page.locator('[data-testid^="tm-game-"]').count()).toBeGreaterThanOrEqual(14);
  await expect(page.getByTestId('tm-game-tauziehen')).toContainText('4 oder 6 Spieler');
  await expect(page.getByTestId('tm-start')).toBeDisabled();   // alone at the table

  for (let i = 0; i < 3; i++) await page.getByTestId('tm-add-bot').click();
  await expect(page.getByTestId('player-3')).toBeVisible();
  const lobbyState = await state(page);
  expect(lobbyState.seats.map((s) => !!s.hostBot)).toEqual([false, true, true, true]);
  const purse = lobbyState.players.map(({ coins, stars, mgWins }) => ({ coins, stars, mgWins }));

  // a team game with 4 is fine, with 5 it is not (even counts only): the picker says so and Start stays locked
  await page.getByTestId('tm-add-bot').click();
  await page.getByTestId('tm-game-sitzplatz').click();
  await expect(page.getByTestId('tm-start')).toBeDisabled();
  await expect(page.getByTestId('lobby-hint')).toContainText('braucht');
  await page.getByTestId('tm-remove-bot').click();
  await expect(page.getByTestId('tm-start')).toBeEnabled();

  // ---- an arena game, played by the human (idle) and three bots
  await page.getByTestId('tm-game-aura').click();
  await page.getByTestId('tm-start').click();
  await waitState(page, (s) => s.phase === 'minigameIntro' && s.minigame.id === 'aura', null);
  const intro = await state(page);
  expect(intro.minigame.seats).toEqual([0, 1, 2, 3]);
  expect(intro.minigame.ready).toEqual([1, 2, 3]);   // the bots are ready, the human is not
  await page.keyboard.press('Enter');
  await waitState(page, resultsOf, 'aura', 3 * 60_000);
  let st = await state(page);
  expect(st.minigame.results.void).toBeFalsy();
  expect(st.minigame.results.placements.flat().sort()).toEqual([0, 1, 2, 3]);
  expect(st.minigame.results.placements.length, 'the bots really played: not everybody tied').toBeGreaterThan(1);
  expect(st.minigame.coinDelta).toEqual({ 0: 0, 1: 0, 2: 0, 3: 0 });
  expect(st.players.map(({ coins, stars, mgWins }) => ({ coins, stars, mgWins }))).toEqual(purse);

  // ---- back at the picker, the arena game remembered
  await waitState(page, backAtPicker, null, 60_000);
  await expect(page.getByTestId('testmode')).toBeVisible();
  await expect(page.getByTestId('tm-game-aura')).toHaveAttribute('aria-pressed', 'true');
  st = await state(page);
  expect(st.seats.length).toBe(4);

  // ---- a solo game with the same table
  await page.getByTestId('tm-game-pfand').click();
  await page.getByTestId('tm-start').click();
  await waitState(page, (s) => s.phase === 'minigameIntro' && s.minigame.id === 'pfand', null);
  await page.keyboard.press('Enter');
  await waitState(page, resultsOf, 'pfand', 4 * 60_000);
  st = await state(page);
  expect(st.minigame.results.void).toBeFalsy();
  expect(st.minigame.results.placements.flat().sort()).toEqual([0, 1, 2, 3]);
  expect(st.minigame.results.placements.length, 'the bots scored differently').toBeGreaterThan(1);
  expect(Object.keys(st.minigame.results.labels ?? {}).length, 'bot seats reported a result label').toBeGreaterThanOrEqual(3);
  expect(st.players.map(({ coins, stars, mgWins }) => ({ coins, stars, mgWins }))).toEqual(purse);

  await waitState(page, backAtPicker, null, 60_000);
  st = await state(page);
  expect(st.players.map(({ coins, stars, mgWins }) => ({ coins, stars, mgWins }))).toEqual(purse);
  expect([st.round, st.mgHistory, st.log]).toEqual([0, [], []]);

  // ---- leave the test mode: the bots go, the normal lobby is back
  await page.getByTestId('tm-off').click();
  await expect(page.getByTestId('start')).toBeVisible();
  await expect(page.getByTestId('testmode')).toHaveCount(0);
  st = await state(page);
  expect([st.settings.testMode, st.seats.length]).toEqual([false, 1]);

  expect(errors).toEqual([]);
});
