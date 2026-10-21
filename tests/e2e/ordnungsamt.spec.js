import { test, expect } from '@playwright/test';
import { runMinigame } from './helpers.js';

test('ordnungsamt: runs with 4 bots and awards placements', async ({ context }) => {
  const r = await runMinigame(context, 'ordnungsamt');
  expect(r.placements.flat().length).toBe(4);
  expect(r.errors).toEqual([]);
  // every seat has a German result label: "überlebt mit <n> Leben" or "kontrolliert nach <s> s"
  const labels = r.results?.labels ?? {};
  for (const seat of r.placements.flat()) expect(String(labels[seat])).toMatch(/überlebt mit \d+ Leben|kontrolliert nach/);
});

// Owner-authoritative movement: every ?bot tab is an owner (it simulates its own body and reports it), the host runs with 100 ms of artificial lag
// and the game still plays out; the reports stay inside the arena and van hits / shoves reach the victims as impulses (ownState().ack follows the host's impulse ids).
test('ordnungsamt: owner clients report sane bodies under host lag and receive hit impulses', async ({ context }) => {
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
  const r = await runMinigame(context, 'ordnungsamt', { query: 'lag=100' });
  expect(r.errors).toEqual([]);
  const seen = await Promise.all(r.pages.map((p) => p.evaluate(() => window.__own)));
  for (const s of seen) {
    expect(s.n, 'every owner client had a body to report').toBeGreaterThan(30);   // an eliminated player stops reporting (ownState() is null)
    expect(s.bad).toBe(0);
    expect(s.keys).toBe('ack,cd,dash,dn,fx,fy,kx,ky,stun,vx,vy,x,y');
  }
  expect(Math.max(...seen.map((s) => s.ack)), 'at least one van hit or shove was delivered as an impulse and acked').toBeGreaterThan(0);
});
