// Forza lädt herunter: Kaplay client (main lane + thumbnail). The curve/scoring live in curve.js.
import { createRng } from '../../contracts.js';
import { box, label, decimal, ease, setText } from '../draw.js';
import { makeCurves, scoreAttempt, isOvershoot, isPerfect, ATTEMPTS, CAP, DURATION_MS } from './curve.js';

const BAR = { x: 90, y: 300, w: 720, h: 54 };
const INNER = BAR.w - 8;
const PAUSE_MS = 1500;
const STATUS = {
  wait: 'Bereit zum Download…', load: 'Lade Spieldateien…', hang: 'Verbinde mit Server…', rush: 'Lade Spieldateien…',
  stall: 'Fast fertig…', unpack: 'Entpacke Texturen…', crawl: 'Entpacke Autos… (kann dauern)', over: 'Entpacke Autos… (kann dauern)',
};
const TIMES = ['14 Std. 7 Min.', '3 Sek.', 'Unbekannt', '-12 Min.', 'noch lange', '1 Jahr', 'gleich', '99 Std.'];
const SPEEDS = ['0,3 KB/s', '847 MB/s', '12 Byte/s', '1,2 GB/s', 'Ja', '0 KB/s'];

export function mountForza(ctx) {
  const { k, root, input, audio } = ctx;
  const thumb = ctx.view === 'thumb';
  const profile = ctx.seats.find((s) => s.index === ctx.seat)?.profile ?? { name: '?', color: '#ffb400', hat: 'none' };
  const curves = thumb ? null : makeCurves(ctx.seed);
  const botRng = createRng((ctx.seed ^ Math.imul(ctx.selfSeat + 1, 0x9E3779B1)) >>> 0);
  const aims = Array.from({ length: ATTEMPTS }, () => 99.4 + Math.pow(botRng.next(), 1.5) * 1.0);   // seeded imprecision: ~1 in 4 overshoots

  // ---- scene ----
  box(k, root, 0, 0, 960, 720, '#5aa9e6');
  root.add([k.pos(480, 1150), k.circle(640), k.color(k.rgb('#4caf50'))]);   // Bliss-ish hill
  const win = root.add([k.pos(0, 0)]);
  box(k, win, 60, 70, 840, 520, '#ece9d8', { outline: [4, '#0a246a'] });
  box(k, win, 60, 70, 840, 40, '#0a58ca');
  box(k, win, 60, 70, 840, 18, '#2f7be0');
  label(k, win, 'Forza Horizon – Download-Assistent', 76, 90, { size: 20, anchor: 'left', outline: [2, '#0a246a'] });
  box(k, win, 862, 76, 30, 28, '#d9442c', { radius: 4, outline: [2, '#ffffff'] });
  label(k, win, 'X', 877, 90, { size: 20, outline: [2, '#7a1f10'] });
  label(k, win, '🏎️', 130, 180, { size: 72 });
  label(k, win, 'Forza Horizon wird heruntergeladen…', 190, 164, { size: 30, anchor: 'left', color: '#101010' });
  label(k, win, 'Bitte den PC nicht ausschalten. Oder doch. Egal.', 190, 204, { size: 18, anchor: 'left', color: '#555555' });
  const status = label(k, win, STATUS.wait, BAR.x, 272, { size: 22, anchor: 'left', color: '#101010' });
  // the bar: sunken frame, green fill, XP-style gaps on top, "100 %" flag
  box(k, win, BAR.x, BAR.y, BAR.w, BAR.h, '#ffffff', { outline: [3, '#7f9db9'] });
  const fill = box(k, win, BAR.x + 4, BAR.y + 4, 0, BAR.h - 8, '#2ecc40');
  for (let x = BAR.x + 20; x < BAR.x + BAR.w - 4; x += 20) box(k, win, x, BAR.y + 4, 4, BAR.h - 8, '#ffffff');
  box(k, win, BAR.x + BAR.w - 4, BAR.y - 16, 3, BAR.h + 32, '#d9442c');
  label(k, win, '100 %', BAR.x + BAR.w - 4, BAR.y - 28, { size: 18, color: '#d9442c' });
  const pct = label(k, win, '0,0 %', 480, 410, { size: thumb ? 110 : 88, color: '#101010' });
  const speedTxt = thumb ? null : label(k, win, 'Geschwindigkeit: 0,3 KB/s', 90, 500, { size: 18, anchor: 'left', color: '#555555' });
  const timeTxt = thumb ? null : label(k, win, 'Verbleibende Zeit: 14 Std.', 810, 500, { size: 18, anchor: 'right', color: '#555555' });
  box(k, win, 700, 540, 170, 34, '#ece9d8', { radius: 4, outline: [2, '#7f9db9'] });
  label(k, win, 'Abbrechen', 785, 557, { size: 18, color: '#808080' });
  const stampTitle = label(k, win, '', 480, 490, { size: 60, angle: -7, outline: [6, '#101010'], opacity: 0 });
  const stampSub = label(k, win, '', 480, 545, { size: 30, color: '#101010', opacity: 0 });
  // attempts row + avatar + hint
  const cells = [];
  for (let i = 0; i < ATTEMPTS; i++) {
    box(k, root, 300 + i * 150, 612, 140, 64, '#ece9d8', { radius: 6, outline: [3, '#0a246a'] });
    label(k, root, `Versuch ${i + 1}`, 370 + i * 150, 630, { size: 16, color: '#555555' });
    cells.push(label(k, root, '–', 370 + i * 150, 658, { size: 30, color: '#101010' }));
  }
  box(k, root, 760, 612, 170, 64, '#fff3a8', { radius: 6, outline: [3, '#c98a00'] });
  label(k, root, 'Summe', 845, 630, { size: 16, color: '#7a5200' });
  const totalTxt = label(k, root, '0', 845, 658, { size: 30, color: '#101010' });
  if (!thumb) label(k, root, 'Enter / Leertaste / A: Download stoppen (bei 100 %)', 480, 703, { size: 18, color: '#ffffff', outline: [3, '#0a246a'] });
  const av = ctx.addAvatar(profile, { size: 76, showName: true });
  av.pos = k.vec2(135, 640);

  // ---- state ----
  let phase = 'wait';           // wait | run | pause | done  (thumb: mirrors the remote p)
  let a = 0, t = 0, v = 0, since = 0, total = 0, elapsed = 0, shake = 0, stampAge = 9, perfectSaid = false, finished = false;
  const pts = [];
  let shown = 0, lastKey = '', stopped = false;
  let remote = { a: 0, v: 0, s: [], d: 0 };

  function render(dt, value, label0) {
    shown += (value - shown) * (thumb ? ease(dt, 14) : 1);
    if (!thumb) shown = value;
    const over = shown > 100;
    fill.width = Math.max(0, (shown / 100) * INNER);
    fill.color = over ? k.rgb('#e03c2c') : k.rgb('#2ecc40');
    setText(pct, `${decimal(shown)} %`);
    pct.color = over ? k.rgb('#e03c2c') : k.rgb('#101010');
    setText(status, label0);
    cells.forEach((c, i) => setText(c, pts[i] === undefined ? '–' : String(pts[i])));
    setText(totalTxt, String(pts.reduce((x, y) => x + y, 0)));
    if (speedTxt) {
      const n = Math.floor(k.time() * 1.3);
      setText(speedTxt, `Geschwindigkeit: ${SPEEDS[n % SPEEDS.length]}`);
      setText(timeTxt, `Verbleibende Zeit: ${TIMES[(n * 3 + a) % TIMES.length]}`);
    }
    stampAge += dt;
    const grow = Math.min(1, stampAge / 0.18);
    stampTitle.scale = k.vec2(1 + (1 - grow) * 1.4);
    stampTitle.opacity = stampAge < 8 && phase !== 'run' ? 1 : 0;
    stampSub.opacity = stampTitle.opacity;
    shake = Math.max(0, shake - dt);
    win.pos = shake > 0 ? k.vec2((Math.random() - 0.5) * 16 * shake, (Math.random() - 0.5) * 12 * shake) : k.vec2(0, 0);
  }

  function stamp(title, sub, color) {
    stampTitle.text = title;
    stampTitle.color = k.rgb(color);
    stampSub.text = sub;
    stampAge = 0;
  }

  function startAttempt() {
    phase = 'run'; t = 0; since = 0; v = 0; stopped = false;
    stampAge = 9;
  }

  function stop(value) {
    const r = Math.round(value * 10) / 10;
    v = r;
    const p = scoreAttempt(r);
    pts[a] = p; total += p;
    phase = 'pause'; since = 0; stopped = true;
    if (isOvershoot(r)) {
      stamp('DATEI BESCHÄDIGT!', `${decimal(r)} % – das war zu viel (+${p})`, '#ff5a4a');
      audio.sfx('splat'); audio.sfx('boing'); shake = 0.6; av.bounce();
    } else if (isPerfect(r)) {
      stamp('PERFEKT!', `${decimal(r)} % (+${p})`, '#ffd43b');
      audio.sfx('stamp'); audio.sfx('win'); av.bounce();
      if (!perfectSaid) { perfectSaid = true; audio.say('forza'); }
    } else {
      stamp(p > 750 ? 'Knapp!' : 'Gestoppt', `${decimal(r)} % (+${p})`, p > 750 ? '#8ce99a' : '#ffffff');
      audio.sfx('stamp'); av.bounce();
    }
    if (a === ATTEMPTS - 1) finishNow();
  }

  function finishNow() {
    if (finished) return;
    finished = true;
    ctx.finish({ score: total, label: `${total} Pkt.` });
  }

  function progress() {
    const key = `${a}|${v}|${phase}|${total}`;
    if (key === lastKey) return;
    lastKey = key;
    ctx.sendProgress({ a, v, s: pts.slice(), d: phase === 'run' ? 0 : phase === 'wait' ? 3 : finished ? 2 : 1 });
  }

  root.onUpdate(() => {
    const dt = k.dt();
    if (thumb) {
      const rv = remote.v;
      pts.length = 0; pts.push(...remote.s);
      a = remote.a;
      const prevPhase = phase;
      phase = remote.d === 0 ? 'run' : 'pause';
      if (phase === 'pause' && prevPhase === 'run') {
        const bad = rv > 100, great = isPerfect(rv);
        stamp(bad ? 'BESCHÄDIGT' : great ? 'PERFEKT!' : 'Gestoppt', `+${pts[a] ?? 0}`, bad ? '#ff5a4a' : great ? '#ffd43b' : '#ffffff');
      }
      render(dt, rv, remote.d === 3 ? STATUS.wait : `Versuch ${Math.min(a + 1, ATTEMPTS)} von ${ATTEMPTS}`);
      return;
    }
    if (phase !== 'wait') elapsed += dt * 1000;
    if (phase === 'run') {
      t += dt * 1000;
      const c = curves[a];
      v = Math.round(c.valueAt(t) * 10) / 10;
      if (input.pressed('confirm') || input.pressed('action')) stop(v);
      else if (t >= c.tCap) stop(CAP);
      else if (elapsed >= DURATION_MS - 400) { stop(v); finishNow(); }   // never outlive the module's durationMs
    } else if (phase === 'pause') {
      since += dt * 1000;
      if (finished) phase = 'done';
      else if (since >= PAUSE_MS) { a++; startAttempt(); }
    }
    const c = curves[a];
    render(dt, v, phase === 'run' ? STATUS[c.labelAt(t)] : phase === 'wait' ? STATUS.wait : stopped ? 'Download beendet.' : STATUS.wait);
    progress();
  });

  return {
    go() { if (phase === 'wait') { startAttempt(); input.takeFrame?.(); } },
    update(p) { if (thumb && p && typeof p === 'object') remote = { a: p.a ?? 0, v: p.v ?? 0, s: Array.isArray(p.s) ? p.s : [], d: p.d ?? 0 }; },
    botInput() {
      if (thumb || phase !== 'run') return {};
      const c = curves[a];
      // inject() reaches the game about two frames late: press early by (speed x latency)
      const speed = Math.max(0, c.valueAt(t + 100) - c.valueAt(t)) * 10;   // %/s
      if (v + speed * (k.dt() * 2 + 0.02) >= aims[a] && ['crawl', 'over'].includes(c.labelAt(t))) return { confirm: true };   // only the final crawl is worth stopping in
      return {};
    },
    destroy() {},   // everything hangs off root (the runner destroys it)
  };
}
