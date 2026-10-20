// Goofy blob avatar (D17): everything drawn with Kaplay shapes/text. Uses only the passed `k` (global:false).

const HAT_EMOJI = { cap: '🧢', cowboy: '👒', crown: '👑', tophat: '🎩' };

/**
 * @param k        kaplay instance
 * @param parent   GameObj/scene root to attach to; the caller positions (`av.pos = ...`) and destroys it (`av.destroy()` also removes the children)
 * @param profile  PlayerProfile {playerId, name, color (PLAYER_COLORS), hat (HATS)}
 * @param opts     {size = 48 (body diameter in px), showName = false}
 * @returns GameObj (pos at the blob centre) plus helpers:
 *   av.setFacing(dir)  dir -1 = looks left, 1 = looks right (pupils + tilt)
 *   av.bounce()        one squash-and-stretch hop (call when the player jumps / moves a tile)
 */
export function addAvatar(k, parent, profile, { size = 48, showName = false } = {}) {
  const r = size / 2;
  const ink = k.rgb(30, 30, 40);
  let facing = 1;
  let hop = 0; // seconds of bounce left
  const phase = [...String(profile.playerId ?? profile.name ?? '')].reduce((s, c) => s + c.charCodeAt(0), 0) % 7;

  const av = parent.add([k.pos(0, 0), k.anchor('center')]);
  const body = av.add([k.pos(0, 0), k.scale(1, 1), k.rotate(0)]);

  body.add([k.circle(r), k.color(k.Color.fromHex(profile.color)), k.outline(Math.max(2, size / 16), ink), k.anchor('center')]);
  // googly eyes
  const pupils = [-1, 1].map((s) => {
    const eye = body.add([k.pos(s * r * 0.36, -r * 0.1), k.circle(r * 0.28), k.color(255, 255, 255), k.outline(Math.max(1, size / 32), ink), k.anchor('center')]);
    return eye.add([k.pos(r * 0.08, 0), k.circle(r * 0.13), k.color(ink), k.anchor('center')]);
  });
  // grin
  body.add([k.pos(0, r * 0.38), k.rect(r * 0.5, r * 0.14, { radius: r * 0.07 }), k.color(ink), k.anchor('center')]);

  addHat(k, body, profile.hat, r, ink);

  if (showName) {
    av.add([k.pos(0, r + 4), k.text(profile.name ?? '', { size: Math.max(12, size * 0.32) }), k.color(255, 255, 255), k.outline(3, ink), k.anchor('top')]);
  }

  av.onUpdate(() => {
    const t = k.time() + phase;
    let sx = 1 + Math.sin(t * 3) * 0.04, sy = 1 - Math.sin(t * 3) * 0.04, lift = 0;
    if (hop > 0) {
      hop = Math.max(0, hop - k.dt());
      const p = 1 - hop / 0.35; // 0..1
      const h = Math.sin(p * Math.PI);
      lift = -h * r * 0.8;
      sx = 1 - h * 0.15; sy = 1 + h * 0.2;
    }
    body.scale = k.vec2(sx, sy);
    body.pos = k.vec2(0, lift + (1 - sy) * r);
    body.angle = Math.sin(t * 2) * 3 + facing * 3;
    const px = r * 0.08 * facing;
    for (const p of pupils) p.pos = k.vec2(px, r * 0.03 * Math.sin(t * 5));
  });

  av.setFacing = (dir) => { facing = dir < 0 ? -1 : 1; };
  av.bounce = () => { hop = 0.35; };
  return av;
}

function addHat(k, body, hat, r, ink) {
  const top = -r * 0.92;
  const outline = k.outline(2, ink);
  if (HAT_EMOJI[hat]) {
    body.add([k.pos(0, top), k.text(HAT_EMOJI[hat], { size: r * 1.1 }), k.anchor('bot')]);
  } else if (hat === 'party') {
    body.add([k.pos(0, top), k.polygon([k.vec2(-r * 0.4, 0), k.vec2(r * 0.4, 0), k.vec2(0, -r * 0.9)]), k.color(255, 90, 200), outline, k.rotate(8)]);
    body.add([k.pos(0, top - r * 0.9), k.circle(r * 0.12), k.color(255, 230, 80), k.anchor('center')]);
  } else if (hat === 'beanie') {
    body.add([k.pos(0, top + r * 0.1), k.rect(r * 1.1, r * 0.5, { radius: r * 0.25 }), k.color(60, 90, 200), outline, k.anchor('bot')]);
    body.add([k.pos(0, top - r * 0.42), k.circle(r * 0.16), k.color(255, 255, 255), outline, k.anchor('center')]);
  } else if (hat === 'propeller') {
    body.add([k.pos(0, top + r * 0.1), k.rect(r * 0.9, r * 0.35, { radius: r * 0.17 }), k.color(230, 60, 60), outline, k.anchor('bot')]);
    const blade = body.add([k.pos(0, top - r * 0.38), k.rect(r * 1.0, r * 0.1), k.color(255, 214, 59), outline, k.anchor('center'), k.scale(1)]);
    blade.onUpdate(() => { blade.scale = k.vec2(Math.cos(k.time() * 20), 1); });
  }
  // 'none': bare blob
}
