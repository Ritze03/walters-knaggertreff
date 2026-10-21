import { test, expect } from '@playwright/test';
import { runMinigame } from './helpers.js';

// Proves the shared runMinigame helper against the two reference games. New minigames copy this shape into tests/e2e/<id>.spec.js.
for (const id of ['forza', 'ordnungsamt']) {
  test(`${id}: 4 bots in one ?local context start it, run it and award placements`, async ({ context }) => {
    const r = await runMinigame(context, id);
    expect(r.minigame.id).toBe(id);
    expect(r.placements.flat().length).toBe(4);
    expect(r.errors).toEqual([]);
  });
}
