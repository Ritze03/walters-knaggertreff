// "U-Bahn-Surfers": the small live thumbnail of another player (cheap Kaplay 2D, never a WebGL context): a top-down 3-lane strip with the
// shared track scrolling by, that player's blob in its lane and the distance. Driven by update(p) with p = { d, l, b, h, s, sc }.
import { box, label, setText, ease } from '../draw.js';
import { makeTrack } from './sim.js';

const X0 = 300, LW = 120, PY = 560, PX_PER_M = 7, WIN_BACK = 3, WIN_AHEAD = 76;
const COLORS = { controller: '#27408b', scooter: '#2dd36f', pillar: '#dfe3ea', crate: '#1f5fcf', train: '#f2c81e', gate: '#f4d21e' };
const W = { controller: 0.5, scooter: 0.95, pillar: 0.55, crate: 0.6, train: 1.0, gate: 1.1 };

export function mountThumb(ctx) {
  const { k, root } = ctx;
  const profile = ctx.seats.find((s) => s.index === ctx.seat)?.profile ?? { name: '?', color: '#ffb400', hat: 'none' };
  const track = makeTrack(ctx.rng);
  box(k, root, 0, 0, 960, 720, '#141a2b');
  box(k, root, X0 - 70, 0, LW * 3 + 140, 720, '#dfe3ea');
  box(k, root, X0 - 70, 0, 14, 720, '#e8742c');
  box(k, root, X0 + LW * 3 + 56, 0, 14, 720, '#e8742c');
  box(k, root, X0, 0, LW * 3, 720, '#2b3145');
  const ties = Array.from({ length: 13 }, () => box(k, root, X0 + 6, 0, LW * 3 - 12, 8, '#3a4058'));
  for (let i = 1; i < 3; i++) box(k, root, X0 + i * LW - 2, 0, 4, 720, '#4b5272');
  const pool = Array.from({ length: 22 }, () => box(k, root, 0, -999, 10, 10, '#ffffff', { radius: 6 }));
  const dots = Array.from({ length: 24 }, () => box(k, root, 0, -999, 16, 16, '#d9923a', { radius: 8, anchor: 'center' }));
  const av = ctx.addAvatar(profile, { size: 78, showName: true });
  av.pos = k.vec2(X0 + LW * 1.5, PY + 20);
  const flash = box(k, root, 0, 0, 960, 720, '#ff3b30', { opacity: 0 });
  label(k, root, '🚇', 130, 100, { size: 64 });
  const dist = label(k, root, '0 m', 810, 110, { size: 96, outline: [8, '#141a2b'] });
  label(k, root, '🍾', 750, 215, { size: 56 });
  const bottles = label(k, root, '0', 840, 218, { size: 64, outline: [6, '#141a2b'] });

  let remote = { d: 0, l: 1, b: 0, h: 0, s: 0, sc: 0 }, shown = 0, x = X0 + LW * 1.5, lastHits = 0, flashT = 0;
  root.onUpdate(() => {
    const dt = k.dt();
    shown += (remote.d - shown) * ease(dt, 9);
    x += (X0 + LW * (remote.l + 0.5) - x) * ease(dt, 16);
    ties.forEach((t, i) => { t.pos = k.vec2(X0 + 6, (((i * 60 - shown * PX_PER_M) % 780) + 780) % 780 - 30); });
    let n = 0;
    for (const o of track.obstacles) {
      if (o.d + o.len < shown - WIN_BACK) continue;
      if (o.d > shown + WIN_AHEAD) break;
      if (n >= pool.length) break;
      const r = pool[n++];
      const hw = ((W[o.type] ?? 0.6) * LW) / 2.4;
      const y = PY - (o.d + o.len - shown) * PX_PER_M;
      r.pos = k.vec2(X0 + LW * (o.lane + 0.5) - hw, y);
      r.width = hw * 2; r.height = Math.max(14, o.len * PX_PER_M);
      r.color = k.rgb(COLORS[o.type] ?? '#ffffff');
    }
    for (; n < pool.length; n++) pool[n].pos = k.vec2(0, -999);
    let m = 0;
    for (const b of track.bottles) {
      if (b.d < shown - WIN_BACK) continue;
      if (b.d > shown + WIN_AHEAD) break;
      if (m >= dots.length) break;
      dots[m++].pos = k.vec2(X0 + LW * (b.lane + 0.5), PY - (b.d - shown) * PX_PER_M);
    }
    for (; m < dots.length; m++) dots[m].pos = k.vec2(0, -999);
    av.pos = k.vec2(x, PY + 20 + (remote.s ? Math.sin(performance.now() / 40) * 4 : 0));
    if (remote.h > lastHits) { flashT = 0.35; av.bounce?.(); }
    lastHits = remote.h;
    flashT = Math.max(0, flashT - dt);
    flash.opacity = flashT * 0.7;
    setText(dist, `${remote.sc | 0} m`);
    setText(bottles, String(remote.b | 0));
  });
  return {
    go() {},
    update(p) { if (p && typeof p === 'object') remote = { d: +p.d || 0, l: p.l ?? 1, b: p.b ?? 0, h: p.h ?? 0, s: p.s ?? 0, sc: p.sc ?? 0 }; },
    botInput: () => ({}),
    destroy() {},
  };
}
