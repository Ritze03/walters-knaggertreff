import { test, expect } from '@playwright/test';
import { createMatch, events, state } from './helpers.js';

// Seed 8 with a 40-coin start purse (?coins, a test knob): the purse keeps bot decisions independent of minigame results, so the seed
// replays the same board whatever the minigame outcomes are. Verified in a core simulation (200 random minigame outcomes) to always
// contain Forza + Ordnungsamt rounds, a duel and a shop purchase before the 2nd star is bought (3 rounds). Re-verified (60/60 outcomes) after the
// Mario-numbers rebalance (star 20, duel cap 1 per round, round-2 duel rule).
// Bot randomness is derived from state.rev, and the bots' lobby `setReady` intents shift the rev, so the seed was re-picked (7 -> 8) with the same
// simulation including the ready steps (seed 8: 100/100 outcomes; seed 7 now 0/100).
const QUERY = 'stars=2&seed=8&coins=40';

test('3 bots play a full match on Spaeti-Kiez: Forza + Ordnungsamt, a duel, a shop purchase, no errors', async ({ context }) => {
  const m = await createMatch(context, { clients: 2, query: QUERY });
  await Promise.all(m.pages.map((p) => p.getByTestId('victory').waitFor({ timeout: 10 * 60_000 })));

  const states = await Promise.all(m.pages.map((p) => state(p)));
  for (const s of states) {
    expect(s.phase).toBe('victory');
    expect(s.players[s.winner].stars).toBeGreaterThanOrEqual(2);
    expect(s.settings.boardId).toBe('spaeti');
  }
  expect(new Set(states.map((s) => s.winner)).size).toBe(1);

  for (const p of m.pages) {
    const ev = await events(p);
    const trail = (await p.evaluate(() => window.__trail)).map((t) => t.split('@')[0]);
    // both minigames played to their results screen, as rounds
    expect(trail).toContain('minigameResults|forza/round');
    expect(trail).toContain('minigameResults|ordnungsamt/round');
    // at least one duel, played to its results
    expect(ev.some((e) => e.type === 'duelStart')).toBe(true);
    expect(trail).toContain('minigameResults|forza/duel');
    // at least one shop purchase, paid for
    const bought = ev.find((e) => e.type === 'itemBought');
    expect(bought).toBeTruthy();
    expect(ev.some((e) => e.type === 'coinsChanged' && e.reason === 'shop' && e.seat === bought.seat && e.delta === -bought.price)).toBe(true);
    expect(ev.some((e) => e.type === 'victory')).toBe(true);
  }
  expect(m.errors).toEqual([]);
});
