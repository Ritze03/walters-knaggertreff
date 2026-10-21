// Ordnungsamt-Flucht: Kaplay client; the rules live in sim.js.
// OWNER PATH (ctx.owner, a human client): my own avatar is simulated HERE (`own`, sim.js stepBody at a fixed 60 Hz from my input), so it reacts at once whatever the host's
// lag; ownState() reports it to the host (mgOwn), which trusts it and sends me back only what it resolves (shoves + van hits as impulses, lives, vans). Remote avatars are drawn
// from a 100 ms delayed snapshot buffer (interp.js). VANS are never delayed: they are drawn extrapolated from their velocity up to the current time (the host hit-tests my
// reported position against the van where it is NOW, so what I see must be as close to host time as possible). When I am out I stop simulating and draw the snapshot.
// NON-OWNER path (ctx.owner false: host-run test bots): the old rendering of the latest snapshot, extrapolated + smoothed.
import { createRng } from '../../contracts.js';
import { fixedStepper, takeImps } from '../owner.js';
import { createTrack } from '../interp.js';
import { box, disc, label, ease, setText, addHint, bubble as speechBubble } from '../draw.js';
import { ARENA, C, DURATION_MS, botFrame, stepBody } from './sim.js';

const BUBBLE = 'Ordnungsamt! Ausweis bitte!';
const HEART = '❤️', BLACK_HEART = '🖤';

export function mountOrdnungsamt(ctx) {
  const { k, root, audio } = ctx;
  const self = ctx.selfSeat;
  const isPlayer = ctx.seats.some((s) => s.index === self);
  const botRng = createRng((ctx.seed ^ Math.imul(self + 1, 0x85EBCA6B)) >>> 0);
  const world = root.add([k.pos(0, 0)]);

  // ---- static scene: a Kiez square (cobblestones, fountain, benches, trees, Späti) ----
  box(k, world, 0, 0, ARENA.w, ARENA.h, '#3d4150');
  box(k, world, ARENA.x0 - 24, ARENA.y0 - 24, ARENA.x1 - ARENA.x0 + 48, ARENA.y1 - ARENA.y0 + 48, '#9a9484', { radius: 18, outline: [6, '#6d685b'] });
  for (let x = ARENA.x0; x < ARENA.x1; x += 60) box(k, world, x, ARENA.y0 - 24, 3, ARENA.y1 - ARENA.y0 + 48, '#8a8475');
  for (let y = ARENA.y0; y < ARENA.y1; y += 60) box(k, world, ARENA.x0 - 24, y, ARENA.x1 - ARENA.x0 + 48, 3, '#8a8475');
  disc(k, world, 640, 390, 64, '#d8d2c0', { outline: [5, '#6d685b'] });
  disc(k, world, 640, 390, 48, '#5aa9c9');
  label(k, world, '⛲', 640, 390, { size: 44 });
  for (const [x, y] of [[220, 150], [1060, 150], [220, 640], [1060, 640]]) box(k, world, x, y, 90, 24, '#7a5230', { radius: 5, outline: [3, '#4d3219'] });
  for (const [x, y] of [[90, 140], [1190, 140], [90, 650], [1190, 650]]) { disc(k, world, x, y, 34, '#3f8f3f', { outline: [4, '#27632b'] }); disc(k, world, x, y, 12, '#7a5230'); }
  box(k, world, 560, 100, 160, 44, '#e8b730', { radius: 6, outline: [4, '#8a6a00'] });
  label(k, world, 'SPÄTI', 640, 122, { size: 26, color: '#2a2200' });
  const bands = world.add([k.pos(0, 0)]);     // van warning lanes
  const crowd = world.add([k.pos(0, 0)]);     // players
  const traffic = world.add([k.pos(0, 0)]);   // vans (above the players, they run you over)
  const fx = world.add([k.pos(0, 0)]);        // popups, puffs, bubbles
  const hud = root.add([k.pos(0, 0)]);
  const banner = label(k, hud, '', 640, 330, { size: 74, color: '#ffffff', outline: [8, '#c0392b'], opacity: 0 });
  const bannerSub = label(k, hud, '', 640, 395, { size: 30, color: '#ffffff', outline: [5, '#1b2a49'], opacity: 0 });
  if (isPlayer) addHint(k, hud, '{key:E} / {key:Shift} / {X} Rempeln', 20, 704, { size: 20, anchor: 'left', outline: [4, '#1b2a49'] });

  // ---- players ----
  const crew = new Map();   // seat -> {seat, av, x, y, mark, bar, chip, hearts, ghost, puffAt}
  // top HUD row: [timer][chip][chip]... centred together, so the timer sits in the HUD band instead of on the arena's bottom edge
  const TIMER_W = 150;
  const n = ctx.seats.length, chipW = Math.min(206, (1240 - TIMER_W) / n), chip0 = (ARENA.w - n * chipW + TIMER_W) / 2;
  box(k, hud, chip0 - TIMER_W + 4, 6, TIMER_W - 8, 62, '#000000', { radius: 8, opacity: 0.45, outline: [3, '#ffffff'] });
  const timerTxt = label(k, hud, '', chip0 - TIMER_W / 2, 37, { size: 22, color: '#ffffff', outline: [4, '#1b2a49'] });
  ctx.seats.forEach((seat, i) => {
    const e = { seat: seat.index, x: 640, y: 390, seen: false, puffAt: 0 };
    e.av = ctx.addAvatar(seat.profile, { size: 44, showName: true, parent: crowd });
    e.av.hidden = true;
    e.mark = label(k, crowd, seat.index === self ? '▼' : '', 0, 0, { size: 26, color: '#ffe066', outline: [4, '#1b2a49'] });
    e.bar = box(k, crowd, 0, 0, 40, 6, '#8ce99a', { outline: [2, '#1b2a49'] });
    e.stun = label(k, crowd, '💫', 0, 0, { size: 24 });
    e.ghost = label(k, crowd, '', 0, 0, { size: 20, color: '#dddddd', outline: [3, '#1b2a49'] });
    e.stun.hidden = true; e.ghost.hidden = true; e.mark.hidden = true; e.bar.hidden = true;
    const cx = chip0 + i * chipW;
    box(k, hud, cx + 4, 6, chipW - 8, 62, '#000000', { radius: 8, opacity: 0.45, outline: [3, seat.profile.color] });
    label(k, hud, seat.profile.name, cx + chipW / 2, 24, { size: chipW < 200 ? 17 : 20, outline: [3, '#1b2a49'], width: chipW - 20 });
    e.hearts = label(k, hud, '', cx + chipW / 2, 50, { size: 20 });
    crew.set(seat.index, e);
  });

  // ---- snapshot state ----
  let snap = null, snapAt = 0, live = false, lastEv = null, lastSiren = -9, doneShown = false, shake = 0, bannerAge = 9;
  const vans = new Map();   // id -> {obj, band, x, y}
  let netT = 0;

  // ---- owner path state ----
  const owner = !!ctx.owner && isPlayer;
  let own = null;                 // my simulated body {x y vx vy kx ky fx fy dash cd stun dn}; null until the first snapshot seeds it
  let lastImp = null;             // highest impulse id applied (null = nothing seen yet: the first snapshot only learns the current id); reported as `ack`
  let tapped = false;             // a shove press waiting for the next 60 Hz step
  let outSeats = new Set();       // seats the host has eliminated (they no longer collide)
  const stepper = fixedStepper(60);
  const tracks = new Map();       // seat -> interpolation buffer of that REMOTE player
  const trackFor = (seat) => { let t = tracks.get(seat); if (!t) tracks.set(seat, t = createTrack({ delayMs: 100, snapDist: 200, keys: ['x', 'y', 'vx', 'vy', 'fx', 'fy'] })); return t; };
  const iAmOut = () => !!snap?.ps.some((p) => p.s === self && p.out !== null);

  const popup = (text, x, y, color, size = 30) => {
    const o = label(k, fx, text, x, y, { size, color, outline: [5, '#1b2a49'] });
    const half = (o.width || 0) / 2 + 8;   // keep wide popups (KONTROLLIERT!) fully on screen near the arena edges
    o.pos = k.vec2(Math.max(half, Math.min(ARENA.w - half, x)), y);
    o.onUpdate(() => { o.pos = k.vec2(o.pos.x, o.pos.y - 70 * k.dt()); o.opacity -= k.dt() * 0.8; if (o.opacity <= 0) o.destroy(); });
    return o;
  };
  const puff = (x, y, color) => {
    const o = disc(k, fx, x, y, 12, color, { opacity: 0.6 });
    o.onUpdate(() => { o.opacity -= k.dt() * 3; o.radius = Math.max(1, o.radius - k.dt() * 18); if (o.opacity <= 0) o.destroy(); });
  };
  const bubble = (seat) => {
    const e = crew.get(seat);
    // sized to the rendered text and kept inside the whole screen (a victim at the edge must not push it off-screen)
    const b = speechBubble(k, fx, BUBBLE, { size: 17, bounds: { x0: 6, y0: 70, x1: ARENA.w - 6, y1: ARENA.h - 6 } });
    let age = 0;
    b.place(e.x, e.y - 40);
    b.obj.onUpdate(() => { age += k.dt(); b.place(e.x, e.y - 40 - Math.min(age * 30, 10)); if (age > 1.5) b.obj.destroy(); });
  };
  const showBanner = (text, sub = '') => { banner.text = text; bannerSub.text = sub; bannerAge = 0; };

  function makeVan(v) {
    const horizontal = v.vx !== 0;
    const dir = horizontal ? Math.sign(v.vx) : Math.sign(v.vy);
    const o = traffic.add([k.pos(v.x, v.y), k.rotate(horizontal ? (dir > 0 ? 0 : 180) : (dir > 0 ? 90 : 270))]);
    const L = C.VAN_W, T = C.VAN_T;
    box(k, o, 0, 4, L, T, '#000000', { anchor: 'center', radius: 12, opacity: 0.25 });
    box(k, o, 0, 0, L, T, '#f4f6f8', { anchor: 'center', radius: 12, outline: [4, '#1b2a49'] });
    box(k, o, -8, -T / 2 + 6, L - 36, 5, '#1d6fd6', { anchor: 'center' });
    box(k, o, -8, T / 2 - 6, L - 36, 5, '#d62828', { anchor: 'center' });
    box(k, o, L / 2 - 24, 0, 22, T - 16, '#8ecae6', { anchor: 'center', radius: 5, outline: [2, '#1b2a49'] });
    disc(k, o, L / 2 - 3, -T / 2 + 9, 5, '#ffe066');
    disc(k, o, L / 2 - 3, T / 2 - 9, 5, '#ffe066');
    label(k, o, 'ORDNUNGSAMT', -18, 0, { size: 12, color: '#1b2a49', angle: horizontal && dir < 0 ? 180 : 0 });
    o.siren1 = disc(k, o, 14, -T / 2 + 15, 7, '#ff3b3b', { outline: [2, '#1b2a49'] });
    o.siren2 = disc(k, o, 14, T / 2 - 15, 7, '#3b7bff', { outline: [2, '#1b2a49'] });
    const band = bands.add([k.pos(0, 0)]);
    const stripe = horizontal ? box(k, band, 0, v.y - T / 2, ARENA.w, T, '#ff3b3b', { opacity: 0 }) : box(k, band, v.x - T / 2, 0, T, ARENA.h, '#ff3b3b', { opacity: 0 });
    const bang = label(k, band, '‼', horizontal ? (dir > 0 ? 40 : ARENA.w - 40) : v.x, horizontal ? v.y : (dir > 0 ? 100 : ARENA.h - 30), { size: 44, color: '#ffffff', outline: [5, '#c0392b'], opacity: 0 });
    return { obj: o, stripe, bang, band, x: v.x, y: v.y, horizontal };
  }

  /** owner path, per snapshot: seed `own` (first snapshot / remount), apply impulses addressed to me, feed the remote buffers */
  function takeOwner(s) {
    const mine = s.ps.find((p) => p.s === self);
    const got = takeImps(s, self, lastImp);   // null on the first snapshot: nothing is replayed
    lastImp = got.last;
    if (!own && mine) own = { x: mine.x, y: mine.y, vx: mine.vx, vy: mine.vy, kx: mine.kx, ky: mine.ky, fx: mine.fx, fy: mine.fy, dash: mine.dash, cd: mine.cd, stun: mine.stun, dn: mine.dn ?? 0 };
    if (own) for (const e of got.list) { own.kx += e.kx; own.ky += e.ky; own.stun = Math.max(own.stun, e.st); if (e.dc) own.dash = 0; }
    outSeats = new Set(s.ps.filter((p) => p.out !== null).map((p) => p.s));
    const now = performance.now();
    for (const p of s.ps) if (p.s !== self) trackFor(p.s).push(now, { x: p.x, y: p.y, vx: p.vx + p.kx, vy: p.vy + p.ky, fx: p.fx, fy: p.fy });   // velocity incl. knockback: what the buffer extrapolates with
  }

  /** my body, one frame: fixed 60 Hz steps of the SAME body math as the host's (sim.js stepBody) from my stick + latched shove presses; a one-sided half-push stands in for the host's soft separation */
  function stepOwn(dt) {
    if (!owner || !own || !live || snap?.done || iAmOut()) return;
    const f = ctx.input.takeFrame();
    tapped ||= f.pressed.action;
    stepper.step(dt * 1000, (ms) => {
      if (stepBody(own, { move: f.move, pressed: { action: tapped } }, ms)) own.dn++;
      tapped = false;
      for (const e of crew.values()) {
        if (e.seat === self || !e.seen || outSeats.has(e.seat)) continue;
        const dx = own.x - e.x, dy = own.y - e.y, d = Math.hypot(dx, dy);
        if (d >= 2 * C.R || d < 0.001) continue;
        const push = (2 * C.R - d) / 2;
        own.x = Math.max(ARENA.x0, Math.min(ARENA.x1, own.x + (dx / d) * push));
        own.y = Math.max(ARENA.y0, Math.min(ARENA.y1, own.y + (dy / d) * push));
      }
    });
  }

  function handleEvents(s) {
    const maxId = s.ev.reduce((m, e) => Math.max(m, e.i), 0);
    if (lastEv === null) { lastEv = maxId; return; }   // first snapshot (also after a remount): nothing to replay
    for (const e of s.ev) {
      if (e.i <= lastEv) continue;
      lastEv = Math.max(lastEv, e.i);
      if (!live) continue;
      const who = crew.get(e.s);
      if (e.k === 's') {
        audio.sfx('bump', { rate: 0.9 + Math.random() * 0.3 });
        popup('BUMM!', e.x, e.y - 30, '#ffe066');
        who?.av.bounce(); crew.get(e.o)?.av.bounce();
        if (e.o === self) shake = 0.25;
      } else if (e.k === 'h') {
        audio.sfx('splat');
        popup('KONTROLLIERT!', e.x, e.y - 40, '#ff8080', 34);
        if (who) bubble(e.s);
        if (e.o >= 0) popup('Kollateralschaden!', e.x, e.y - 76, '#ffe066', 24);
        if (e.s === self) shake = 0.5;
      } else if (e.k === 'o') {
        popup('RAUS!', e.x, e.y - 20, '#ffffff', 40);
        if (e.s === self) audio.sfx('lose');
      } else if (e.k === 'v' && k.time() - lastSiren > 3) {
        lastSiren = k.time();
        audio.sfx('endspurt', { volume: 0.5 });
      }
    }
  }

  function render(dt) {
    if (!snap) return;
    const age = Math.min(0.06, k.time() - snapAt);
    const pull = ease(dt, 18);
    const time = k.time();
    const wall = performance.now();
    for (const sp of snap.ps) {
      const e = crew.get(sp.s);
      if (!e) continue;
      // body fields (position, facing, dash, cd, stun): mine from `own` (until I am out), remote ones from the delayed buffer, otherwise the snapshot; lives/inv/out always from the snapshot
      const mineLocal = owner && sp.s === self && own && sp.out === null, smp = owner && sp.s !== self ? tracks.get(sp.s)?.sample(wall) : null;
      const p = mineLocal ? { ...sp, ...own } : smp ? { ...sp, x: smp.x, y: smp.y, fx: smp.fx } : sp;
      if (mineLocal || smp) { e.x = p.x; e.y = p.y; e.seen = true; } else {
        const tx = p.x + (p.vx + p.kx) * age, ty = p.y + (p.vy + p.ky) * age;
        if (!e.seen || Math.hypot(tx - e.x, ty - e.y) > 160) { e.x = tx; e.y = ty; e.seen = true; } else { e.x += (tx - e.x) * pull; e.y += (ty - e.y) * pull; }
      }
      const out = p.out !== null;
      e.av.pos = k.vec2(e.x, e.y);
      e.av.hidden = out || (p.inv > 0 && Math.floor(time * 14) % 2 === 0);
      e.av.setFacing(p.fx);
      if (p.dash > 0 && time - e.puffAt > 0.035) { e.puffAt = time; puff(e.x, e.y + 8, '#ffffff'); }
      e.mark.hidden = out || !e.mark.text;
      e.mark.pos = k.vec2(e.x, e.y - 52 + Math.sin(time * 6) * 4);
      e.bar.hidden = out || p.s !== self;
      e.bar.pos = k.vec2(e.x - 20, e.y + 50);
      e.bar.width = 40 * (1 - p.cd / C.COOLDOWN_MS);
      e.stun.hidden = out || p.stun <= 0;
      e.stun.pos = k.vec2(e.x, e.y - 40);
      e.ghost.hidden = !out;
      setText(e.ghost, out ? '📄 kontrolliert' : '');
      e.ghost.pos = k.vec2(e.x, e.y);
      setText(e.hearts, out ? '📄 raus' : HEART.repeat(Math.max(0, p.lives)) + BLACK_HEART.repeat(Math.max(0, C.LIVES - p.lives)));
    }
    // vans: create / move / remove
    // Owner path: extrapolate to NOW from the newest snapshot, no delay and no smoothing lag (the host judges the hit against the van's current spot). A new snapshot's small
    // correction is not snapped but bled off as an offset that decays quickly, so vans neither jump nor trail behind. Old path: the smoothed follower.
    const vAge = Math.min(0.25, time - snapAt), bleed = Math.exp(-dt * 14);
    const seen = new Set();
    for (const v of snap.vans) {
      seen.add(v.id);
      let e = vans.get(v.id);
      if (!e) { e = makeVan(v); vans.set(v.id, e); e.ox = 0; e.oy = 0; e.snapAt = snapAt; e.px = v.x + v.vx * vAge; e.py = v.y + v.vy * vAge; }
      const tx = v.x + v.vx * (owner ? vAge : age), ty = v.y + v.vy * (owner ? vAge : age);
      if (owner) {
        if (e.snapAt !== snapAt) { e.snapAt = snapAt; e.ox = e.px - tx; e.oy = e.py - ty; if (Math.hypot(e.ox, e.oy) > 80) { e.ox = 0; e.oy = 0; } }
        e.ox *= bleed; e.oy *= bleed;
        e.x = tx + e.ox; e.y = ty + e.oy; e.px = e.x; e.py = e.y;
      } else { e.x += (tx - e.x) * pull; e.y += (ty - e.y) * pull; }
      e.obj.pos = k.vec2(e.x, e.y);
      const flash = Math.floor(time * 8) % 2 === 0;
      e.obj.siren1.color = k.rgb(flash ? '#ff3b3b' : '#6b1a1a');
      e.obj.siren2.color = k.rgb(flash ? '#1a2a6b' : '#3b7bff');
      const outside = e.x < -v.w / 2 || e.x > ARENA.w + v.w / 2 || e.y < -v.h / 2 || e.y > ARENA.h + v.h / 2;
      const pulse = 0.18 + 0.14 * Math.sin(time * 18);
      e.stripe.opacity = outside ? pulse : 0;
      e.bang.opacity = outside ? 1 : 0;
    }
    for (const [id, e] of vans) if (!seen.has(id)) { e.obj.destroy(); e.band.destroy(); vans.delete(id); }
    const left = Math.max(0, Math.ceil((DURATION_MS - snap.t) / 1000));
    setText(timerTxt, snap.done ? 'Feierabend!' : `Noch ${left} s`);
    if (snap.done && !doneShown && live) {
      doneShown = true;
      const alivePs = snap.ps.filter((p) => p.out === null);
      showBanner('FEIERABEND!', alivePs.length === 1 ? 'Nur einer ist dem Ordnungsamt entkommen.' : '');
    }
  }

  root.onUpdate(() => {
    const dt = k.dt();
    netT += dt;
    stepOwn(dt);
    render(dt);
    bannerAge += dt;
    const a = bannerAge < 0.2 ? bannerAge / 0.2 : bannerAge > 1.8 ? Math.max(0, 1 - (bannerAge - 1.8) / 0.4) : 1;
    banner.opacity = a; bannerSub.opacity = a;
    banner.scale = k.vec2(1 + (1 - Math.min(1, bannerAge / 0.2)) * 0.8);
    shake = Math.max(0, shake - dt);
    world.pos = shake > 0 ? k.vec2((Math.random() - 0.5) * 22 * shake, (Math.random() - 0.5) * 22 * shake) : k.vec2(0, 0);
  });

  return {
    go() {
      live = true;
      audio.sfx('endspurt');
      lastSiren = k.time();
      showBanner('ORDNUNGSAMT!', BUBBLE);
    },
    update(s) {
      if (!s || !Array.isArray(s.ps)) return;
      snap = s; snapAt = k.time();
      if (owner) takeOwner(s);
      handleEvents(s);
    },
    /** what the runner sends to the host as mgOwn (30 Hz); null until the first snapshot seeded `own`, and once I am out (the host ignores an eliminated player's reports) */
    ownState() {
      if (!owner || !own || iAmOut()) return null;
      const r1 = (n) => Math.round(n * 10) / 10, r2 = (n) => Math.round(n * 100) / 100;
      return {
        x: r1(own.x), y: r1(own.y), vx: r1(own.vx), vy: r1(own.vy), kx: r1(own.kx), ky: r1(own.ky), fx: r2(own.fx), fy: r2(own.fy),
        dash: Math.round(own.dash), cd: Math.round(own.cd), stun: Math.round(own.stun), dn: own.dn, ack: lastImp ?? 0,
      };
    },
    botInput() {
      if (!snap || !isPlayer) return {};
      // a `?bot` tab is an owner: it must steer from the merged view (the snapshot's idea of me is a round trip old)
      const view = owner && own && !iAmOut() ? { ...snap, ps: snap.ps.map((p) => (p.s === self ? { ...p, ...own } : p)) } : snap;
      const f = botFrame(view, self, botRng);
      return { move: f.move, action: f.action };
    },
    destroy() {},   // everything hangs off root (the runner destroys it)
  };
}
