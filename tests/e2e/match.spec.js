import { test, expect } from '@playwright/test';
import { createMatch, events, state } from './helpers.js';

// Pool pinned to forza,ordnungsamt (?pool, a debug param) so the spec stays robust whenever new minigames join the registry: the assertions
// below need exactly those two games, a Forza duel and a shop purchase within a few rounds (with the full pool, seed 8 drew onlyup/pfand/
// flappytaube/... and the match ran 800 s+ without a 2nd star). Seed 14 + a 40-coin start purse (?coins, a test knob: the purse keeps bot
// decisions independent of minigame results, so the seed replays the same board whatever the outcomes are). Verified in a core simulation
// (tools/sim-style: real engine, pool forza+ordnungsamt, random minigame outcomes, 3 bots incl. the lobby setReady steps; 40/40 outcomes
// contain forza+ordnungsamt rounds, a forza duel and an itemBought, victory in exactly 5 rounds) and in the real run (~4 min).
// Bot randomness is derived from state.rev, so after an engine change (board, events, intents) the seed must be re-verified; seed 8 (original)
// still satisfied the assertions with this pool but needed 7 rounds (~9 min), too close to the timeout.
const QUERY = 'stars=2&seed=14&coins=40&pool=forza,ordnungsamt';

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
