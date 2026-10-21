// Schlager Hero: Kaplay client (main lane + live thumbnails). Song, chart and rules: song.js. Band: synth.js.
import { createRng } from '../../contracts.js';
import { box, disc, label, setText, addHint, ease } from '../draw.js';
import LINES from './lines.js';
import { createBand, sharedContext } from './synth.js';
import { buildChart, createPlay, formatPoints, multiplier, SPB, FALL, EKSTASE_SECS, EKSTASE_AT, DURATION_MS, LANES, NOTE_DANEBEN } from './song.js';

const LANE_W = 104, HW = LANE_W * 4, X0 = 480 - HW / 2;
const TOP = 96, LINE_Y = 560, BOT = 640;
const LANE_COL = ['#ff5fa2', '#ffd23f', '#3bd5ff', '#7bed9f'];
const KEYS = ['A', 'S', 'W', 'D'];
const laneX = (i) => X0 + LANE_W * (i + 0.5);
const ARROW = {   // triangle pointing in each lane's direction, around (0,0)
  left: [[-15, 0], [11, -17], [11, 17]], down: [[0, 15], [-17, -11], [17, -11]],
  up: [[0, -15], [-17, 11], [17, 11]], right: [[15, 0], [-11, -17], [-11, 17]],
};
const BULBS = ['#ff5a4a', '#ffd43b', '#4cd964', '#3bd5ff', '#ff5fa2'];
const GRADE = { perfekt: ['PERFEKT!', '#ffe066'], gut: ['Gut', '#8ce99a'], daneben: ['Daneben', '#ff6b6b'] };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const r2 = (v) => Math.round(v * 100) / 100;

export function mountSchlager(ctx) {
  const { k, root, input, audio } = ctx;
  const thumb = ctx.view === 'thumb';
  const profile = ctx.seats.find((s) => s.index === ctx.seat)?.profile ?? { name: '?', color: '#ffb400', hat: 'none' };
  const chart = buildChart(ctx.rng);
  const play = thumb ? null : createPlay(chart);
  // bot: seeded per seat so the three bots differ; knows the chart (like a human who learned it) but hits with timing noise and misses 10-20 %
  const botRng = createRng((ctx.seed ^ Math.imul(ctx.selfSeat + 7, 0x9E3779B1)) >>> 0);
  const missRate = 0.08 + botRng.next() * 0.1, sd = 0.025 + botRng.next() * 0.025;
  const plan = ctx.isBot && !thumb ? chart.map((n) => {
    const gauss = (botRng.next() + botRng.next() + botRng.next() - 1.5) * 2;
    return { t: n.t + gauss * sd, lane: n.lane, skip: botRng.next() < missRate, done: false };
  }) : null;

  // ---- scene ----
  box(k, root, 0, 0, 960, 720, '#2a0f4a');
  box(k, root, 0, 380, 960, 340, '#3b1768', { opacity: 0.8 });
  const stripes = [];
  for (let i = 0; i < 12; i++) {   // Bierzelt roof: red/white stripes with scallops
    box(k, root, i * 80, 0, 80, 58, i % 2 ? '#f4efe6' : '#d6342c');
    disc(k, root, i * 80 + 40, 58, 40, i % 2 ? '#f4efe6' : '#d6342c');
    stripes.push(i);
  }
  const bulbs = [];
  for (let i = 0; i < 24; i++) {
    const x = 20 + i * 40, y = 88 + Math.sin((i / 23) * Math.PI) * 14;
    bulbs.push(disc(k, root, x, y, 7, BULBS[i % BULBS.length], { outline: [2, '#1a0833'] }));
  }
  const hwBack = box(k, root, X0 - 8, TOP - 6, HW + 16, BOT - TOP + 12, '#ffd43b', { radius: 12, opacity: 0.0 });
  box(k, root, X0, TOP, HW, BOT - TOP, '#150826', { radius: 6, opacity: 0.88 });
  const laneGlow = LANES.map((_, i) => box(k, root, X0 + i * LANE_W, TOP, LANE_W, BOT - TOP, LANE_COL[i], { opacity: 0.07 }));
  for (let i = 1; i < 4; i++) box(k, root, X0 + i * LANE_W - 1, TOP, 2, BOT - TOP, '#ffffff', { opacity: 0.12 });
  box(k, root, X0, LINE_Y - 3, HW, 6, '#ffffff', { opacity: 0.35 });
  const rec = LANES.map((name, i) => {
    const d = disc(k, root, laneX(i), LINE_Y, 38, '#1f0f38', { outline: [5, LANE_COL[i]] });
    root.add([k.pos(laneX(i), LINE_Y), k.polygon(ARROW[name].map(([x, y]) => k.vec2(x * 0.9, y * 0.9))), k.color(k.rgb(LANE_COL[i])), k.opacity(0.75)]);
    if (!thumb) label(k, root, KEYS[i], laneX(i), BOT - 20, { size: 24, color: LANE_COL[i], outline: [3, '#150826'] });
    return d;
  });
  const noteLayer = root.add([k.pos(0, 0)]);
  const fxLayer = root.add([k.pos(0, 0)]);

  // HUD: score on top, combo left, Ekstase meter + tally right
  box(k, root, 480, 40, 360, 56, '#150826', { anchor: 'center', radius: 14, opacity: 0.82, outline: [3, '#ffd43b'] });
  const scoreTxt =label(k, root, '0 Punkte', 480, 40, { size: 40, outline: [5, '#2a0f4a'], color: '#ffffff' });
  label(k, root, 'COMBO', 130, 190, { size: 20, color: '#ffd43b', outline: [3, '#2a0f4a'] });
  const comboTxt = label(k, root, '0', 130, 245, { size: 64, outline: [6, '#2a0f4a'] });
  const multTxt = label(k, root, 'x1', 130, 300, { size: 30, color: '#8ce99a', outline: [4, '#2a0f4a'] });
  label(k, root, 'Schlager-Ekstase', 832, 190, { size: 18, color: '#ffd43b', outline: [3, '#2a0f4a'] });
  box(k, root, 762, 214, 140, 26, '#150826', { radius: 8, outline: [3, '#ffd43b'] });
  const meter = box(k, root, 766, 218, 0, 18, '#ffd43b', { radius: 5 });
  const tallyTxt = thumb ? null : label(k, root, '', 832, 300, { size: 17, color: '#ffffff', outline: [3, '#2a0f4a'], width: 190, align: 'center', lineSpacing: 4 });
  const judge = label(k, root, '', 480, 480, { size: 36, outline: [5, '#150826'], opacity: 0 });
  const banner = label(k, root, 'SCHLAGER-EKSTASE!', 480, 150, { size: 46, outline: [6, '#2a0f4a'], opacity: 0 });
  const mug = label(k, root, '🍺', 850, 620, { size: 52 });
  label(k, root, '🎶', 120, 130, { size: 40, opacity: 0.9 });
  if (!thumb) addHint(k, root, '{DPAD} / {LS} / {key:WASD} / {key:←↓↑→}  Pfeile im Takt treffen', 560, 704, { size: 17, outline: [3, '#2a0f4a'] });
  const av = ctx.addAvatar(profile, { size: 70, showName: true });
  av.pos = k.vec2(120, 625);

  // ---- state ----
  let live = false, finished = false, clock = 0, fallback = 0, elapsed = 0, since = 9, popAge = 9, bannerAge = 9, ekstaseOn = false, shown = 0;
  let avgDt = 1 / 60;
  let sentKey = '', sentAt = -9, lastSay = -99, bounceAcc = 0, musicTimer = 0;
  let actx = null, band = null, t0 = 0, useAudio = false, said = {};
  let remote = { t: 0, s: 0, c: 0, e: 0, at: 0 }, remoteLive = false;
  const noteObjs = new Map();
  const fx = [];
  const wall = () => performance.now() / 1000;
  const bulbAt = (rate) => (((Math.floor(clock * rate) % BULBS.length) + BULBS.length) % BULBS.length);

  if (!thumb && !ctx.spectator) sharedContext().then((c) => { if (c && ctx.alive?.() !== false) actx = c; });

  function say(kind, gap = 7) {
    if (thumb || ctx.spectator || clock - lastSay < gap || said[kind] >= (kind === 'start' ? 1 : 2)) return;
    lastSay = clock; said[kind] = (said[kind] ?? 0) + 1;
    audio.say(pick(LINES[kind]));
  }

  function spawnFx(x, y, color, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5, sp = 120 + Math.random() * 160;
      fx.push({ o: disc(k, fxLayer, x, y, 5 + Math.random() * 4, color), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, age: 0, life: 0.45 });
    }
  }
  function flash(lane, grade) {
    rec[lane].color = k.rgb(LANE_COL[lane]);
    laneGlow[lane].opacity = 0.35;
    spawnFx(laneX(lane), LINE_Y, grade === 'perfekt' ? '#ffffff' : LANE_COL[lane], grade === 'perfekt' ? 10 : 6);
  }
  function popup(kind, extra = '') {
    const [txt, col] = GRADE[kind];
    judge.text = txt + extra; judge.color = k.rgb(col); popAge = 0;
  }
  function addNote(n) {
    const o = noteLayer.add([k.pos(laneX(n.lane), -100), k.circle(29), k.color(k.rgb(LANE_COL[n.lane])), k.outline(4, k.rgb('#ffffff')), k.anchor('center'), k.opacity(1)]);
    if (!thumb) o.add([k.polygon(ARROW[LANES[n.lane]].map(([x, y]) => k.vec2(x * 0.85, y * 0.85))), k.color(k.rgb('#2a0f4a'))]);
    noteObjs.set(n.id, o);
    return o;
  }

  function handle(events) {
    for (const e of events) {
      if (e.type === 'hit') {
        const lane = e.note.lane;
        noteObjs.get(e.note.id)?.destroy(); noteObjs.delete(e.note.id);
        flash(lane, e.grade);
        popup(e.grade, `  +${e.pts}`);
        band?.blip(lane, e.grade);
        if (e.grade === 'perfekt') audio.sfx('tick', { volume: 0.35, rate: 1.6 });
        av.bounce();
        if (play.combo === 25) say('combo');
        else if (play.combo % 10 === 0) audio.sfx('coinGain', { volume: 0.4 });
      } else if (e.type === 'miss') {
        const o = e.note && noteObjs.get(e.note.id);
        if (o) { o.dead = true; o.color = k.rgb('#777777'); }
        popup('daneben', e.reason === 'stray' ? '  (ins Leere)' : '');        audio.sfx('bump', { volume: 0.35, rate: 0.9 });
        if (e.reason !== 'stray') say('miss', 9);
      } else if (e.type === 'ekstase') {
        ekstaseOn = true; bannerAge = 0;
        audio.sfx('star', { volume: 0.7 });
        say('ekstase', 4);
      } else if (e.type === 'ekstaseEnd') {
        ekstaseOn = false;
      }
    }
  }

  function finishNow() {
    if (finished) return;
    finished = true; live = false;
    band?.close();
    audio.music('minigame');
    const total = play.counts.perfekt + play.counts.gut + play.counts.daneben;
    say(play.counts.perfekt + play.counts.gut >= total * 0.75 ? 'good' : 'bad', 0);
    ctx.finish({ score: play.score, label: `${formatPoints(play.score)} Punkte` });
  }

  function progress() {
    const key = `${play.score}|${play.combo}|${ekstaseOn ? 1 : 0}`;
    if (key === sentKey && elapsed - sentAt < 0.4) return;
    sentKey = key; sentAt = elapsed;
    ctx.sendProgress({ t: r2(clock), s: play.score, c: play.combo, e: ekstaseOn ? 1 : 0 });
  }

  // ---- per frame ----
  root.onUpdate(() => {
    const dt = Math.min(k.dt(), 0.1);
    since += dt; popAge += dt; bannerAge += dt;
    avgDt += (dt - avgDt) * 0.1;
    let combo, score, ek;
    if (thumb) {
      clock = remoteLive ? remote.t + Math.min(0.7, wall() - remote.at) : -1;
      combo = remote.c; score = remote.s; ek = !!remote.e;
    } else {
      if (live) {
        elapsed += dt;
        if (useAudio) clock = actx.currentTime - t0 - (actx.outputLatency || 0); else { fallback += dt; clock = fallback; }
        if (useAudio) band.pump(clock + (actx.outputLatency || 0), t0);
        // input: one edge per lane (dpad / stick / WASD / arrows)
        LANES.forEach((name, i) => { if (input.pressedDir(name)) handle(play.press(i, clock)); });
        handle(play.tick(clock));
        musicTimer -= dt;
        if (musicTimer <= 0) { musicTimer = 0.4; audio.music(null); }   // the runner's 'minigame' track would fight our band: keep it off during the round
        progress();
        if ((clock > play.lastNoteTime() + 1.2) || elapsed * 1000 >= DURATION_MS - 400) finishNow();
      }
      combo = play.combo; score = play.score; ek = ekstaseOn;
    }

    // notes
    const speed = (LINE_Y - TOP) / FALL;
    for (const n of chart) {
      const y = LINE_Y - (n.t - clock) * speed;
      const visible = clock >= -2 && y > TOP - 30 && y < BOT + 30 && (thumb || !play.notes[n.id].done || noteObjs.has(n.id));
      let o = noteObjs.get(n.id);
      if (!visible) { if (o && (y >= BOT + 30 || y < TOP - 30)) { o.destroy(); noteObjs.delete(n.id); } continue; }
      if (!o) o = addNote(n);
      o.pos.y = y;
      o.opacity = (o.dead ? 0.3 : 1) * (y < TOP + 20 ? Math.max(0, (y - (TOP - 30)) / 50) : 1);
      if (thumb && y > LINE_Y + 12) { o.destroy(); noteObjs.delete(n.id); }
    }

    // beat-synced decoration
    const beat = clock > 0 ? (clock / SPB) % 1 : 0;
    const pulse = Math.exp(-beat * 4);
    bulbs.forEach((b, i) => {
      b.opacity = ek ? (Math.floor(clock * 8 + i) % 2 ? 1 : 0.35) : 0.45 + 0.55 * (((i + Math.floor(clock / SPB)) % 3 === 0) ? pulse : 0.3);
    });
    hwBack.opacity = ek ? 0.55 + 0.3 * pulse : 0;
    mug.pos = k.vec2(850, 620 - pulse * 10);
    rec.forEach((r, i) => { r.color = k.rgb(ek ? '#4a2a00' : '#1f0f38'); const g = laneGlow[i]; g.opacity += (0.07 + (ek ? 0.07 * pulse : 0) - g.opacity) * ease(dt, 10); });

    // HUD
    shown += (score - shown) * ease(dt, 14);
    if (Math.abs(score - shown) < 1) shown = score;
    setText(scoreTxt, `${formatPoints(shown)} Punkte`);
    setText(comboTxt, String(combo));
    comboTxt.color = k.rgb(combo >= 30 ? '#ff5fa2' : combo >= EKSTASE_AT ? '#ffd43b' : '#ffffff');
    setText(multTxt, `x${multiplier(combo) * (ek ? 2 : 1)}`);
    multTxt.color = k.rgb(ek ? '#ffd43b' : '#8ce99a');
    const frac = ek ? Math.max(0, (play ? play.ekstaseUntil - clock : EKSTASE_SECS * 0.5) / EKSTASE_SECS) : Math.min(1, combo / EKSTASE_AT);
    meter.width = Math.max(0, 132 * frac);
    meter.color = k.rgb(ek ? BULBS[bulbAt(10)] : '#ffd43b');
    if (tallyTxt) setText(tallyTxt, `Perfekt ${play.counts.perfekt}   Gut ${play.counts.gut}\nDaneben ${play.counts.daneben}`);
    const pop = Math.min(1, popAge / 0.12);
    judge.scale = k.vec2(1 + (1 - pop) * 0.5);
    judge.opacity = popAge < 0.7 ? 1 - Math.max(0, popAge - 0.35) / 0.35 : 0;
    judge.pos = k.vec2(480, 480 - Math.min(popAge, 0.7) * 30);
    banner.opacity = ek || bannerAge < 1.5 ? 1 : 0;
    banner.color = k.rgb(BULBS[bulbAt(8)]);
    banner.scale = k.vec2(1 + pulse * 0.08 + Math.max(0, 0.4 - bannerAge) * 1.2);
    banner.angle = Math.sin(clock * 6) * 2.5;

    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.age += dt;
      if (f.age >= f.life) { f.o.destroy(); fx.splice(i, 1); continue; }
      f.o.pos = k.vec2(f.o.pos.x + f.vx * dt, f.o.pos.y + f.vy * dt);
      f.o.opacity = 1 - f.age / f.life;
    }
    if (ek && !thumb) { bounceAcc += dt; if (bounceAcc > SPB) { bounceAcc = 0; av.bounce(); } }
  });

  return {
    go() {
      if (thumb || live || finished) return;
      live = true;
      input.takeFrame?.();
      if (!ctx.spectator) {
        audio.music(null);
        if (actx) {
          try { if (actx.state !== 'running') actx.resume()?.catch(() => {}); } catch { /* still locked */ }
          if (actx.state === 'running') { try { band = createBand(actx, audio); t0 = actx.currentTime + 0.12; useAudio = true; } catch { band = null; } }
        }
        setTimeout(() => say('start'), 1200);      }
    },
    update(p) {
      if (!thumb || !p || typeof p !== 'object') return;
      remote = { t: Number(p.t) || 0, s: Number(p.s) || 0, c: Number(p.c) || 0, e: p.e ? 1 : 0, at: wall() };
      remoteLive = true;
    },
    botInput() {
      if (thumb || !live || !plan) return {};
      const lead = 0.01 + 1.5 * avgDt;   // inject() -> input.update -> my onUpdate takes a couple of frames: press that much early
      for (const p of plan) {
        if (p.done) continue;
        if (clock + lead < p.t) break;
        p.done = true;
        if (p.skip) continue;
        if (clock - p.t > NOTE_DANEBEN) continue;
        return { move: { x: p.lane === 0 ? -1 : p.lane === 3 ? 1 : 0, y: p.lane === 2 ? -1 : p.lane === 1 ? 1 : 0 } };
      }
      return {};
    },
    destroy() {
      band?.close();
      if (live && !finished) audio.music('minigame');
      live = false;
    },
  };
}
