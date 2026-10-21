// Flappy Taube: the small live thumbnail of another player. Cheap Kaplay 2D: the shared course as plain blocks, that player's pigeon and score.
// Driven by update(p) with p = { x: dist, y, g: gaps, c: crumbs, d: 0 alive | 1 dead | 2 survived, v: speed }.
import { box, disc, label, setText, ease } from '../draw.js';
import { makeCourse, rectsOf, KINDS, GROUND, PX, W } from './sim.js';
import { addPigeon, addSky, addSkyline } from './art.js';

const COLORS = { plattenbau: '#a9aeb5', fernsehturm: '#c7ccd2', laterne: '#2f5a45', kran: '#f2b705', spaeti: '#e0c98e' };

export function mountThumb(ctx) {
  const { k, root } = ctx;
  const profile = ctx.seats.find((s) => s.index === ctx.seat)?.profile ?? { name: '?', color: '#ffb400', hat: 'none' };
  const course = makeCourse(ctx.rng);
  addSky(k, root);
  const far = addSkyline(k, root, 1200, 11, '#9ec4de', 120, 250, true);
  box(k, root, 0, GROUND, W, 80, '#5a5f66');
  box(k, root, 0, GROUND, W, 12, '#8b9097');
  const pool = Array.from({ length: 30 }, () => box(k, root, 0, -999, 10, 10, '#ffffff', { outline: [3, '#2c3036'] }));
  const crumbPool = Array.from({ length: 12 }, () => disc(k, root, 0, -999, 12, '#e8b25a', { outline: [3, '#8a5a1c'] }));
  const pig = addPigeon(k, root, profile.color);
  pig.obj.pos = k.vec2(PX, 320);
  const av = ctx.addAvatar(profile, { size: 70, showName: true });
  av.pos = k.vec2(90, 676);
  const score = label(k, root, '0', 480, 120, { size: 190, outline: [12, '#1b2a49'] });
  label(k, root, 'Lücken', 480, 232, { size: 54, outline: [8, '#1b2a49'] });
  label(k, root, '🍞', 760, 70, { size: 70 });
  const crumbTxt = label(k, root, '0', 850, 74, { size: 80, outline: [8, '#1b2a49'] });
  const dead = label(k, root, 'PLATSCH!', 480, 430, { size: 130, color: '#ff5a4a', outline: [10, '#101010'], angle: -6, opacity: 0 });

  let remote = { x: 0, y: 320, g: 0, c: 0, d: 0, v: 260 }, shown = 0, shownY = 320, last = '';
  root.onUpdate(() => {
    const dt = Math.min(0.1, k.dt());
    if (remote.d === 0) shown += remote.v * dt;
    shown += (remote.x - shown) * ease(dt, 5);
    shownY += (remote.y - shownY) * ease(dt, 20);
    far.pos = k.vec2(-((shown * 0.25) % 1200), 0);
    let n = 0;
    for (const o of course.obs) {
      if (o.x < shown - 160) continue;
      if (o.x > shown + W + 160) break;
      const col = k.rgb(COLORS[KINDS[o.kind].id]);
      for (const r of rectsOf(o)) {
        if (n >= pool.length) break;
        const p = pool[n++];
        p.pos = k.vec2(r[0] - shown, r[1]); p.width = r[2] - r[0]; p.height = r[3] - r[1]; p.color = col;
      }
    }
    for (; n < pool.length; n++) pool[n].pos = k.vec2(0, -999);
    let m = 0;
    for (const c of course.crumbs) {
      if (c.x < shown + PX + 10) continue;
      if (c.x > shown + W + 20) break;
      if (m >= crumbPool.length) break;
      crumbPool[m++].pos = k.vec2(c.x - shown, c.y);
    }
    for (; m < crumbPool.length; m++) crumbPool[m].pos = k.vec2(0, -999);
    pig.obj.pos = k.vec2(PX, shownY);
    pig.setPose(remote.d ? 0 : (remote.y - shownY) * 14, dt, remote.d === 1);
    if (remote.d === 0) { pig.wing.angle = 25 + Math.sin(performance.now() / 70) * 25; }
    const key = `${remote.g}|${remote.c}|${remote.d}`;
    if (key !== last) {
      last = key;
      setText(score, String(remote.g)); setText(crumbTxt, String(remote.c));
      dead.opacity = remote.d === 1 ? 1 : 0;
      if (remote.d === 1) av.bounce?.();
    }
  });

  return {
    go() {},
    update(p) { if (p && typeof p === 'object') remote = { x: +p.x || 0, y: +p.y || 320, g: p.g | 0, c: p.c | 0, d: p.d | 0, v: +p.v || 260 }; },
    botInput: () => ({}),
    destroy() {},
  };
}
