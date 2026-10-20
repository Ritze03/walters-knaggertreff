// In-board prompts for the local player: roll (+ item use, target pick, trap placement), path, star, shop. Plus the "<Name> ist dran…" label.
// Driven only by input.onNav (keyboard + gamepad both arrive as NavEvents) and sends PlayerIntents through session.sendIntent.
import { ITEM, ITEM_INFO, MAX_ITEMS } from '../contracts.js';
import { makeDraw } from './draw.js';
import { addHint } from '../minigames/hint.js';
import { HINT } from '../ui/glyphs.js';
import { previewPath } from '../core/preview.js';   // the SAME step counting as the engine's walk()

const PICK = `${HINT.move} wählen`;

const INK = '#2a2340';
const CARD_W = 184, CARD_H = 130, GAP = 14;

export function createPrompts({ k, ui, scene, anim, audio, session, fx }) {
  const { W, H } = scene;
  const d = makeDraw(k);
  const prompts = { menu: null, key: null, label: null, armedAt: 0, lockedUntil: 0, state: null, seat: -1 };
  const now = () => k.time();
  const send = (intent) => { prompts.lockedUntil = now() + 0.6; session.sendIntent(intent); };

  // ---------------- generic card menu ----------------
  /** cards: [{emoji, name, sub, disabled, detail}] ; returns handle */
  function openMenu({ title, cards, sel = 0, hint, onPick, onBack, onSel }) {
    const root = ui.add([k.pos(W / 2, H + 200)]);
    const totalW = cards.length * CARD_W + (cards.length - 1) * GAP;
    root.add([k.pos(0, 0), k.rect(Math.max(totalW + 70, 640), 270, { radius: 28 }), k.color(d.col(INK)), k.opacity(0.9), k.outline(5, d.col('#ffffff')), k.anchor('center')]);
    fx.text(root, title, 36, { pos: [0, -100], line: 6 });
    const detail = fx.text(root, '', 22, { pos: [0, 88], color: '#fff2c4', line: 4, width: Math.max(totalW, 600) });
    addHint(k, root, hint, 0, 112, { size: 19, color: '#d4cdf0' });
    const objs = cards.map((c, i) => {
      const x = -totalW / 2 + CARD_W / 2 + i * (CARD_W + GAP);
      const o = root.add([k.pos(x, -8), k.scale(1), k.rotate(0)]);
      const bg = o.add([k.rect(CARD_W, CARD_H, { radius: 20 }), k.color(d.col(c.disabled ? '#8d89a3' : '#f7f1e3')), k.outline(6, d.col(INK)), k.anchor('center')]);
      fx.text(o, c.emoji, 52, { pos: [0, -34], line: 0 });
      fx.text(o, c.name, 20, { pos: [0, 14], color: c.disabled ? '#d8d4e8' : INK, ink: c.disabled ? '#5b5775' : '#f7f1e3', line: 0, width: CARD_W - 12 });
      if (c.sub) fx.text(o, c.sub, 22, { pos: [0, 52], color: c.disabled ? '#d8d4e8' : '#c0392b', ink: '#f7f1e3', line: 0 });
      return { o, bg, scale: 1 };
    });
    const h = { sel: -1, root, closed: false, cards };
    h.setSel = (i) => {
      h.sel = (i + cards.length) % cards.length;
      objs.forEach((c, j) => { c.bg.outline.color = d.col(j === h.sel ? '#ff9f1c' : INK); c.bg.outline.width = j === h.sel ? 10 : 6; });
      detail.text = cards[h.sel].detail ?? '';
      onSel?.(h.sel);
    };
    root.onUpdate(() => {
      const t = k.time();
      objs.forEach((c, j) => {
        const target = j === h.sel ? 1.1 : 1;
        c.scale += (target - c.scale) * (1 - Math.exp(-k.dt() * 18));
        c.o.scale = k.vec2(c.scale, c.scale);
        c.o.angle = j === h.sel ? Math.sin(t * 7) * 2 : 0;
      });
    });
    h.setSel(sel);
    h.nav = (n) => {
      if (n === 'left' || n === 'up') { audio.sfx('menuMove'); h.setSel(h.sel - 1); }
      else if (n === 'right' || n === 'down') { audio.sfx('menuMove'); h.setSel(h.sel + 1); }
      else if (n === 'confirm') {
        if (cards[h.sel].disabled) { audio.sfx('error'); scene.cam.shake(3, 0.15); return; }
        audio.sfx('menuSelect'); onPick(h.sel);
      } else if (n === 'back' && onBack) { audio.sfx('menuBack'); onBack(); }
    };
    h.close = () => { h.closed = true; root.destroy(); };
    anim.tween(0.3, (p) => { root.pos = k.vec2(W / 2, H + 200 - 350 * p); }, anim.ease.easeOutBack);
    return h;
  }

  // ---------------- per-step prompts ----------------
  const info = (item) => ITEM_INFO[item];
  const otherSeats = (st, seat) => st.seats.map((s) => s.index).filter((i) => i !== seat);

  function rollMenu(st, seat, sel = 0) {
    const me = st.players[seat], t = st.turn;
    const cards = [{ emoji: '🎲', name: 'Würfeln!', detail: t.doubleDice ? 'Doppelwürfel ist aktiv: zwei Würfel!' : 'Auf geht\'s!' }];
    for (const item of me.items) {
      let disabled = false, why = '';
      if (item === ITEM.doubleDice && t.doubleDice) { disabled = true; why = ' (schon aktiv)'; }
      if (item === ITEM.steal && !otherSeats(st, seat).some((s) => st.players[s].coins > 0)) { disabled = true; why = ' (alle pleite)'; }
      cards.push({ emoji: info(item).emoji, name: info(item).name, disabled, detail: info(item).blurb + why, item });
    }
    prompts.menu = openMenu({
      title: t.extraRolls > 0 ? 'Du bist dran! (Döner-Wurf wartet)' : 'Du bist dran!', cards, sel,
      hint: me.items.length ? `${PICK}   ${HINT.confirm} bestätigen` : '{key:Enter} / {key:Leertaste} / {A} Würfeln',
      onPick: (i) => {
        const c = cards[i];
        if (!c.item) return send({ type: 'roll' });
        if (c.item === ITEM.steal) return targetMenu(st, seat);
        if (c.item === ITEM.trap) return trapPick(st, seat);
        send({ type: 'useItem', item: c.item });
      },
    });
  }

  function targetMenu(st, seat) {
    prompts.menu?.close();
    const ids = otherSeats(st, seat);
    const cards = ids.map((s) => ({
      emoji: '😈', name: st.seats[s].profile.name, sub: `${st.players[s].coins} 🍾`, disabled: st.players[s].coins <= 0,
      detail: st.players[s].coins <= 0 ? 'Der hat nichts zu klauen.' : `Klau ${st.seats[s].profile.name} bis zu ${st.rules.stealCoins} Pfand.`, seat: s,
    }));
    prompts.menu = openMenu({
      title: '🪙 Wen beklauen?', cards, hint: `${PICK}   ${HINT.confirm} bestätigen   ${HINT.back} zurück`,
      sel: Math.max(0, cards.findIndex((c) => !c.disabled)),
      onPick: (i) => send({ type: 'useItem', item: ITEM.steal, targetSeat: cards[i].seat }),
      onBack: () => { prompts.menu.close(); rollMenu(st, seat, cardIndexOf(st, seat, ITEM.steal)); },
    });
  }

  function trapPick(st, seat) {
    prompts.menu?.close();
    // all valid spaces ordered by distance (BFS) from the player's own space
    const from = st.players[seat].spaceId;
    const byId = scene.spaces;
    const dist = new Map([[from, 0]]);
    const q = [from];
    for (let i = 0; i < q.length; i++) for (const n of byId.get(q[i]).next) if (!dist.has(n)) { dist.set(n, dist.get(q[i]) + 1); q.push(n); }
    const cand = [...byId.values()].filter((s) => s.type !== 'start' && s.type !== 'shop' && st.traps[s.id] === undefined).sort((a, b) => dist.get(a.id) - dist.get(b.id));
    if (!cand.length) { rollMenu(st, seat, 0); return; }
    const cur = { i: 0 };
    const mark = () => {
      const s = cand[cur.i];
      scene.setMarkers([{ x: s.x, y: s.y, sel: true, arrow: true, color: scene.tokens[seat] ? st.seats[seat].profile.color : '#ffe14d', label: s.label ?? 'Hier?' }]);
      scene.cam.look(s.x, s.y, 0.8);
    };
    const h = { closed: false };
    mark();
    h.nav = (n) => {
      if (n === 'left') cur.i = (cur.i - 1 + cand.length) % cand.length;
      else if (n === 'right') cur.i = (cur.i + 1) % cand.length;
      else if (n === 'up') cur.i = Math.min(cand.length - 1, cur.i + 4);
      else if (n === 'down') cur.i = Math.max(0, cur.i - 4);
      else if (n === 'confirm') { audio.sfx('menuSelect'); send({ type: 'useItem', item: ITEM.trap, spaceId: cand[cur.i].id }); return; }
      else if (n === 'back') { audio.sfx('menuBack'); h.close(); rollMenu(st, seat, cardIndexOf(st, seat, ITEM.trap)); return; }
      audio.sfx('menuMove');
      mark();
    };
    // small hint panel
    const hintObj = ui.add([k.pos(W / 2, H - 70)]);
    const trapHint = addHint(k, hintObj, `Falle legen:  ${HINT.move} Feld   {key:↑↓} springen   ${HINT.confirm} legen   ${HINT.back} zurück`, 0, 0, { size: 19 });
    hintObj.add([k.z(-1), k.rect(trapHint.width + 60, 64, { radius: 24 }), k.color(d.col(INK)), k.opacity(0.9), k.outline(5, d.col('#ffffff')), k.anchor('center')]);
    h.close = () => { h.closed = true; hintObj.destroy(); scene.setMarkers([]); scene.cam.follow(st.turn.seat); };
    prompts.menu = h;
  }
  const cardIndexOf = (st, seat, item) => 1 + Math.max(0, st.players[seat].items.indexOf(item));

  function pathMenu(st, seat) {
    const t = st.turn, here = scene.spacePos(st.players[seat].spaceId);
    const opts = t.options;
    const dirs = opts.map((id) => { const p = scene.spacePos(id); const l = Math.hypot(p.x - here.x, p.y - here.y) || 1; return { x: (p.x - here.x) / l, y: (p.y - here.y) / l }; });
    const arrowOf = (v) => ['➡️', '↘️', '⬇️', '↙️', '⬅️', '↖️', '⬆️', '↗️'][Math.round(((Math.atan2(v.y, v.x) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
    const cards = opts.map((id, i) => ({ emoji: arrowOf(dirs[i]), name: scene.decor.pathLabels[id] ?? `Weg ${i + 1}`, detail: `Noch ${t.stepsLeft} Schritte.` }));
    // where each option would end with the remaining steps (core's own counting); a further fork on the way ends the preview there
    const here0 = st.players[seat].spaceId;
    const previews = opts.map((id) => previewPath(scene.board, here0, id, t.stepsLeft));
    const mark = (selIdx) => {
      scene.setMarkers(opts.map((id, i) => { const p = scene.spacePos(id); return { x: p.x, y: p.y, sel: i === selIdx, arrow: true, color: i === selIdx ? '#ffe14d' : '#ffffff', label: cards[i].name }; }));
      const pv = previews[selIdx];
      scene.setPreview({
        route: pv.path.slice(0, -1).map(scene.spacePos), target: scene.spacePos(pv.end), near: pv.path.length <= 1,
        label: pv.landed ? '🎯 hier landest du' : '🎯 Abzweigung →?',
      });
    };
    // the landing tag is ~300px wide: make room for it on both sides of every landing space
    const ends = previews.map((pv) => scene.spacePos(pv.end));
    scene.cam.fit([here, ...opts.map(scene.spacePos), ...ends, ...ends.flatMap((e) => [{ x: e.x - 170, y: e.y }, { x: e.x + 170, y: e.y }])], 120, 0.9);
    const menu = openMenu({
      title: 'Welchen Weg?', cards, hint: `${PICK}   ${HINT.confirm} bestätigen`, sel: 0, onSel: mark,
      onPick: (i) => send({ type: 'choosePath', spaceId: opts[i] }),
    });
    prompts.menu = menu;
    // left/up = previous card, right/down = next card in turn.options order. Clamped (no wrap) so with two roads
    // Left always means the first and Right the second, whichever is highlighted.
    const baseNav = menu.nav;
    menu.nav = (n) => {
      const step = { left: -1, up: -1, right: 1, down: 1 }[n];
      if (!step) return baseNav(n);
      const to = Math.max(0, Math.min(opts.length - 1, menu.sel + step));
      if (to === menu.sel) return;
      audio.sfx('menuMove');
      menu.setSel(to);
    };
    const baseClose = menu.close;
    menu.close = () => { baseClose(); scene.setMarkers([]); scene.setPreview(null); };
  }

  function starMenu(st, seat) {
    const price = st.rules.starPrice, coins = st.players[seat].coins;
    const sp = scene.spacePos(st.players[seat].spaceId);
    scene.cam.look(sp.x, sp.y + 40, 0.95);
    prompts.menu = openMenu({
      title: '⭐ Hier ist ein Stern!', sel: 0, hint: `${PICK}   ${HINT.confirm} bestätigen   ${HINT.back} Nein`,
      cards: [
        { emoji: '⭐', name: 'Kaufen!', sub: `${price} 🍾`, detail: `Du hast ${coins} 🍾. Danach bleiben ${coins - price}.` },
        { emoji: '🙅', name: 'Nein danke', detail: 'Du läufst weiter und hebst dir das Geld auf.' },
      ],
      onPick: (i) => send({ type: 'buyStar', accept: i === 0 }),
      onBack: () => send({ type: 'buyStar', accept: false }),
    });
  }

  function shopMenu(st, seat) {
    const me = st.players[seat];
    const full = me.items.length >= MAX_ITEMS;
    const cards = st.turn.offer.map((o) => {
      const poor = o.price > me.coins;
      return { emoji: info(o.item).emoji, name: info(o.item).name, sub: `${o.price} 🍾`, disabled: poor || full, item: o.item,
        detail: full ? 'Du kannst nur 3 Items tragen!' : poor ? 'Zu wenig Pfand, Kollege.' : info(o.item).blurb };
    });
    cards.push({ emoji: '👋', name: 'Tschüss', detail: `Du hast ${me.coins} 🍾 und ${me.items.length}/${MAX_ITEMS} Items.` });
    const sp = scene.spacePos(me.spaceId);
    scene.cam.look(sp.x, sp.y + 40, 0.95);
    prompts.menu = openMenu({
      title: '🏪 Willkommen im Späti!', cards, sel: Math.max(0, cards.findIndex((c) => !c.disabled)), hint: `${PICK}   ${HINT.confirm} kaufen   ${HINT.back} raus`,
      onPick: (i) => send({ type: 'buyItem', item: cards[i].item ?? null }),
      onBack: () => send({ type: 'buyItem', item: null }),
    });
    audio.say('shopWelcome');
  }

  // ---------------- spectator label ----------------
  function spectatorLabel(st) {
    const t = st.turn;
    const name = st.seats[t.seat].profile.name;
    const msg = { roll: `${name} ist dran…`, path: `${name} sucht den Weg…`, star: `${name} überlegt, ob da ein Stern drin ist…`, shop: `${name} stöbert im Späti…` }[t.step] ?? `${name} ist dran…`;
    const o = ui.add([k.pos(W / 2, H - 52)]);
    const f = k.formatText({ text: msg, size: 28 });
    o.add([k.rect(f.width + 80, 54, { radius: 27 }), k.color(d.col(INK)), k.opacity(0.88), k.outline(5, d.col(st.seats[t.seat].profile.color)), k.anchor('center')]);
    fx.text(o, msg, 28, { line: 0 });
    return { close: () => o.destroy(), nav() {} };
  }

  // ---------------- sync from state ----------------
  function keyOf(st, selfSeat) {
    const t = st.turn;
    if (st.phase !== 'boardTurn' || !t) return null;
    const me = selfSeat >= 0 ? st.players[selfSeat] : null;
    return [st.round, t.seat, t.step, t.stepsLeft, t.options.join('.'), t.doubleDice, t.extraRolls, t.seat === selfSeat ? me.items.join('.') : '', t.offer.length, t.seat === selfSeat ? me.coins : ''].join('|');
  }

  function close() {
    prompts.menu?.close();
    prompts.menu = null;
    prompts.key = null;
    scene.setMarkers([]);
    scene.setPreview(null);
  }

  /** (re)builds the prompt for the current state if it changed; call only when no animation is running */
  function sync(st, selfSeat) {
    const key = keyOf(st, selfSeat);
    if (key === prompts.key && prompts.menu && !prompts.menu.closed) return;
    close();
    prompts.key = key;
    if (key === null) return;
    prompts.armedAt = now() + 0.2;
    prompts.lockedUntil = 0;
    const t = st.turn;
    scene.cam.follow(t.seat);
    if (t.seat !== selfSeat) { prompts.menu = spectatorLabel(st); return; }
    if (t.step === 'roll') rollMenu(st, selfSeat);
    else if (t.step === 'path') pathMenu(st, selfSeat);
    else if (t.step === 'star') starMenu(st, selfSeat);
    else if (t.step === 'shop') shopMenu(st, selfSeat);
  }

  function nav(n) {
    if (!prompts.menu || now() < prompts.armedAt || now() < prompts.lockedUntil) return;
    prompts.menu.nav?.(n);
  }
  function unlock() { prompts.lockedUntil = 0; }

  return { sync, close, nav, unlock, active: () => !!prompts.menu };
}
