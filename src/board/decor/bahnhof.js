// Visuals for board "bahnhof" (DB Hauptbahnhof), D17: only Kaplay shapes + text + emoji, nothing borrowed (no logo, no real artwork).
// Abend im Kopfbahnhof: Hallendach mit Bahnhofsuhr und S-Bahn-Viadukt, Bahnsteige, Gleisfeld mit ICE, die Verspätungsanzeige,
// Reisezentrum, Deutschlandticket-Automat und ein Ersatzbus, der irgendwo parkt.
import { makeDraw, rngFor, shade } from '../draw.js';
import { TRACK_IDS } from '../boards/bahnhof.js';

export const eventIcons = { verspaetung: '⏰', schienenersatz: '🚌', zugfaelltaus: '🚫', kontrolle: '🎫', fundbuero: '🧳', gleiswechsel: '🔀' };
/** names for the 'path' prompt, by the first space of each branch */
export const pathLabels = { b06: 'Bahnhofsvorplatz', g1: 'Gleisfeld (Zug fällt aus!)', b21: 'Bahnsteig', t1: 'Reisezentrum' };

/** what the Verspätungsanzeige says after an event, and in between */
const EVENT_MSG = {
  zugfaelltaus: 'ICE 1337 fällt aus. Grund: Ja.',
  schienenersatz: 'Ersatzbus fährt ab. Wohin? Ja.',
  verspaetung: 'Verspätung wegen vorheriger Verspätung.',
  kontrolle: 'Fahrkartenkontrolle! Bitte Handy aufladen.',
  fundbuero: 'Fundbüro: 1 Schirm, 1 Zug, 3 Nerven.',
  gleiswechsel: 'Gleiswechsel! Alle einmal durcheinander.',
};
const IDLE_MSG = [
  'Grund: Ja.',
  'Störung im Betriebsablauf.',
  'Weichenstörung. Die Weiche ist auch nur ein Mensch.',
  'Wagenreihung: gewürfelt.',
  'Wir bitten um Verständnis, nicht um Beschwerden.',
  'Verspätung wegen vorheriger Verspätung.',
  'Signalstörung am Signal.',
  'Ersatzbus fährt am Hintereingang ab.',
  'Heute: Gleis 13 ohne Gleis 13.',
  'Bitte beachten Sie: Bitte beachten Sie.',
];
/** departure rows: [time, train, destination, delay, delayColour] */
const ROWS = [
  ['12:07', 'ICE 1337', 'Hamburg', '+45', '#ffb020'],
  ['12:15', 'RE 9', 'Irgendwo', '+20', '#ffb020'],
  ['12:22', 'S 42', 'Hinten', '+5', '#ffb020'],
  ['12:30', 'IC 2', 'Köln', 'fällt aus', '#ff4a3d'],
  ['12:41', 'ICE 77', 'Berlin', '+180', '#ff4a3d'],
  ['12:55', 'SEV', 'Dort', 'Grund: Ja', '#ff4a3d'],
];

const BX = 440, BY = 456, BW = 360, BH = 380;     // Verspätungsanzeige
const TRACK_Y = [596, 676, 796, 876];             // the four tracks of the Kopfbahnhof
const TRACK_X0 = 860, TRACK_X1 = 1800;
const ICE = { y: 676, x0: 900, len: 800 };
const BUS_HOME = { x: 2010, y: 1285 };
const CLOCK = { x: 1090, y: 68, r: 46 };

const WALK = ['b05', ...TRACK_IDS, 'b08'];        // the walkway through the Gleisfeld: laid on rails

export default function buildDecor({ k, back, board, anim }) {
  const d = makeDraw(k);
  const at = (id) => board.spaces.find((s) => s.id === id);
  const rng = rngFor(1337);

  // static random bits, built once
  const twinkle = Array.from({ length: 12 }, () => ({ x: rng.int(20, 2180), y: rng.int(8, 70), p: rng.next() * 6, s: rng.int(2, 4) }));
  const skyline = Array.from({ length: 22 }, (_, i) => {
    const w = rng.int(70, 130), h = rng.int(60, 125);
    const x = i * 105 - 30 + rng.int(-10, 10);
    const wins = [];
    for (let wy = 200 - h + 14; wy < 190; wy += 20) for (let wx = x + 10; wx < x + w - 14; wx += 20) wins.push({ x: wx, y: wy, lit: rng.next() < 0.45 });
    return { x, w, h, c: shade('#27324a', rng.next() * 0.25 - 0.08), wins };
  });
  const litter = Array.from({ length: 16 }, (_, i) => ({ e: ['☕', '🥨', '🧳', '🥨', '☕'][i % 5], x: rng.int(140, 2060), y: rng.int(330, 1340), a: rng.int(-60, 60), s: rng.int(20, 28) }));
  const lamps = board.spaces.filter((s, i) => i % 4 === 1 && !TRACK_IDS.includes(s.id)).map((s, i) => ({ x: s.x + (i % 2 ? 46 : -46), y: s.y - 52 }));
  const pigeons = Array.from({ length: 3 }, (_, i) => ({ x: 600 + i * 420, y: 1308 + (i % 2) * 18, p: i * 2.1 }));

  const ice = { dx: 0, cancel: 0, shake: 0 };
  const bus = { x: BUS_HOME.x, y: BUS_HOME.y, dir: -1, driving: false };
  const info = { msg: null, until: 0, flash: 0, idle: 0, lastIdleAt: 0 };
  const fx = { alarm: 0 };

  const say = (text, secs = 7) => { info.msg = text; info.until = k.time() + secs; };

  back.onUpdate(() => {
    const dt = k.dt();
    ice.shake = Math.max(0, ice.shake - dt);
    fx.alarm = Math.max(0, fx.alarm - dt);
    info.flash = Math.max(0, info.flash - dt);
    const t = k.time();
    if (t - info.lastIdleAt > 6) { info.lastIdleAt = t; info.idle = (info.idle + 1) % IDLE_MSG.length; }
  });

  /** everything that never moves */
  function drawStatic() {
    const W = board.world.w, H = board.world.h;
    // ---- sky, skyline, viaduct
    d.rect(-400, -300, W + 800, 520, '#141b2a');
    d.rect(-400, -40, W + 800, 160, '#1a2438', { a: 0.7 });
    d.circle(1960, 54, 28, '#e9efff', { a: 0.9 }); d.circle(1972, 48, 25, '#141b2a');
    for (const b of skyline) {
      d.rect(b.x, 200 - b.h, b.w, b.h + 20, b.c);
      for (const w of b.wins) d.rect(w.x, w.y, 10, 11, w.lit ? '#ffd86b' : '#1b2336');
    }
    d.rect(-400, 118, W + 800, 22, '#4a5568', { line: 0 });
    d.rect(-400, 138, W + 800, 6, '#262d3a');
    for (let x = 40; x < W + 200; x += 240) d.rect(x, 144, 34, 60, '#3a4354', { line: 0 });
    d.rect(-400, 112, W + 800, 6, '#7d889c');
    // Bahnhofsuhr + Schild (selbst gemalt, kein Logo)
    d.circle(CLOCK.x, CLOCK.y, CLOCK.r + 9, '#20262f');
    d.circle(CLOCK.x, CLOCK.y, CLOCK.r, '#f6f6f2', { line: 4 });
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      d.line(CLOCK.x + Math.sin(a) * (CLOCK.r - 12), CLOCK.y - Math.cos(a) * (CLOCK.r - 12), CLOCK.x + Math.sin(a) * (CLOCK.r - 4), CLOCK.y - Math.cos(a) * (CLOCK.r - 4), 4, '#1c1c1c');
    }
    d.rect(1360, 30, 400, 62, '#102a5c', { r: 8, line: 4, lineColor: '#e9efff' });
    d.text('HAUPTBAHNHOF', 1560, 61, 38, '#ffffff', { line: 0 });
    // ---- ground
    d.rect(-400, 190, W + 800, H - 190 + 500, '#2c3644');
    d.rect(70, 200, W - 140, H - 235, '#394658', { r: 60 });
    d.rect(110, 225, W - 220, H - 310, '#334052', { r: 50 });
    // Bahnsteig oben mit Sicherheitslinie
    d.rect(380, 188, 1390, 118, '#566579', { r: 32 });
    d.rect(430, 296, 1290, 8, '#ffd23a');
    d.text('BITTE ZURÜCKTRETEN', 1560, 322, 16, '#ffd23a', { a: 0.75, line: 0 });
    d.text('BAHNSTEIG 1', 700, 322, 16, '#e9efff', { a: 0.6, line: 0 });
    // Reisezentrum (Halle)
    d.rect(800, 330, 540, 170, '#5d6c86', { r: 30, line: 3 });
    for (let cx = 0; cx < 12; cx++) for (let cy = 0; cy < 4; cy++) if ((cx + cy) % 2) d.rect(812 + cx * 44, 342 + cy * 40, 44, 40, '#6a7a96');
    d.text('REISEZENTRUM', 1250, 480, 20, '#e8eeff', { a: 0.6, line: 0 });
    // Gleisfeld-Umweg
    d.rect(820, 930, 590, 200, '#4a443d', { r: 34 });
    d.text('GLEISFELD', 1350, 962, 24, '#e6dccb', { a: 0.5, line: 0 });
    drawWalkRails();
    // ---- Kopfbahnhof: vier Gleise, zwei Bahnsteige, Prellböcke
    d.rect(TRACK_X0 - 30, 560, TRACK_X1 - TRACK_X0 + 90, 360, '#4f493f', { r: 30 });
    d.rect(TRACK_X0 - 30, 612, TRACK_X1 - TRACK_X0 + 60, 48, '#7a879c', { r: 8, line: 3 });
    d.rect(TRACK_X0 - 30, 812, TRACK_X1 - TRACK_X0 + 60, 48, '#7a879c', { r: 8, line: 3 });
    d.rect(TRACK_X0 - 30, 658, TRACK_X1 - TRACK_X0 + 60, 5, '#ffd23a');
    d.rect(TRACK_X0 - 30, 815, TRACK_X1 - TRACK_X0 + 60, 5, '#ffd23a');
    for (const ty of TRACK_Y) {
      for (let x = TRACK_X0; x < TRACK_X1; x += 34) d.line(x, ty - 17, x, ty + 17, 8, '#5b4331');
      d.line(TRACK_X0, ty - 9, TRACK_X1, ty - 9, 5, '#d5dbe6');
      d.line(TRACK_X0, ty + 9, TRACK_X1, ty + 9, 5, '#d5dbe6');
      d.rect(TRACK_X1 + 4, ty - 14, 16, 28, '#c8372d', { r: 4, line: 3 });   // Prellbock
    }
    [['1', 1010, 636], ['2', 1460, 636], ['3', 1010, 836], ['4', 1460, 836]].forEach(([n, x, y]) => {
      d.rect(x, y, 96, 28, '#102a5c', { anchor: 'center', r: 5, line: 2, lineColor: '#ffffff' });
      d.text(`Gleis ${n}`, x, y, 17, '#ffffff', { line: 0 });
    });
    for (let x = 920; x < 1760; x += 210) for (const y of [624, 848]) { d.line(x, y, x, y - 34, 4, '#242a33'); d.circle(x, y - 36, 5, '#ffe9a0'); }
    // Regionalzug und Containerzug stehen herum
    drawRegional(d, 1020, TRACK_Y[3]);
    drawContainers(d, 1000, TRACK_Y[0]);
    // ---- Verspätungsanzeige
    d.rect(BX + 40, BY + BH - 4, 18, 40, '#242a33');
    d.rect(BX + BW - 58, BY + BH - 4, 18, 40, '#242a33');
    d.rect(BX, BY, BW, BH, '#0a0d12', { r: 12, line: 5, lineColor: '#5d6a80' });
    d.rect(BX + 10, BY + 10, BW - 20, 38, '#0d3a8c', { r: 6 });
    d.text('ABFAHRT · VERSPÄTUNG', BX + BW / 2, BY + 29, 20, '#ffffff', { line: 0 });
    ROWS.forEach(([time, train, dest], i) => {
      const y = BY + 74 + i * 32;
      d.text(time, BX + 16, y, 18, '#ffcc33', { anchor: 'left', line: 0 });
      d.text(train, BX + 76, y, 18, '#ffffff', { anchor: 'left', line: 0 });
      d.text(dest, BX + 176, y, 18, '#d6e0f0', { anchor: 'left', line: 0 });
    });
    d.rect(BX + 12, BY + 74 + ROWS.length * 32 - 12, BW - 24, 3, '#2a3345');
    // ---- Deutschlandticket: Automat am Vorplatz, Schalter im Reisezentrum
    drawTicketMachine(d, at('b07'));
    const sc = at('t2');
    d.rect(sc.x - 100, sc.y + 66, 200, 46, '#8a5a34', { r: 6, line: 3 });
    d.rect(sc.x - 90, sc.y + 72, 180, 18, '#102a5c', { r: 3 });
    d.text('Deutschlandticket', sc.x, sc.y + 81, 14, '#ffffff', { line: 0 });
    d.text('Nr. 4711 bitte', sc.x, sc.y + 102, 13, '#ffe9a0', { line: 0 });
    d.text('🧍🧍🧍', sc.x + 150, sc.y + 96, 20, '#fff', { line: 0 });
    // Ersatzbus-Haltestelle
    const bs = at('b12');
    d.line(bs.x + 96, bs.y - 10, bs.x + 96, bs.y + 74, 5, '#2c3340');
    d.circle(bs.x + 96, bs.y - 26, 24, '#ffd23a', { line: 4 });
    d.text('H', bs.x + 96, bs.y - 25, 28, '#1b7a3a', { line: 0 });
    d.text('SEV', bs.x + 96, bs.y + 90, 15, '#ffffff', { line: 2 });
    // Backshop und Toilette
    const bk = at('b01');
    d.rect(bk.x - 90, bk.y + 66, 180, 90, '#c88a46', { r: 8, line: 4 });
    d.rect(bk.x - 98, bk.y + 54, 196, 22, '#e8c27a', { r: 5, line: 3 });
    d.text('BACKSHOP', bk.x, bk.y + 65, 15, '#5a3410', { line: 0 });
    d.text('🥨🥐🍞', bk.x, bk.y + 110, 26, '#fff', { line: 0 });
    const wc = at('b09');
    d.rect(wc.x - 50, wc.y + 70, 100, 80, '#3a7ca5', { r: 6, line: 4 });
    d.text('WC', wc.x, wc.y + 96, 26, '#ffffff', { line: 0 });
    d.text('1,00 EUR', wc.x, wc.y + 132, 14, '#ffe9a0', { line: 0 });
    // Taxi
    drawTaxi(d, 1700, 1300);
    // Lampen, Krimskrams
    for (const l of lamps) {
      d.line(l.x, l.y, l.x, l.y + 46, 5, '#20262f');
      d.circle(l.x, l.y - 2, 22, '#e9f3ff', { a: 0.12 });
      d.circle(l.x, l.y - 2, 9, '#e9f3ff');
    }
    for (const b of litter) d.text(b.e, b.x, b.y, b.s, '#fff', { angle: b.a, line: 0, a: 0.8 });
    sign(d, 'Aufgang Ost', 2020, 760, 90);
    sign(d, 'Unterführung', 150, 930, -90);
    sign(d, 'Bahnhofsvorplatz', 560, 1320, 0);
  }

  /** the walkway through the Gleisfeld is laid on rails: gravel, sleepers, two rails per segment */
  function drawWalkRails() {
    const pts = WALK.map(at);
    for (const p of pts) d.circle(p.x, p.y, 54, '#6f675c');
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, nx = -uy, ny = ux;
      d.line(a.x, a.y, b.x, b.y, 108, '#6f675c');
      for (let s = 18; s < len - 10; s += 24) d.line(a.x + ux * s + nx * 50, a.y + uy * s + ny * 50, a.x + ux * s - nx * 50, a.y + uy * s - ny * 50, 9, '#4d3626');
      for (const side of [-1, 1]) {
        const o = side * 33;
        d.line(a.x + nx * o, a.y + ny * o, b.x + nx * o, b.y + ny * o, 9, '#20242b');
        d.line(a.x + nx * o, a.y + ny * o, b.x + nx * o, b.y + ny * o, 5, '#d5dbe6');
      }
    }
  }

  /** the few things that animate every frame (kept small: each draw call costs) */
  back.onDraw(() => {
    const t = k.time();
    for (const s of twinkle) d.circle(s.x, s.y, s.s * (0.6 + 0.4 * Math.sin(t * 2 + s.p)), '#fff6c8', { a: 0.4 + 0.5 * Math.sin(t * 2 + s.p) });
    drawClockHands(t);
    drawSBahn(t);
    drawIce(t);
    drawBoardLive(t);
    if (fx.alarm > 0) for (const id of TRACK_IDS) { const s = at(id); d.circle(s.x, s.y, 60 + 10 * Math.sin(t * 18), Math.sin(t * 14) > 0 ? '#ff3b3b' : '#ffd23a', { a: 0.28 * Math.min(1, fx.alarm) }); }
    for (const p of pigeons) d.dtext('🐦', p.x + Math.sin(t * 0.6 + p.p) * 90, p.y + Math.abs(Math.sin(t * 5 + p.p)) * -4, 22, '#ffffff', { line: 0 });
    drawBus(d, bus, t);
  });

  function drawClockHands(t) {
    const { x, y, r } = CLOCK;
    const hand = (a, len, w, c) => d.line(x, y, x + Math.sin(a) * len, y - Math.cos(a) * len, w, c);
    hand(((t / 600) % 1) * Math.PI * 2 + 1.1, r * 0.5, 6, '#1c1c1c');
    hand(((t / 60) % 1) * Math.PI * 2, r * 0.78, 4, '#1c1c1c');
    const s = t % 60;
    hand((s < 58.5 ? s / 58.5 : 1) * Math.PI * 2, r * 0.82, 2, '#d7263d');   // the second hand pauses at the top, like a real station clock
    d.circle(x, y, 4, '#d7263d');
  }

  function drawSBahn(t) {
    const x0 = ((t * 80) % (board.world.w + 1000)) - 700;
    for (let i = 0; i < 5; i++) {
      const x = x0 + i * 112;
      d.rect(x, 76, 108, 38, i === 0 ? '#d65a1f' : '#e07a2f', { r: 6, line: 3 });
      d.rect(x, 96, 108, 6, '#7a2b10');
      for (let w = 0; w < 4; w++) d.rect(x + 8 + w * 25, 84, 18, 11, '#9fd8ff');
    }
  }

  function drawIce(t) {
    const sh = ice.shake > 0 ? Math.sin(t * 60) * 5 : 0;
    const x0 = ICE.x0 + ice.dx + sh, y = ICE.y, x1 = x0 + ICE.len;
    d.ellipse(x0 + ICE.len / 2, y + 22, ICE.len / 2 + 20, 8, '#000000', { a: 0.28 });
    d.rect(x0, y - 34, ICE.len, 52, '#eef1f6', { r: 12, line: 4 });
    d.poly([[x1 - 6, y - 34], [x1 + 70, y - 6], [x1 + 70, y + 18], [x1 - 6, y + 18]], '#eef1f6', { line: 4 });
    d.rect(x0 + 4, y - 4, ICE.len + 60, 8, '#d7263d');
    for (let i = 0; i < 24; i++) d.rect(x0 + 18 + i * 32, y - 26, 22, 14, '#26324d', { r: 3 });
    d.rect(x1 + 14, y - 26, 34, 14, '#26324d', { r: 4 });
    d.text('ICE 1337', x0 + 120, y + 8, 14, '#26324d', { line: 0 });
    if (ice.cancel > 0) {
      const on = Math.sin(t * 16) > 0;
      d.rect(x0 + ICE.len / 2, y - 80, 300, 52, on ? '#d7263d' : '#7a1220', { anchor: 'center', r: 8, line: 4, lineColor: '#ffffff' });
      d.dtext('FÄLLT AUS', x0 + ICE.len / 2, y - 80, 32, '#ffffff', { line: 0 });
      d.line(x0 + 20, y - 36, x1 + 60, y + 16, 8, '#d7263d', { a: 0.85 });
      d.line(x0 + 20, y + 16, x1 + 60, y - 36, 8, '#d7263d', { a: 0.85 });
    }
  }

  function drawBoardLive(t) {
    const flash = info.flash > 0;
    ROWS.forEach(([, , , delay, col], i) => {
      const y = BY + 74 + i * 32;
      const txt = flash && i % 2 === 0 ? '+999' : delay;
      const blink = delay === 'fällt aus' || delay === 'Grund: Ja' || flash ? Math.sin(t * 6 + i) > -0.3 : true;
      if (blink) d.dtext(txt, BX + BW - 16, y, 18, flash ? '#ff4a3d' : col, { anchor: 'right', line: 0 });
    });
    const showEvent = info.msg && t < info.until;
    const msg = showEvent ? info.msg : IDLE_MSG[info.idle];
    const top = BY + 74 + ROWS.length * 32 - 6;
    d.rect(BX + 12, top, BW - 24, BH - (top - BY) - 12, showEvent && Math.sin(t * 8) > 0 ? '#3a1410' : '#14110a', { r: 6 });
    d.dtext(showEvent ? 'DURCHSAGE' : 'HINWEIS', BX + BW / 2, top + 16, 16, showEvent ? '#ff4a3d' : '#7f8aa0', { line: 0 });
    d.dtext(msg, BX + BW / 2, top + 64, 18, '#ffb020', { width: BW - 44, align: 'center', line: 0 });
  }

  // ---- special event animations (return a promise) ----
  async function zugFaelltAus() {
    say(EVENT_MSG.zugfaelltaus);
    ice.cancel = 1;
    ice.shake = 0.8;
    fx.alarm = 1.6;
    await anim.wait(1.8);
    ice.cancel = 0;
  }

  async function ersatzbus(spaceId) {
    say(EVENT_MSG.schienenersatz);
    const s = at(spaceId);
    const home = { x: bus.x, y: bus.y };
    const to = { x: Math.min(2060, s.x + 150), y: s.y + 96 };
    bus.driving = true;
    bus.dir = to.x >= home.x ? 1 : -1;
    await anim.tween(0.9, (p) => { bus.x = home.x + (to.x - home.x) * p; bus.y = home.y + (to.y - home.y) * p; }, anim.ease.easeOutCubic);
    bus.dir = -1;
    await anim.wait(0.9);
    bus.dir = to.x >= home.x ? -1 : 1;
    await anim.tween(0.7, (p) => { bus.x = to.x + (home.x - to.x) * p; bus.y = to.y + (home.y - to.y) * p; }, anim.ease.easeInQuad);
    bus.dir = -1;
    bus.driving = false;
  }

  async function verspaetung() {
    say(EVENT_MSG.verspaetung);
    info.flash = 1.4;
    await anim.wait(1.0);
  }

  return {
    eventIcons,
    pathLabels,
    drawStatic,
    /** extra visuals for an event space; resolves when the show is over (never needed to be awaited for correctness) */
    event(eventId, spaceId) {
      if (EVENT_MSG[eventId]) say(EVENT_MSG[eventId]);
      if (eventId === 'zugfaelltaus') return zugFaelltAus();
      if (eventId === 'schienenersatz') return ersatzbus(spaceId);
      if (eventId === 'verspaetung') return verspaetung();
      return null;
    },
  };
}

function sign(d, text, x, y, angle) {
  d.rect(x, y, 170, 34, '#102a5c', { anchor: 'center', r: 5, line: 3, angle, lineColor: '#ffffff' });
  d.text(text, x, y, 16, '#ffffff', { angle, line: 0 });
}

function drawTicketMachine(d, s) {
  const x = s.x - 110, y = s.y + 62;
  d.rect(x + 8, y + 10, 220, 112, '#000000', { a: 0.25 });
  d.rect(x, y, 220, 112, '#2c3340', { r: 8, line: 4 });
  d.rect(x - 4, y - 8, 228, 30, '#d7263d', { r: 6, line: 3 });
  d.text('DEUTSCHLANDTICKET', x + 110, y + 7, 15, '#ffffff', { line: 0 });
  d.rect(x + 14, y + 32, 120, 60, '#103a7a', { r: 5, line: 3, lineColor: '#9fd0ff' });
  d.text('Jetzt NEU:', x + 74, y + 48, 14, '#ffe9a0', { line: 0 });
  d.text('Preis: variabel', x + 74, y + 70, 12, '#ffffff', { line: 0 });
  for (let i = 0; i < 6; i++) d.rect(x + 150 + (i % 2) * 28, y + 34 + Math.floor(i / 2) * 18, 22, 12, ['#3ecf7a', '#ffd23a', '#ef4b5a'][Math.floor(i / 2)], { r: 3 });
  d.rect(x + 150, y + 92, 56, 8, '#0b0e14', { r: 3 });
}

function drawTaxi(d, x, y) {
  d.ellipse(x, y + 26, 62, 9, '#000000', { a: 0.3 });
  d.rect(x - 56, y - 14, 112, 34, '#f4d03a', { r: 10, line: 4 });
  d.rect(x - 30, y - 34, 60, 24, '#f4d03a', { r: 8, line: 4 });
  d.rect(x - 24, y - 30, 22, 14, '#79c7ff', { r: 3 });
  d.rect(x + 2, y - 30, 22, 14, '#79c7ff', { r: 3 });
  d.rect(x - 12, y - 44, 24, 11, '#fff7c2', { r: 3, line: 2 });
  d.text('TAXI', x, y - 38, 10, '#1e1a2e', { line: 0 });
  for (const wx of [-34, 34]) d.circle(x + wx, y + 20, 10, '#222', { line: 3, lineColor: '#888' });
}

function drawRegional(d, x, y) {
  for (let i = 0; i < 3; i++) {
    const cx = x + i * 150;
    d.rect(cx, y - 28, 144, 40, i === 0 ? '#d44a2f' : '#f2f2f2', { r: 8, line: 3 });
    d.rect(cx, y - 8, 144, 8, '#d44a2f');
    for (let w = 0; w < 4; w++) d.rect(cx + 12 + w * 33, y - 22, 22, 11, '#26324d', { r: 2 });
  }
  d.text('RE 9', x + 72, y + 2, 12, '#ffffff', { line: 0 });
}

function drawContainers(d, x, y) {
  const cols = ['#2a6fdb', '#d7263d', '#e8a317', '#3ecf7a', '#9b5de5', '#2a6fdb', '#d7263d'];
  d.rect(x - 20, y + 4, cols.length * 98 + 40, 12, '#2b2f36', { r: 3 });
  cols.forEach((c, i) => { d.rect(x + i * 98, y - 30, 92, 36, c, { r: 3, line: 3 }); d.line(x + i * 98 + 14, y - 28, x + i * 98 + 14, y + 4, 2, shade(c, -0.3)); d.line(x + i * 98 + 46, y - 28, x + i * 98 + 46, y + 4, 2, shade(c, -0.3)); });
}

function drawBus(d, bus, t) {
  const { x, y, dir } = bus;
  const bob = bus.driving ? Math.sin(t * 30) * 2 : 0;
  const f = dir;
  d.ellipse(x, y + 36, 100, 11, '#000000', { a: 0.3 });
  d.rect(x - 90, y - 40 + bob, 180, 66, '#f4f4f4', { r: 12, line: 4 });
  d.rect(x - 90, y - 2 + bob, 180, 10, '#ff9d1f');
  for (let i = 0; i < 5; i++) d.rect(x - 78 + i * 28 + (f > 0 ? 0 : 10), y - 28 + bob, 20, 16, '#79c7ff', { r: 3 });
  d.rect(x + f * 74 - 12, y - 30 + bob, 24, 22, '#79c7ff', { r: 3 });
  d.rect(x - 40, y - 52 + bob, 80, 16, '#14110a', { r: 3 });
  d.dtext('SEV Nirgendwo', x, y - 44 + bob, 11, '#ffb020', { line: 0 });
  for (const wx of [-52, 52]) d.circle(x + wx, y + 26 + bob, 12, '#222', { line: 3, lineColor: '#999' });
  if (bus.driving) d.circle(x + f * 92, y - 4 + bob, 7, '#fff7c2', { a: 0.9 });
}
