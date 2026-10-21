import { test, expect } from '@playwright/test';
import { runMinigame, createMatch, state } from './helpers.js';

test('doodle: runs with 4 bots and awards placements', async ({ context }) => {
  const r = await runMinigame(context, 'doodle');
  expect(r.placements.flat().length).toBe(4);
  expect(new Set(r.placements.flat()).size).toBe(4);
  expect(r.errors).toEqual([]);
  // every seat has a German height label like "412 m" or "1.234 m" (thousands dot), and the bots really climbed
  const labels = r.results?.labels ?? {};
  for (const seat of r.placements.flat()) {
    const l = String(labels[seat]);
    expect(l).toMatch(/^\d{1,3}(\.\d{3})* m$/);
    expect(Number(l.replace(/\./g, '').replace(' m', ''))).toBeGreaterThan(50);
  }
});

// Regression: the thumbnails (= the spectator view of the other lanes) never extended their course, so once a remote climbed past the start-up
// stretch (~290 m) its lane showed an empty sheet of paper: no platforms, no hazards. The client exposes what each lane drew last frame.
test('doodle: spectated lanes keep drawing platforms while the remote climbs far', async ({ context }) => {
  const m = await createMatch(context, { clients: 3, query: 'stars=2&seed=1&mg=doodle' });
  const samples = [];
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const st = await state(m.host);
    if (st.phase === 'minigameResults') break;
    const lanes = await m.host.evaluate(() => Object.values(globalThis.__wkDoodle ?? {}).map((l) => ({ view: l.view, plats: l.plats, camY: l.camY })));
    for (const l of lanes) if (l.view === 'thumb' && l.camY < -2000) samples.push(l);   // far above the start-up stretch of the course (-1450)
    await m.host.waitForTimeout(500);
  }
  expect(samples.length, 'thumbnails were sampled while high up').toBeGreaterThan(6);
  expect(samples.filter((l) => l.plats === 0), 'a thumbnail high up drew no platform at all').toEqual([]);
  expect(m.errors).toEqual([]);
});
