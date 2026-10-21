import { test, expect } from '@playwright/test';
import { runMinigame, createMatch, waitState } from './helpers.js';

const pts = (label) => {
  const m = /^(\d+) Lücken(?: \+ (\d+) Krümel)?$/.exec(label ?? '');
  expect(m, `label: ${label}`).toBeTruthy();
  return Number(m[1]) * 3 + Number(m[2] ?? 0);
};

test('flappytaube: runs with 4 bots, labels and placements agree, thumbnails got progress', async ({ context }) => {
  const r = await runMinigame(context, 'flappytaube');
  expect(r.minigame.id).toBe('flappytaube');
  expect(r.placements.flat().length).toBe(4);
  const labels = r.results.labels ?? {};
  const score = (seat) => pts(labels[seat]);
  // best first: scores never increase down the placement list, and a group is a tie
  let prev = Infinity;
  for (const group of r.placements) {
    const s = score(group[0]);
    for (const seat of group) expect(score(seat)).toBe(s);
    expect(s).toBeLessThanOrEqual(prev);
    prev = s;
  }
  // the others' progress (thumbnails) travelled over the wire
  const prog = await r.host.evaluate(() => (window.__prog ?? []).length);
  expect(prog).toBeGreaterThan(5);
  expect(r.errors).toEqual([]);
});

test('flappytaube: a duel-sized match (2 players) works too', async ({ context }) => {
  const m = await createMatch(context, { clients: 1, query: 'stars=2&seed=3&mg=flappytaube' });
  await Promise.all(m.pages.map((p) => waitState(p, (s) => s.phase === 'minigameResults' && !!s.minigame?.results, 0, 150_000)));
  const results = (await m.host.evaluate(() => window.__wk.getState())).minigame.results;
  expect(results.void).toBeFalsy();
  expect(results.placements.flat().sort()).toEqual([0, 1]);
  expect(m.errors).toEqual([]);
});
