import { test, expect } from '@playwright/test';
import { runMinigame } from './helpers.js';

test('sitzplatz: 2v2 team game runs with 4 bots and awards team placements', async ({ context }) => {
  const r = await runMinigame(context, 'sitzplatz');
  expect(r.errors).toEqual([]);
  expect([...r.placements.flat()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  // team game: the descriptor carries two teams of two, and teams are never split across placement groups
  const { mode, teams } = r.minigame;
  expect(mode).toBe('team');
  expect(teams.length).toBe(2);
  expect(teams.map((t) => t.length)).toEqual([2, 2]);
  const sorted = (g) => [...g].sort((a, b) => a - b);
  if (r.placements.length === 2) {
    expect(r.placements.map(sorted)).toEqual(expect.arrayContaining(teams.map(sorted)));
  } else {
    expect(r.placements.length).toBe(1);   // a draw: everybody in one group
  }
  // the results label names the team and its seat count
  const labels = r.results.labels ?? {};
  for (const s of r.minigame.seats) expect(labels[s]).toMatch(/^Team (Rot|Blau): \d+ von 40 Plätzen$/);
});

// Owner-authoritative movement: every ?bot tab is an owner (it simulates its own body and reports it), the host runs with 100 ms of artificial lag
// and the team game still plays out; the reports stay inside the carriage and the placements are awarded.
test('sitzplatz: owner clients report sane bodies under host lag and the teams are ranked', async ({ context }) => {
  await context.addInitScript(() => {
    window.__own = { n: 0, bad: 0, jn: 0, keys: null };
    setInterval(() => {
      const o = window.__wkMg?.own?.();
      if (!o) return;
      const w = window.__own;
      w.n++; w.jn = Math.max(w.jn, o.jn);
      w.keys ??= Object.keys(o).sort().join(',');
      if (!(o.x >= 60 && o.x <= 1220 && o.y >= 100 && o.y <= 640) || Object.values(o).some((v) => !Number.isFinite(v))) w.bad++;
    }, 50);
  });
  const r = await runMinigame(context, 'sitzplatz', { query: 'lag=100' });
  expect(r.errors).toEqual([]);
  const seen = await Promise.all(r.pages.map((p) => p.evaluate(() => window.__own)));
  for (const s of seen) {
    expect(s.n, 'every owner client had a body to report').toBeGreaterThan(50);
    expect(s.bad).toBe(0);
    expect(s.keys).toBe('ack,cd,fx,fy,jn,kx,ky,stun,vx,vy,x,y');
  }
  expect(Math.max(...seen.map((s) => s.jn)), 'at least one owner threw a jacket (jn serial bumped, claimed by the host)').toBeGreaterThan(0);
  // team placements are awarded: every seat once, teams never split (or a draw in one group)
  expect([...r.placements.flat()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  expect([1, 2]).toContain(r.placements.length);
  for (const s of r.minigame.seats) expect(r.results.labels[s]).toMatch(/^Team (Rot|Blau): \d+ von 40 Plätzen$/);
});
