// Döner mit alles: Kaplay client (main lane + thumbnail). Orders, serving check and scoring live in order.js.
import { createRng } from '../../contracts.js';
import { textOpts } from '../font.js';
import { box, disc, label, setText, ease, addHint } from '../draw.js';
import lines from './lines.js';
import { HINT } from '../../ui/glyphs.js';
import { ING, KEYS, DURATION_MS, WRONG_LOCK_MS, OK_LOCK_MS, makeOrders, emptyWrap, addIngredient, matches, firstMistake, speedBonus, scoreOf } from './order.js';

const INK = '#1b2a49';
const CUST_X = 160, CUST_Y = 252;
const PLATE = { x: 200, y: 520 };
const SPOTS = {   // emoji positions on the flatbread (relative to its centre), a second Fleisch lies in front of the first
  fleisch: [[-92, 2], [-70, 24]], salat: [[-40, -14]], tomate: [[-2, -16]], zwiebel: [[38, -12]], sosse: [[78, 2]], scharf: [[8, 24]],
};
// one tile per ingredient: how to add it
const TILE_HINT = {
  fleisch: '{key:E} / {X} / {Y}', salat: '{key:W} / {DPAD} hoch', tomate: '{key:S} / {DPAD} runter',
  zwiebel: '{key:A} / {DPAD} links', sosse: '{key:D} / {DPAD} rechts', scharf: HINT.mgBack,
};
const MOOD = { neutral: 0, happy: 1, angry: 2 };

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
/** Kaplay 3001 has no ellipse component: a squashed circle (components to spread into an add([...]) list) */
const oval = (k, rx, ry) => [k.circle(rx), k.scale(1, ry / rx)];

/** a goofy customer blob; colour and mood are set from outside. Returns {obj, setColor, setMood, bounce, tick(dt)} */
function buildCustomer(k, parent, x, y, size) {
  const r = size / 2, ink = k.rgb(30, 30, 40);
  const obj = parent.add([k.pos(x, y)]);
  const body = obj.add([k.pos(0, 0), k.scale(1, 1), k.rotate(0)]);
  const skin = body.add([k.circle(r), k.color(k.rgb('#cccccc')), k.outline(Math.max(3, size / 16), ink), k.anchor('center')]);
  const blush = body.add([k.circle(r), k.color(k.rgb('#ff2a2a')), k.opacity(0), k.anchor('center')]);
  const pupils = [-1, 1].map((s) => {
    const eye = body.add([k.pos(s * r * 0.36, -r * 0.1), k.circle(r * 0.28), k.color(255, 255, 255), k.outline(Math.max(1.5, size / 32), ink), k.anchor('center')]);
    return eye.add([k.pos(r * 0.08, 0), k.circle(r * 0.13), k.color(ink), k.anchor('center')]);
  });
  const brows = [-1, 1].map((s) => body.add([k.pos(s * r * 0.38, -r * 0.5), k.rect(r * 0.5, r * 0.11, { radius: r * 0.05 }), k.color(ink), k.rotate(s * -26), k.opacity(0), k.anchor('center')]));
  const mouth = body.add([k.pos(0, r * 0.4), k.rect(r * 0.5, r * 0.14, { radius: r * 0.07 }), k.color(ink), k.anchor('center')]);
  const grin = body.add([k.pos(0, r * 0.38), ...oval(k, r * 0.34, r * 0.24), k.color(ink), k.opacity(0), k.anchor('center')]);
  const tongue = body.add([k.pos(0, r * 0.48), ...oval(k, r * 0.17, r * 0.1), k.color(k.rgb('#ff6f91')), k.opacity(0), k.anchor('center')]);
  let mood = 0, hop = 0, t = 0;
  return {
    obj,
    setColor(hex) { skin.color = k.rgb(hex); },
    setMood(m) {
      mood = m;
      blush.opacity = m === MOOD.angry ? 0.38 : 0;
      brows.forEach((b) => { b.opacity = m === MOOD.angry ? 1 : 0; });
      mouth.opacity = m === MOOD.happy ? 0 : 1;
      mouth.pos = k.vec2(0, r * (m === MOOD.angry ? 0.5 : 0.4));
      mouth.width = r * (m === MOOD.angry ? 0.42 : 0.5);
      grin.opacity = tongue.opacity = m === MOOD.happy ? 1 : 0;
    },
    bounce() { hop = 0.35; },
    tick(dt) {
      t += dt;
      let sx = 1 + Math.sin(t * 3) * 0.04, sy = 1 - Math.sin(t * 3) * 0.04, lift = 0;
      if (hop > 0) { hop = Math.max(0, hop - dt); const h = Math.sin((1 - hop / 0.35) * Math.PI); lift = -h * r * 0.5; sx = 1 - h * 0.12; sy = 1 + h * 0.18; }
      const shake = mood === MOOD.angry ? Math.sin(t * 60) * 3 : 0;
      body.scale = k.vec2(sx, sy);
      body.pos = k.vec2(shake, lift + (1 - sy) * r);
      body.angle = Math.sin(t * 2) * 3;
      for (const p of pupils) p.pos = k.vec2(r * 0.08, r * 0.03 * Math.sin(t * 5));
    },
  };
}

/** the flatbread with the ingredients lying on it. Returns {obj, set(counts), tick(dt)} */
function buildPlate(k, parent, x, y, sc) {
  const obj = parent.add([k.pos(x, y), k.scale(sc)]);
  obj.add([k.pos(0, 16), ...oval(k, 152, 60), k.color(k.rgb('#000000')), k.opacity(0.28), k.anchor('center')]);
  obj.add([k.pos(0, 0), ...oval(k, 150, 62), k.color(k.rgb('#d9a35a')), k.outline(4, k.rgb('#5b3d22')), k.anchor('center')]);
  obj.add([k.pos(0, -2), ...oval(k, 128, 48), k.color(k.rgb('#f2cf8f')), k.anchor('center')]);
  const parts = [];
  for (const ing of ING) {
    SPOTS[ing.key].forEach(([dx, dy], idx) => {
      const o = obj.add([k.pos(dx, dy), k.text(ing.emoji, textOpts(k, 50)), k.color(255, 255, 255), k.anchor('center'), k.opacity(0), k.scale(1)]);
      parts.push({ key: ing.key, idx, o, on: false, age: 9 });
    });
  }
  return {
    obj,
    set(counts) {
      for (const p of parts) {
        const on = (counts[p.key] ?? 0) > p.idx;
        if (on && !p.on) p.age = 0;
        p.on = on;
        p.o.opacity = on ? 1 : 0;
      }
    },
    tick(dt) { for (const p of parts) { p.age += dt; p.o.scale = k.vec2(1 + Math.max(0, 0.6 * (1 - p.age / 0.18))); } },
  };
}

function awning(k, root) {
  for (let i = 0; i < 12; i++) {
    const c = i % 2 ? '#fff6e6' : '#d9442c';
    box(k, root, i * 80, 0, 80, 72, c);
    root.add([k.pos(i * 80 + 40, 72), ...oval(k, 40, 20), k.color(k.rgb(c)), k.anchor('center')]);
  }
  box(k, root, 0, 0, 960, 6, '#7a1f10');
}

export function mountDoener(ctx) {
  const { k, root, input, audio } = ctx;
  const thumb = ctx.view === 'thumb';
  const profile = ctx.seats.find((s) => s.index === ctx.seat)?.profile ?? { name: '?', color: '#ffb400', hat: 'none' };
  const orders = makeOrders(ctx.rng);
  const botRng = createRng(((ctx.seed ^ Math.imul(ctx.selfSeat + 1, 0x9E3779B1)) >>> 0) || 1);
  const bot = { next: 0, seen: -1, slow: 1 + botRng.next() * 0.8 };

  // ---- backdrop ----
  box(k, root, 0, 0, 960, 720, '#f3e2bd');
  for (let i = 0; i < 8; i++) for (let j = 0; j < 3; j++) box(k, root, 6 + i * 120, 100 + j * 76, 108, 64, '#ecd6a6', { radius: 6 });   // wall tiles
  awning(k, root);
  const cust = buildCustomer(k, root, CUST_X, CUST_Y, thumb ? 220 : 150);
  if (thumb) cust.obj.pos = k.vec2(220, 225);
  box(k, root, 0, 336, 960, 14, '#b57a3c');
  box(k, root, 0, 350, 960, 370, '#2e3444');
  box(k, root, 0, 350, 960, 6, '#11131a');

  // ---- state ----
  let phase = 'wait';   // wait | play | done   (thumb: only 'play' and 'done' are mirrored)
  let idx = 0, served = 0, bonus = 0, elapsed = 0, orderMs = 0, lock = 0, lockKind = '', enterT = 0, finished = false;
  let mood = MOOD.neutral, sayAt = -99999, lastKey = '', flyT = 0, shakeT = 0, plusAge = 9, plusStr = '';
  const wrap = emptyWrap();
  let remote = { n: 0, i: 0, w: emptyWrap(), m: 0, d: 0 };
  let thumbIdx = -1;

  // ---- the plate (both views) ----
  const plate = buildPlate(k, root, thumb ? 500 : PLATE.x, thumb ? 590 : PLATE.y, thumb ? 1.55 : 1);

  function say(text, minGap = 2600) {
    if (performance.now() - sayAt < minGap) return;
    sayAt = performance.now();
    audio.say(text);
  }

  if (thumb) {
    // ---- thumbnail: the served count and a mini wrap ----
    const big = label(k, root, '0', 700, 250, { size: 230, color: '#ffd43b', outline: [10, '#7a1f10'] });
    label(k, root, 'Döner', 700, 400, { size: 80, outline: [6, INK] });
    box(k, root, 0, 0, 960, 6, '#7a1f10');
    const chk = label(k, root, '', 480, 690, { size: 40, color: '#ffffff', outline: [5, INK] });
    root.onUpdate(() => {
      const dt = k.dt();
      if (remote.i !== thumbIdx) { thumbIdx = remote.i; enterT = 0; cust.setColor(orders[Math.min(thumbIdx, orders.length - 1)].color); }
      enterT += dt;
      cust.setMood(remote.m);
      cust.obj.pos = k.vec2(220 - (1 - Math.min(1, enterT / 0.35)) ** 3 * 300, 225);
      setText(big, String(remote.n));
      setText(chk, remote.d ? 'Feierabend!' : '');
      plate.set(remote.w);
      plate.tick(dt);
      cust.tick(dt);
    });
    cust.setColor(orders[0].color);
    return {
      go() {},
      update(p) { if (p && typeof p === 'object') remote = { n: p.n ?? 0, i: p.i ?? 0, w: { ...emptyWrap(), ...(p.w ?? {}) }, m: p.m ?? 0, d: p.d ?? 0 }; },
      botInput: () => ({}),
      destroy() {},
    };
  }

  // ---- main lane: HUD ----
  box(k, root, 300, 12, 360, 50, INK, { radius: 10, outline: [3, '#ffd43b'] });
  label(k, root, 'DÖNER MIT ALLES', 480, 38, { size: 32, color: '#ffd43b' });
  box(k, root, 14, 14, 230, 46, INK, { radius: 10, outline: [3, '#ffffff'] });
  const servedTxt = label(k, root, 'Serviert: 0', 129, 38, { size: 26 });
  box(k, root, 716, 14, 230, 46, INK, { radius: 10, outline: [3, '#ffffff'] });
  const timeTxt = label(k, root, 'Zeit 35 s', 831, 38, { size: 26 });
  box(k, root, 0, 98, 960, 12, '#000000', { opacity: 0.25 });
  const timeBar = box(k, root, 0, 98, 960, 12, '#8ce99a');

  // ---- speech bubble with the order ----
  const BX = 280, BY = 124, BW = 650, BH = 190;
  const bubbleObj = root.add([k.pos(0, 0)]);
  const tailPts = (d) => [k.vec2(BX + 2 * d, 196 + d * 6), k.vec2(BX + 2 * d, 244 - d * 6), k.vec2(BX - 46 + 3 * d, 238 - d)];
  bubbleObj.add([k.polygon(tailPts(0)), k.color(k.rgb(INK))]);
  box(k, bubbleObj, BX, BY, BW, BH, '#ffffff', { radius: 18, outline: [4, INK] });
  bubbleObj.add([k.polygon(tailPts(5)), k.color(k.rgb('#ffffff'))]);
  const orderTxt = label(k, bubbleObj, 'Kunde kommt gleich…', BX + BW / 2, BY + 52, { size: 30, color: INK, width: BW - 40, align: 'center' });
  const tilesObj = bubbleObj.add([k.pos(0, 0)]);
  const tiles = ING.map((ing) => {
    const t = tilesObj.add([k.pos(0, BY + 134), k.scale(1)]);
    const bg = box(k, t, 0, 0, 74, 74, '#fff6df', { anchor: 'center', radius: 10, outline: [3, INK] });
    t.add([k.pos(0, 2), k.text(ing.emoji, textOpts(k, 42)), k.color(255, 255, 255), k.anchor('center')]);
    const times = label(k, t, '×2', 26, 28, { size: 22, color: '#d9442c', outline: [3, '#ffffff'] });
    times.opacity = 0;
    const ok = t.add([k.pos(26, -28), k.text('✅', textOpts(k, 24)), k.color(255, 255, 255), k.anchor('center'), k.opacity(0)]);
    return { key: ing.key, t, bg, times, ok };
  });
  tilesObj.hidden = true;

  function layoutTiles() {
    const shown = tiles.filter((x) => orders[idx].items[x.key] > 0);
    tiles.forEach((x) => { x.t.hidden = true; });
    shown.forEach((x, i) => {
      x.t.hidden = false;
      x.t.pos = k.vec2(BX + BW / 2 + (i - (shown.length - 1) / 2) * 88, BY + 134);
      x.times.opacity = orders[idx].items[x.key] > 1 ? 1 : 0;
    });
  }

  // ---- ingredient tiles (the key map) ----
  const mapTiles = {};
  ING.forEach((ing, i) => {
    const cx = 364 + (i % 3) * 196 + 92, cy = 396 + Math.floor(i / 3) * 124 + 56;
    const t = root.add([k.pos(cx, cy), k.scale(1)]);
    const bg = box(k, t, 0, 0, 184, 112, '#eef1f6', { anchor: 'center', radius: 12, outline: [3, '#11131a'] });
    t.add([k.pos(-52, -10), k.text(ing.emoji, textOpts(k, 56)), k.color(255, 255, 255), k.anchor('center')]);
    label(k, t, ing.name, -14, -24, { size: 24, color: INK, anchor: 'left' });
    addHint(k, t, TILE_HINT[ing.key], -82, 34, { size: 16, anchor: 'left', color: INK });
    const badge = disc(k, t, 70, 12, 15, '#d9442c', { outline: [3, '#ffffff'] });
    const badgeTxt = label(k, t, '1', 70, 12, { size: 20 });
    badge.opacity = 0; badgeTxt.opacity = 0;
    mapTiles[ing.key] = { t, bg, badge, badgeTxt, pulse: 0 };
  });

  label(k, root, 'Dein Döner', 230, 600, { size: 22, color: '#cfd6e6' });
  const stamp = label(k, root, 'NEU MACHEN!', PLATE.x, PLATE.y, { size: 38, color: '#ff5a4a', outline: [6, '#ffffff'], angle: -8, opacity: 0 });
  const plusTxt = label(k, root, '', CUST_X, 170, { size: 40, color: '#ffd43b', outline: [5, INK], opacity: 0 });
  const mark = label(k, root, '💢', CUST_X + 52, 178, { size: 44, opacity: 0 });
  const endTxt = label(k, root, '', 480, 560, { size: 56, color: '#ffd43b', outline: [8, INK], opacity: 0 });
  addHint(k, root, '{key:Enter} / {key:Leertaste} / {A} Servieren', 600, 690, { size: 22, outline: [3, '#11131a'] });
  const av = ctx.addAvatar(profile, { size: 64, showName: true });
  av.pos = k.vec2(100, 650);

  cust.setColor(orders[0].color);

  // ---- game logic ----
  function newOrder() {
    idx = Math.min(idx + 1, orders.length - 1);
    startOrder();
  }

  function startOrder() {
    Object.assign(wrap, emptyWrap());
    orderMs = 0; enterT = 0; mood = MOOD.neutral; lock = 0; lockKind = '';
    cust.setColor(orders[idx].color); cust.setMood(mood);
    setText(orderTxt, orders[idx].text);
    orderTxt.color = k.rgb(INK);
    tilesObj.hidden = false;
    layoutTiles();
    const o = orders[idx];
    if (idx === 0 || Math.random() < 0.3) say(o.items.scharf && Math.random() < 0.6 ? 'Mit scharf?' : /alles/.test(o.text) ? 'Einmal mit alles?' : pick(lines.start), idx === 0 ? 0 : 5000);
  }

  function press(key) {
    const before = wrap[key];
    addIngredient(wrap, key);
    mapTiles[key].pulse = 0.18;
    audio.sfx(wrap[key] > before ? 'tick' : 'whoosh', { rate: 0.85 + KEYS.indexOf(key) * 0.1, volume: 0.6 });
  }

  function serve() {
    if (!KEYS.some((q) => wrap[q] > 0)) return;   // nothing on the bread yet
    if (matches(wrap, orders[idx])) {
      served++;
      const b = speedBonus(orderMs);
      bonus += b;
      plusStr = `+${b + 100}`; plusAge = 0;
      mood = MOOD.happy; cust.setMood(mood); cust.bounce(); av.bounce();
      lock = OK_LOCK_MS; lockKind = 'ok'; flyT = 0;
      audio.sfx('coinGain', { rate: 1 + Math.min(0.5, served * 0.04) });
      audio.sfx('stamp', { volume: 0.5 });
      if (Math.random() < 0.2) say(pick(lines.happy), 6000);
    } else {
      const m = firstMistake(wrap, orders[idx]);
      const text = pick(lines[(m.over ? 'wrong' : 'miss') + m.key[0].toUpperCase() + m.key.slice(1)]);
      mood = MOOD.angry; cust.setMood(mood);
      lock = WRONG_LOCK_MS; lockKind = 'bad'; shakeT = 0;
      setText(orderTxt, text);
      orderTxt.color = k.rgb('#c0301f');
      tilesObj.hidden = true;
      say(text, 1500);
      audio.sfx('error'); audio.sfx('bump', { volume: 0.7 });
    }
  }

  function finishNow() {
    if (finished) return;
    finished = true; phase = 'done';
    cust.setMood(MOOD.happy);
    tilesObj.hidden = true;
    setText(orderTxt, `Feierabend! ${served} Döner raus.`);
    orderTxt.color = k.rgb(INK);
    ctx.finish({ score: scoreOf(served, bonus), label: `${served} Döner` });
    say(served >= 7 ? pick(lines.win) : pick(lines.lose), 0);
  }

  function progress() {
    const key = `${served}|${idx}|${KEYS.map((q) => wrap[q]).join('')}|${mood}|${finished}`;
    if (key === lastKey) return;
    lastKey = key;
    ctx.sendProgress({ n: served, i: idx, w: { ...wrap }, m: mood, d: finished ? 1 : 0 });
  }

  root.onUpdate(() => {
    const dt = k.dt();
    if (phase === 'play') {
      elapsed += dt * 1000;
      orderMs += dt * 1000;
      if (lock > 0) {
        lock -= dt * 1000;
        if (lock <= 0) { if (lockKind === 'ok') newOrder(); else startOrder(); }
      } else {
        for (const [act, key] of [['action', 'fleisch'], ['back', 'scharf']]) if (input.pressed(act)) press(key);
        for (const [dir, key] of [['up', 'salat'], ['down', 'tomate'], ['left', 'zwiebel'], ['right', 'sosse']]) if (input.pressedDir(dir)) press(key);
        if (input.pressed('confirm')) serve();
      }
      if (elapsed >= DURATION_MS - 250) finishNow();
    }

    // ---- drawing ----
    const left = Math.max(0, DURATION_MS - elapsed);
    setText(servedTxt, `Serviert: ${served}`);
    setText(timeTxt, `Zeit ${Math.ceil(left / 1000)} s`);
    timeBar.width = 960 * (left / DURATION_MS);
    timeBar.color = k.rgb(left < 8000 ? '#ff5a4a' : '#8ce99a');
    enterT += dt;
    const e = Math.min(1, enterT / 0.35);
    cust.obj.pos = k.vec2(CUST_X - (1 - e) ** 3 * 300 + (mood === MOOD.angry ? Math.sin(enterT * 50) * 3 : 0), CUST_Y);
    cust.tick(dt);
    plate.set(wrap);
    plate.tick(dt);
    if (orders[idx]) {
      for (const x of tiles) {
        const sat = wrap[x.key] === orders[idx].items[x.key] && phase === 'play';
        x.ok.opacity = sat ? 1 : 0;
        x.bg.color = k.rgb(sat ? '#d7f5d0' : '#fff6df');
      }
    }
    for (const ing of ING) {
      const m = mapTiles[ing.key], c = wrap[ing.key];
      m.pulse = Math.max(0, m.pulse - dt);
      m.t.scale = k.vec2(1 + m.pulse * 1.2);
      m.bg.color = k.rgb(c > 0 ? '#fff2b8' : '#eef1f6');
      m.badge.opacity = m.badgeTxt.opacity = ing.max > 1 && c > 0 ? 1 : 0;
      setText(m.badgeTxt, String(c));
    }
    // plate: flies to the customer on a correct serve, rattles on a wrong one
    let px = PLATE.x, py = PLATE.y, ps = 1;
    if (lock > 0 && lockKind === 'ok') {
      flyT += dt;
      const f = Math.min(1, flyT / (OK_LOCK_MS / 1000));
      px = PLATE.x + (CUST_X + 30 - PLATE.x) * f; py = PLATE.y + (CUST_Y + 40 - PLATE.y) * f - Math.sin(f * Math.PI) * 60; ps = 1 - 0.55 * f;
    } else if (lock > 0 && lockKind === 'bad') {
      shakeT += dt;
      px += Math.sin(shakeT * 60) * 6;
    }
    plate.obj.pos = k.vec2(px, py); plate.obj.scale = k.vec2(ps);
    stamp.opacity = lock > 0 && lockKind === 'bad' ? 1 : 0;
    mark.opacity = mood === MOOD.angry ? 1 : 0;
    mark.pos = k.vec2(CUST_X + 52 + Math.sin(enterT * 30) * 2, 178);
    plusAge += dt;
    plusTxt.opacity = plusAge < 0.9 ? 1 : 0;
    setText(plusTxt, plusStr);
    plusTxt.pos = k.vec2(CUST_X, 170 - plusAge * 40);
    endTxt.opacity = phase === 'done' ? 1 : 0;
    setText(endTxt, `FEIERABEND!`);
    if (phase === 'play') progress();
    else if (phase === 'done') progress();
  });

  return {
    go() {
      if (phase !== 'wait') return;
      phase = 'play';
      input.takeFrame?.();
      startOrder();
    },
    update() {},
    botInput() {
      if (phase !== 'play' || lock > 0) return {};
      if (bot.seen !== idx) { bot.seen = idx; bot.next = elapsed + (650 + botRng.next() * 650) * bot.slow; }   // reads the order
      if (elapsed < bot.next) return {};
      bot.next = elapsed + (230 + botRng.next() * 330) * bot.slow;   // pause between two presses
      const target = orders[idx].items;
      const diff = KEYS.filter((q) => wrap[q] !== target[q]);
      if (!diff.length) return { confirm: true };
      if (botRng.next() < 0.03) return { confirm: true };   // jumps the gun: serves a wrong wrap
      const key = botRng.next() < 0.06 ? botRng.pick(KEYS) : botRng.pick(diff);   // sometimes grabs the wrong thing (fixable by pressing it again)
      switch (key) {
        case 'fleisch': return { action: true };
        case 'scharf': return { back: true };
        case 'salat': return { move: { x: 0, y: -1 } };
        case 'tomate': return { move: { x: 0, y: 1 } };
        case 'zwiebel': return { move: { x: -1, y: 0 } };
        default: return { move: { x: 1, y: 0 } };
      }
    },
    destroy() {},   // everything hangs off root (the runner destroys it)
  };
}
