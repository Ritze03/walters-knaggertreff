import { test, expect } from '@playwright/test';
import { runMinigame, createMatch, waitPhase } from './helpers.js';

const canvases = (page) => page.locator('[data-testid="mg-canvas-3d"]').count();

test('onlyup: runs with 4 bots, climbs in 3D, awards placements, leaves no canvas behind', async ({ context }) => {
  const r = await runMinigame(context, 'onlyup');
  expect(r.minigame.id).toBe('onlyup');
  expect(r.placements.flat().length).toBe(4);
  expect(r.errors).toEqual([]);
  // every seat reports a German height / summit label
  const labels = Object.values(r.results.labels ?? {});
  expect(labels.length).toBe(4);
  for (const l of labels) expect(l).toMatch(/^(\d+ m|Gipfel! \d+,\d s)$/);
  for (const p of r.pages) expect(await canvases(p)).toBe(0);
});

test('onlyup: the main lane has exactly one WebGL canvas while playing (thumbnails stay 2D)', async ({ context }) => {
  test.setTimeout(240_000);
  const m = await createMatch(context, { clients: 1, query: 'stars=2&seed=3&mg=onlyup' });
  await waitPhase(m.host, 'minigame');
  await m.host.waitForTimeout(2500);
  expect(await canvases(m.host)).toBe(1);
  expect(await m.host.locator('[data-testid="mg-overlay-3d"]').count()).toBe(1);
  await waitPhase(m.host, 'minigameResults', 120_000);
  expect(await canvases(m.host)).toBe(0);
  expect(m.errors).toEqual([]);
});

// Occlusion: a big prop (the old giant bottle, a cloud) must never hide the blob. Meshes between the camera and the blob fade to ~0.25 and come back.
// window.__onlyup is only published for ?bot lanes (client.js).
const RAY = () => {
  const o = window.__onlyup, T = o.THREE;
  o.scene.updateMatrixWorld(true);
  const from = o.camera.position.clone(), to = o.player.position.clone().add(new T.Vector3(0, 0.5, 0));
  const dir = to.clone().sub(from), dist = dir.length();
  const rc = new T.Raycaster(from, dir.normalize(), 0, dist - 0.4);
  return rc.intersectObjects(o.world.occluders, false).map((h) => Math.max(...[].concat(h.object.material).map((m) => m.opacity)));
};

test('onlyup: nothing blocks the view of the blob: whatever is in the way fades, then comes back', async ({ context }) => {
  test.setTimeout(240_000);
  const m = await createMatch(context, { clients: 1, query: 'stars=2&seed=3&mg=onlyup' });
  await waitPhase(m.host, 'minigame');
  await m.host.waitForFunction(() => window.__onlyup, null, { timeout: 30_000 });
  await m.host.waitForTimeout(4000);   // countdown
  // 1) bot climb: every 0.5 s the camera->blob ray is clear or every hit is faded
  for (let i = 0; i < 50; i++) {
    const hits = await m.host.evaluate(RAY);
    expect(hits.filter((o) => o >= 0.5), `sample ${i}: unfaded mesh between camera and blob`).toEqual([]);
    await m.host.waitForTimeout(500);
  }
  // 2) a synthetic obstacle (a cloud puff dragged into the line of sight) fades to 0.25 and is restored afterwards
  const r = await m.host.evaluate(async () => {
    const o = window.__onlyup, T = o.THREE, wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const puff = o.world.occluders.find((x) => x.geometry.type === 'SphereGeometry' && x.parent.userData.speed);
    const grp = puff.parent, saved = grp.position.clone(), speed = grp.userData.speed, orig = puff.material;
    grp.userData.speed = 0; grp.scale.setScalar(2.2);
    const mid = o.camera.position.clone().lerp(o.player.position.clone().add(new T.Vector3(0, 0.5, 0)), 0.5);
    grp.position.copy(mid).sub(puff.position.clone().multiplyScalar(2.2));
    await wait(700);
    const faded = o.occl.opacityOf(puff);
    grp.scale.setScalar(1); grp.position.copy(saved); grp.userData.speed = speed;
    await wait(900);
    return { faded, back: o.occl.opacityOf(puff), restored: puff.material === orig };
  });
  expect(r.faded).toBeLessThan(0.5);
  expect(r.back).toBe(1);
  expect(r.restored).toBe(true);
  expect(m.errors).toEqual([]);
});
