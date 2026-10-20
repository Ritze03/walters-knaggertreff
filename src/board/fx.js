// Screen-space juice: banners, chips, dice, flashes, confetti. Everything is parented under `ui` (a child of the board root).
import { makeDraw } from './draw.js';

export function createFx({ k, ui, scene, anim, audio }) {
  const { W, H } = scene;
  const d = makeDraw(k);
  const INK = '#2a2340';

  /** adds styled text; returns the object */
  function text(parent, s, size, { pos = [0, 0], color = '#ffffff', ink = INK, line = 6, anchor = 'center', width, align = 'center' } = {}) {
    return parent.add([
      k.pos(pos[0], pos[1]), k.anchor(anchor), k.text(s, { size, width, align }), k.color(d.col(color)), k.outline(line, d.col(ink)),
    ]);
  }

  /** big ribbon banner across the screen (event text, round, endspurt...). Resolves when it is gone. */
  async function banner(msg, { sub, color = '#ffb400', size = 54, hold, y = 0.3, tilt = -1.5, textColor = '#ffffff' } = {}) {
    const wrap = W - 220;
    const f = k.formatText({ text: msg, size, width: wrap, align: 'center' });
    const sf = sub ? k.formatText({ text: sub, size: Math.round(size * 0.5), width: wrap, align: 'center' }) : null;
    const h = f.height + (sf ? sf.height + 12 : 0) + 50;
    const c = ui.add([k.pos(W / 2, H * y), k.scale(0.2, 0.2), k.rotate(tilt)]);
    c.add([k.pos(0, 10), k.rect(W + 60, h, { radius: 0 }), k.color(0, 0, 0), k.opacity(0.35), k.anchor('center')]);
    c.add([k.rect(W + 60, h), k.color(d.col(color)), k.outline(8, d.col(INK)), k.anchor('center')]);
    const top = -h / 2 + 25;
    text(c, msg, size, { pos: [0, top + f.height / 2], color: textColor, width: wrap });
    if (sf) text(c, sub, Math.round(size * 0.5), { pos: [0, top + f.height + 12 + sf.height / 2], color: '#fff6d6', width: wrap, line: 4 });
    const stay = hold ?? Math.min(3.2, Math.max(1.5, 1.0 + msg.length * 0.03));
    await anim.tween(0.35, (p) => { c.scale = k.vec2(0.2 + 0.8 * p, 0.2 + 0.8 * p); }, anim.ease.easeOutBack);
    await anim.wait(stay);
    await anim.tween(0.22, (p) => { c.scale = k.vec2(1, 1 - p); }, anim.ease.easeInQuad);
    c.destroy();
  }

  /** small pill near the top, e.g. "Anna ist dran" */
  async function chip(msg, color, hold = 1.0) {
    const f = k.formatText({ text: msg, size: 28 });
    const w = f.width + 70;
    const c = ui.add([k.pos(W / 2, -60), k.scale(1)]);
    c.add([k.rect(w, 52, { radius: 26 }), k.color(d.col(INK)), k.outline(5, d.col(color)), k.anchor('center')]);
    c.add([k.pos(-w / 2 + 28, 0), k.circle(11), k.color(d.col(color)), k.anchor('center')]);
    text(c, msg, 28, { pos: [14, 1], line: 0 });
    await anim.tween(0.3, (p) => { c.pos = k.vec2(W / 2, -60 + 180 * p); }, anim.ease.easeOutBack);   // ends at y=120: below the DOM HUD strip
    await anim.wait(hold);
    await anim.tween(0.25, (p) => { c.pos = k.vec2(W / 2, 120 - 180 * p); }, anim.ease.easeInQuad);
    c.destroy();
  }

  function flash(color = '#ffffff', alpha = 0.6, dur = 0.4) {
    const o = ui.add([k.pos(0, 0), k.rect(W, H), k.color(d.col(color)), k.opacity(alpha)]);
    return anim.tween(dur, (p) => { o.opacity = alpha * (1 - p); }).then(() => o.destroy());
  }

  /** chunky tumbling dice (d10 faces are just big numbers). values = dice.length 1..2 */
  async function dice(values, color = '#ffffff') {
    const size = 150;
    const dy = H * 0.42;
    const xs = values.length === 1 ? [W / 2] : [W / 2 - 100, W / 2 + 100];
    const objs = values.map((v, i) => {
      const o = ui.add([k.pos(xs[i], -200), k.rotate(0), k.scale(1)]);
      o.add([k.pos(8, 12), k.rect(size, size, { radius: 28 }), k.color(0, 0, 0), k.opacity(0.35), k.anchor('center')]);
      o.add([k.rect(size, size, { radius: 28 }), k.color(255, 255, 255), k.outline(9, d.col(color)), k.anchor('center')]);
      o.add([k.pos(-size / 2 + 18, -size / 2 + 18), k.circle(7), k.color(d.col(color)), k.anchor('center')]);
      const label = o.add([k.text('?', { size: 96 }), k.color(d.col(INK)), k.anchor('center')]);
      return { o, label, v, i };
    });
    audio.sfx('diceRoll');
    let lastFlip = 0;
    await anim.tween(1.0, (p, raw) => {
      for (const { o, label, i } of objs) {
        const bounce = Math.abs(Math.sin(raw * Math.PI * 3)) * (1 - raw) * 160;
        o.pos = k.vec2(xs[i] + Math.sin(raw * 9 + i) * 24 * (1 - raw), -200 + (dy + 200) * Math.min(1, raw * 3) - bounce);
        o.angle = (1 - p) * (720 + i * 180) * (i % 2 ? -1 : 1);
        if (raw - lastFlip > 0.06) { label.text = String(1 + Math.floor(Math.random() * 10)); }
      }
      if (raw - lastFlip > 0.06) lastFlip = raw;
    }, anim.ease.easeOutCubic);
    audio.sfx('diceLand');
    scene.cam.shake(8, 0.25);
    for (const { o, label, v } of objs) {
      label.text = String(v);
      o.pos = k.vec2(o.pos.x, dy);
      o.angle = 0;
    }
    await anim.tween(0.3, (p) => { for (const { o } of objs) o.scale = k.vec2(1 + 0.4 * (1 - p), 1 + 0.4 * (1 - p)); }, anim.ease.easeOutBack);
    if (values.length > 1) {
      const sum = ui.add([k.pos(W / 2, dy + 130), k.anchor('center'), k.text(`= ${values.reduce((a, b) => a + b, 0)}`, { size: 54 }), k.color(255, 255, 255), k.outline(7, d.col(INK))]);
      await anim.wait(0.6);
      sum.destroy();
    } else await anim.wait(0.45);
    await anim.tween(0.25, (p) => { for (const { o } of objs) { o.scale = k.vec2(1 - p, 1 - p); o.pos = k.vec2(o.pos.x, dy - 120 * p); } }, anim.ease.easeInQuad);
    for (const { o } of objs) o.destroy();
  }

  /** world-space confetti rain starting at a point */
  function confetti(at, n = 40) {
    const colors = ['#ff5a5f', '#ffb400', '#8ce99a', '#4dabf7', '#b197fc', '#ff8fd0'];
    const ps = Array.from({ length: n }, (_, i) => {
      const o = scene.fxLayer.add([k.pos(at.x, at.y), k.rect(12, 18), k.color(d.col(colors[i % colors.length])), k.rotate(0), k.anchor('center')]);
      return { o, vx: (Math.random() - 0.5) * 520, vy: -300 - Math.random() * 380, vr: (Math.random() - 0.5) * 900 };
    });
    let t = 0;
    return anim.tween(2.2, (_, raw) => {
      const dt = raw * 2.2 - t; t = raw * 2.2;
      for (const p of ps) {
        p.vy += 700 * dt;
        p.o.pos = k.vec2(p.o.pos.x + p.vx * dt, p.o.pos.y + p.vy * dt);
        p.o.angle += p.vr * dt;
      }
    }).then(() => ps.forEach((p) => p.o.destroy()));
  }

  return { text, banner, chip, flash, dice, confetti };
}
