import { test, expect } from '@playwright/test';
import { runMinigame } from './helpers.js';

test('aura: runs with 4 bots and awards placements', async ({ context }) => {
  const r = await runMinigame(context, 'aura');
  expect(r.placements.flat().length).toBe(4);
  expect(r.errors).toEqual([]);
  // every seat has a German "<n> Aura" result label
  const labels = r.results?.labels ?? {};
  for (const seat of r.placements.flat()) expect(String(labels[seat])).toMatch(/Aura$/);
});

// Owner-authoritative movement: every ?bot tab is an owner (it simulates its own body and reports it), the host runs with 100 ms of artificial lag
// and the game still plays out; the reports stay inside the arena and bumps reach the victims as impulses (ownState().ack follows the host's impulse ids).
test('aura: owner clients report sane bodies under host lag and receive bump impulses', async ({ context }) => {
  await context.addInitScript(() => {
    window.__own = { n: 0, bad: 0, ack: 0, keys: null };
    setInterval(() => {
      const o = window.__wkMg?.own?.();
      if (!o) return;
      const w = window.__own;
      w.n++; w.ack = Math.max(w.ack, o.ack);
      w.keys ??= Object.keys(o).sort().join(',');
      if (!(o.x >= 40 && o.x <= 1240 && o.y >= 90 && o.y <= 690) || Object.values(o).some((v) => !Number.isFinite(v))) w.bad++;
    }, 50);
  });
  const r = await runMinigame(context, 'aura', { query: 'lag=100' });
  expect(r.errors).toEqual([]);
  const seen = await Promise.all(r.pages.map((p) => p.evaluate(() => window.__own)));
  for (const s of seen) {
    expect(s.n, 'every owner client had a body to report').toBeGreaterThan(50);
    expect(s.bad).toBe(0);
    expect(s.keys).toBe('ack,cd,dash,dn,fx,fy,kx,ky,stun,vx,vy,x,y');
  }
  expect(Math.max(...seen.map((s) => s.ack)), 'at least one bump was delivered as an impulse and acked').toBeGreaterThan(0);
});
