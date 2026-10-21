import { test, expect } from '@playwright/test';
import { createMatch, runMinigame, state, waitState } from './helpers.js';

// Bahnsteig-Chaos (arena, three.js): 4 bots in one ?local context. While it runs every page shows exactly one WebGL canvas, afterwards none is left.
test('bahnsteig: runs with 4 bots in 3D, awards placements and leaves no canvas behind', async ({ context }) => {
  const m = await createMatch(context, { clients: 3, query: 'stars=2&seed=1&mg=bahnsteig' });
  const canvas = (p) => p.locator('[data-testid="mg-canvas-3d"]').count();

  await Promise.all(m.pages.map((p) => waitState(p, (s) => s.phase === 'minigame' && s.minigame?.id === 'bahnsteig', null, 180_000)));
  await expect.poll(async () => (await Promise.all(m.pages.map(canvas))).join(), { timeout: 30_000 }).toBe('1,1,1,1');
  if (process.env.WK_SHOT) {   // debugging aid: WK_SHOT=/path/prefix saves a screenshot every 2 s
    for (let i = 0; i < 18; i++) { await m.host.waitForTimeout(2000); await m.host.screenshot({ path: `${process.env.WK_SHOT}-${String(i).padStart(2, '0')}.png` }); }
  }

  const done = (s) => s.phase === 'minigameResults' && s.minigame?.id === 'bahnsteig' && !!s.minigame.results;
  await Promise.all(m.pages.map((p) => waitState(p, done, null, 120_000)));
  const st = await state(m.host);
  const res = st.minigame.results;
  expect(res.void).toBeFalsy();
  expect(res.placements.flat().sort()).toEqual([...st.minigame.seats].sort());
  expect(res.placements.flat().length).toBe(4);
  for (const s of st.minigame.seats) expect(res.labels[s]).toMatch(/Bahnsteig|abgefahren/);
  for (const p of m.pages) expect(await canvas(p), 'no leaked 3D canvas on the results screen').toBe(0);
  for (const p of m.pages) expect(await p.locator('[data-testid="mg-overlay-3d"]').count()).toBe(0);
  expect(m.errors).toEqual([]);
});

// Owner-authoritative movement: every ?bot tab is an owner (it simulates its own body, counts its own coyote time against the tiles it sees and reports it), the host runs with 100 ms of
// artificial lag and the game still plays out; the reports stay on the platform and every page keeps its one WebGL canvas.
test('bahnsteig: owner clients report sane bodies under host lag and the game still ends', async ({ context }) => {
  await context.addInitScript(() => {
    window.__own = { n: 0, bad: 0, keys: null, ack: 0, dn: 0, air: 0 };
    setInterval(() => {
      const o = window.__wkMg?.own?.();
      if (!o) return;
      const w = window.__own;
      w.n++; w.ack = Math.max(w.ack, o.ack); w.dn = Math.max(w.dn, o.dn); w.air = Math.max(w.air, o.air);
      w.keys ??= Object.keys(o).sort().join(',');
      if (!(Math.abs(o.x) <= 15 && Math.abs(o.z) <= 13 && o.air >= 0 && o.air <= 140) || Object.values(o).some((v) => !Number.isFinite(v))) w.bad++;
    }, 50);
  });
  const r = await runMinigame(context, 'bahnsteig', { query: 'lag=100' });
  expect(r.errors).toEqual([]);
  const seen = await Promise.all(r.pages.map((p) => p.evaluate(() => window.__own)));
  for (const s of seen) {
    expect(s.n, 'every owner client had a body to report').toBeGreaterThan(50);
    expect(s.bad).toBe(0);
    expect(s.keys).toBe('ack,air,cd,dash,dn,fx,fz,kx,kz,stun,vx,vz,x,z');
  }
  expect(Math.max(...seen.map((s) => s.air)), 'somebody counted coyote time over a vanished tile').toBeGreaterThan(0);
  for (const p of r.pages) expect(await p.locator('[data-testid="mg-canvas-3d"]').count(), 'no leaked 3D canvas on the results screen').toBe(0);
  for (const s of r.minigame.seats) expect(r.results.labels[s]).toMatch(/Bahnsteig|abgefahren/);
});
