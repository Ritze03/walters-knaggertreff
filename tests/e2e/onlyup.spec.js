import { test, expect } from '@playwright/test';
import { runMinigame, createMatch, waitPhase } from './helpers.js';

const canvases = (page) => page.locator('[data-testid="mg-canvas-3d"]').count();

test('onlyup: runs with 4 bots, climbs in 3D, awards placements, leaves no canvas behind', async ({ context }) => {
  test.setTimeout(240_000);   // a run takes ~1 min; createMatch's waits have no timeout of their own, so a stuck lobby would otherwise sit for the 15 min default
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

// Occlusion: a big prop (a cloud, a platform) must never hide the blob. Meshes between the camera and the blob fade to ~0.25 and come back.
// window.__onlyup is only published for ?bot lanes (client.js).
// The bot keeps climbing and the camera follows it round the tower, so nothing in the world stays "in the way" for long: the checks below are
// frame-exact (counted in occl.update calls, i.e. rendered frames), never wall-clock, and the synthetic obstacle follows the camera->blob line itself.
const RAY = () => {
  const o = window.__onlyup, T = o.THREE;
  o.scene.updateMatrixWorld(true);
  const from = o.camera.position.clone(), to = o.player.position.clone().add(new T.Vector3(0, 0.5, 0));
  const dir = to.clone().sub(from), dist = dir.length();
  const rc = new T.Raycaster(from, dir.normalize(), 0, dist - 0.4);
  return rc.intersectObjects(o.world.occluders, false).map((h) => ({ id: h.object.uuid, op: Math.max(...[].concat(h.object.material).map((m) => m.opacity)) }));
};

test('onlyup: nothing blocks the view of the blob: whatever is in the way fades, then comes back', async ({ context }) => {
  test.setTimeout(240_000);
  const m = await createMatch(context, { clients: 1, query: 'stars=2&seed=3&mg=onlyup' });
  await waitPhase(m.host, 'minigame');
  await m.host.waitForFunction(() => window.__onlyup, null, { timeout: 30_000 });
  await m.host.waitForFunction(() => window.__onlyup.st.t > 0.5, null, { timeout: 60_000, polling: 100 });   // the countdown is over: the sim runs
  // 1) bot climb: every 0.5 s the camera->blob ray is clear or every hit is faded. A mesh that only just swept into the ray is still mid-fade for ~4 frames
  // (a sample can land in that window), so an unfaded hit only counts when it is still unfaded 300 ms later.
  for (let i = 0; i < 20; i++) {   // 10 s of a 45 s game: step 2 must still find a live scene
    let bad = (await m.host.evaluate(RAY)).filter((h) => h.op >= 0.5);
    if (bad.length) {
      await m.host.waitForTimeout(300);
      const again = new Set((await m.host.evaluate(RAY)).filter((h) => h.op >= 0.5).map((h) => h.id));
      bad = bad.filter((h) => again.has(h.id));
    }
    expect(bad, `sample ${i}: unfaded mesh between camera and blob`).toEqual([]);
    await m.host.waitForTimeout(500);
  }
  // 2) a synthetic obstacle (a cloud puff, scaled up) is pinned to the camera->blob midpoint on EVERY frame (it can't drift out of the ray while the bot
  // walks and the camera swings round). It must fade to 0.25 (on a slow machine that takes more wall-clock time, never more than a few frames' worth of
  // game time), and be restored (original material, opacity 1) after it leaves. Waits count rendered frames (occl.update calls) until the condition holds, with a cap.
  const r = await m.host.evaluate(async () => {
    const o = window.__onlyup, T = o.THREE;
    const puff = o.world.occluders.find((x) => x.geometry.type === 'SphereGeometry' && x.parent.userData.speed);
    const grp = puff.parent, saved = grp.position.clone(), speed = grp.userData.speed, orig = puff.material, S = 2.2;
    const realUpdate = o.occl.update;
    let pinned = true, frames = 0, cond = null, wake = null;
    o.occl.update = function (dt, pos) {
      if (pinned) {   // camera + blob are already final for this frame (client.js calls occl.update last)
        const mid = o.camera.position.clone().lerp(o.player.position.clone().add(new T.Vector3(0, 0.5, 0)), 0.5);
        grp.position.copy(mid).sub(puff.position.clone().multiplyScalar(S));
        grp.updateMatrixWorld(true);
      }
      realUpdate.call(this, dt, pos);
      frames++;
      if (wake && (cond() || frames >= wake.cap)) { const w = wake; wake = null; w.res(); }
    };
    // resolves when cond() holds, after at most `cap` frames; the timer only guards against the game ending (canvas destroyed) meanwhile
    const until = (c, cap = 200) => new Promise((res) => { cond = c; wake = { res, cap: frames + cap }; setTimeout(res, 30_000); });
    grp.userData.speed = 0; grp.scale.setScalar(S);
    await until(() => o.occl.opacityOf(puff) <= 0.26);
    const faded = o.occl.opacityOf(puff), fadedMat = puff.material !== orig;
    pinned = false; grp.scale.setScalar(1); grp.position.copy(saved); grp.updateMatrixWorld(true);
    await until(() => o.occl.opacityOf(puff) === 1);
    const out = { faded, fadedMat, back: o.occl.opacityOf(puff), restored: puff.material === orig, frames };
    o.occl.update = realUpdate; grp.userData.speed = speed;
    return out;
  });
  expect(r.faded).toBeLessThan(0.5);
  expect(r.fadedMat).toBe(true);
  expect(r.back).toBe(1);
  expect(r.restored).toBe(true);
  expect(m.errors).toEqual([]);
});
