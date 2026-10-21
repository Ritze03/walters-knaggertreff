// Bürgeramt-Stempel: Kaplay client (main lane + live thumbnail). Rules/sequence: logic.js (pure). Voice lines: lines.js.
import { createRng } from '../../contracts.js';
import { box, disc, label, setText, ease, addHint } from '../draw.js';
import LINES from './lines.js';
import { CMD_TEXT, NOTHING_TEXT, SIGN_TEXT, LIVES, PLAY_MS, makeTurns, judge, windowMs, gapMs, speedBonus, scoreOf } from './logic.js';

const CMD_COLOR = ['#2e9e44', '#d63b2f', '#3f6fb5', '#6b7280'];
const CMD_DARK = ['#1f8a3a', '#c62d22', '#2a5fa8', '#555b66'];
const ICON = ['🟢', '🔴', '📎', '🗑️'];
const DONE_TEXT = ['GESTEMPELT', 'GESTEMPELT', 'ABGEHEFTET', 'ENTSORGT'];
const OK_MSG = ['Gestempelt!', 'Läuft!', 'Zack, bewilligt!', 'Sehr gut!'];
// station layout on the desk: [cmd, name, hint, centre x]
const STATIONS = [[2, 'ABHEFTEN', '{key:←}', 215], [0, 'GRÜN', '{key:Leertaste} / {A}', 405], [1, 'ROT', '{key:E} / {X}', 595], [3, 'WEGWERFEN', '{key:→}', 785]];
const BAR = { x: 130, y: 454, w: 700, h: 12 };
const OFF = { x: 230, y: 205 };   // the official's head centre
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function mountBuergeramt(ctx) {
  const { k, root, input, audio } = ctx;
  const thumb = ctx.view === 'thumb';
  const profile = ctx.seats.find((s) => s.index === ctx.seat)?.profile ?? { name: '?', color: '#ffb400', hat: 'none' };
  const turns = makeTurns(ctx.rng);
  const botRng = createRng((ctx.seed ^ Math.imul(ctx.selfSeat + 1, 0x9E3779B1)) >>> 0);

  // ---- scene: the Schalter ----
  box(k, root, 0, 0, 960, 720, '#e8e1cc');                         // office wall
  box(k, root, 20, 108, 920, 340, '#cfd8e0', { outline: [8, '#7a5230'] });   // the counter window
  box(k, root, 28, 116, 904, 6, '#e9f0f5');
  box(k, root, 700, 136, 190, 44, '#1b2a49', { radius: 6 });
  label(k, root, 'SCHALTER 3', 795, 158, { size: 22, color: '#ffd43b' });
  // official (generic grumpy blob)
  const off = root.add([k.pos(0, 0)]);
  box(k, off, OFF.x - 92, OFF.y + 58, 184, 200, '#6f7f9f', { radius: 50 });
  box(k, off, OFF.x - 14, OFF.y + 66, 28, 90, '#ffffff');
  box(k, off, OFF.x - 9, OFF.y + 70, 18, 100, '#b3261e', { radius: 4 });
  disc(k, off, OFF.x, OFF.y, 66, '#f0d6b4', { outline: [4, '#8a6a4a'] });
  box(k, off, OFF.x - 38, OFF.y - 70, 76, 14, '#9a9a9a', { radius: 7 });
  for (const sx of [-1, 1]) {
    disc(k, off, OFF.x + sx * 26, OFF.y - 14, 19, '#ffffff', { outline: [5, '#222222'] });
    disc(k, off, OFF.x + sx * 26, OFF.y - 12, 7, '#111111');
  }
  box(k, off, OFF.x - 8, OFF.y - 16, 16, 4, '#222222', { anchor: 'center' });   // glasses bridge
  const browL = box(k, off, OFF.x - 28, OFF.y - 44, 40, 8, '#4a3b2a', { anchor: 'center', radius: 4, angle: 1 });
  const browR = box(k, off, OFF.x + 28, OFF.y - 44, 40, 8, '#4a3b2a', { anchor: 'center', radius: 4, angle: 1 });
  box(k, off, OFF.x, OFF.y + 14, 64, 16, '#4a3b2a', { anchor: 'center', radius: 8 });   // moustache
  const mouth = box(k, off, OFF.x, OFF.y + 32, 44, 8, '#5a2a2a', { anchor: 'center', radius: 4 });
  // the form he holds
  const paper = root.add([k.pos(OFF.x, 372), k.rotate(-3)]);
  box(k, paper, 0, 0, 230, 124, '#fffdf2', { anchor: 'center', outline: [3, '#8a7f60'] });
  const formTxt = label(k, paper, '', 0, -34, { size: 21, color: '#1b2a49' });
  for (let r = 0; r < 3; r++) box(k, paper, -90, -4 + r * 20, r === 2 ? 110 : 180, 6, '#c9c3ab', { radius: 3 });
  const stampLbl = label(k, paper, '', 8, 22, { size: 24, color: '#d63b2f', angle: -12, outline: [4, '#ffffff'], opacity: 0 });
  // the sign on a stick
  box(k, root, 424, 340, 12, 110, '#7a5230');
  const sign = root.add([k.pos(430, 300)]);
  const signBg = box(k, sign, 0, 0, 160, 120, '#6b7280', { anchor: 'center', radius: 10, outline: [5, '#ffffff'] });
  label(k, sign, 'SCHILD', 0, -46, { size: 14, color: '#ffffff', opacity: 0.8 });
  const signIcon = label(k, sign, '', 0, -8, { size: 46 });
  const signTxt = label(k, sign, '', 0, 40, { size: 22, outline: [3, '#000000'] });
  // speech bubble
  const bubble = root.add([k.pos(735, 205), k.scale(1)]);
  bubble.add([k.pos(-210, 22), k.polygon([k.vec2(0, -12), k.vec2(0, 12), k.vec2(-40, 0)]), k.color(k.rgb('#1b2a49'))]);
  box(k, bubble, 0, 0, 424, 150, '#ffffff', { anchor: 'center', radius: 22, outline: [5, '#1b2a49'] });
  const line1 = label(k, bubble, '', 0, -36, { size: 34, color: '#1b2a49' });
  const line2 = label(k, bubble, '', 0, 22, { size: 40, color: '#1b2a49' });
  // desk
  box(k, root, 0, 448, 960, 272, '#a0713f');
  box(k, root, 0, 448, 960, 10, '#c9955a');
  // status bar + rule strip
  box(k, root, 0, 0, 960, 62, '#1b2a49');
  const hearts = [];
  for (let i = 0; i < LIVES; i++) hearts.push(label(k, root, '❤️', 40 + i * 48, 32, { size: 34 }));
  label(k, root, 'Bürgeramt', 480, 32, { size: 28, color: '#ffd43b' });
  const countTxt = label(k, root, '0 Stempel', 930, 32, { size: 34, anchor: 'right' });
  box(k, root, 0, 66, 960, 34, '#ffd43b');
  label(k, root, 'Nur bei „Bitte“ hören – und auf sein WORT, nicht aufs Schild!', 480, 84, { size: 21, color: '#1b2a49' });
  const msg = label(k, root, '', thumb ? 480 : 570, thumb ? 480 : 672, { size: thumb ? 44 : 32, outline: [5, '#3a2410'] });

  // main lane: timer bar + the four stations; thumbnail: big count instead
  const stations = {};
  let timerFill = null;
  let big = null, bigSub = null;
  if (!thumb) {
    box(k, root, BAR.x - 3, BAR.y - 3, BAR.w + 6, BAR.h + 6, '#3a2410', { radius: 6 });
    timerFill = box(k, root, BAR.x, BAR.y, BAR.w, BAR.h, '#8ce99a', { radius: 4 });
    for (const [cmd, name, hint, cx] of STATIONS) {
      const g = root.add([k.pos(cx, 530), k.scale(1)]);
      box(k, g, 0, 0, 180, 104, CMD_COLOR[cmd], { anchor: 'center', radius: 14, outline: [5, '#ffffff'] });
      label(k, g, ICON[cmd], 0, -20, { size: 40 });
      label(k, g, name, 0, 28, { size: 22, outline: [3, '#000000'] });
      addHint(k, root, hint, cx, 604, { size: 17, outline: [3, '#3a2410'] });
      stations[cmd] = g;
    }
  } else {
    big = label(k, root, '0', 600, 540, { size: 130, outline: [7, '#3a2410'] });
    bigSub = label(k, root, 'Stempel', 600, 628, { size: 40, outline: [5, '#3a2410'] });
  }
  const av = ctx.addAvatar(profile, { size: thumb ? 100 : 64, showName: true });
  av.pos = thumb ? k.vec2(150, 560) : k.vec2(130, 650);

  // ---- state ----
  let phase = 'wait';   // wait | turn | gap | done
  let i = 0, turn = turns.at(0), tIn = 0, gapLeft = 0, playMs = 0;
  let lives = LIVES, n = 0, bonus = 0, res = 0;   // res: 0 live, 1 ok, 2 wrong/late, 3 safe, 4 over
  let finished = false, popAge = 9, stampAge = Infinity, shake = 0, msgAge = Infinity, lastSay = -9, lastKey = '';
  const pulse = [0, 0, 0, 0];
  let remote = { n: 0, l: LIVES, i: 0, s: 0 };
  let shownI = -1, shownS = -1;

  function setMood(m) {
    browL.angle = m === 'ok' ? -4 : m === 'bad' ? 28 : 14;
    browR.angle = m === 'ok' ? 4 : m === 'bad' ? -28 : -14;
    browL.pos.y = browR.pos.y = OFF.y + (m === 'ok' ? -52 : m === 'bad' ? -40 : -44);
    mouth.width = m === 'ok' ? 34 : m === 'bad' ? 52 : 44;
    mouth.height = m === 'ok' ? 20 : m === 'bad' ? 24 : 8;
    mouth.radius = mouth.height / 2;
    mouth.color = k.rgb(m === 'idle' ? '#5a2a2a' : '#8a2f2f');
  }
  setMood('idle');
  if (!thumb) setText(line2, '…');

  function showTurn(t) {
    popAge = 0; stampAge = Infinity;
    setText(formTxt, t.form);
    setText(line1, t.opener);
    line1.color = k.rgb(t.polite ? '#1f8a3a' : '#c62d22');
    setText(line2, t.cmd < 0 ? NOTHING_TEXT : CMD_TEXT[t.cmd]);
    line2.color = k.rgb(t.cmd < 0 ? '#1b2a49' : CMD_DARK[t.cmd]);
    signBg.color = k.rgb(CMD_COLOR[t.sign]);
    setText(signIcon, ICON[t.sign]);
    setText(signTxt, SIGN_TEXT[t.sign]);
    stampLbl.opacity = 0;
    setMood('idle');
  }

  function showResult(r, t, action) {
    stampAge = 0;
    const ok = r === 1, safe = r === 3;
    setText(stampLbl, ok ? DONE_TEXT[t.expect] : safe ? 'STANDHAFT' : 'ABGELEHNT');
    stampLbl.color = k.rgb(ok ? CMD_COLOR[t.expect] : safe ? '#3f6fb5' : '#d63b2f');
    setMood(ok || safe ? 'ok' : 'bad');
    if (!thumb) {
      msgAge = 0;
      let m;
      if (ok) m = pick(OK_MSG);
      else if (safe) m = 'Standhaft geblieben!';
      else if (action < 0) m = 'Zu langsam!';
      else if (t.expect < 0) m = t.cmd < 0 ? 'Er sagte: NICHT!' : 'Kein „Bitte“ – Finger weg!';
      else if (action === t.sign && t.sign !== t.cmd) m = 'Aufs Schild reingefallen!';
      else m = 'Falsch!';
      setText(msg, m);
      msg.color = k.rgb(ok || safe ? '#8ce99a' : '#ff8a7a');
    }
  }

  function say(key, gapSec = 6) {
    if (thumb || playMs / 1000 - lastSay < gapSec) return;
    lastSay = playMs / 1000;
    audio.say(pick(LINES[key]));
  }

  function startTurn() {
    turn = turns.at(i);
    tIn = 0; phase = 'turn'; res = 0;
    showTurn(turn);
    setText(msg, '');
  }

  function finishNow(reason) {
    if (finished) return;
    finished = true; phase = 'done'; res = 4;
    if (reason === 'over') { setMood('bad'); setText(msg, 'Feierabend!'); msg.color = k.rgb('#ff8a7a'); msgAge = 0; audio.sfx('lose'); say('over', 0); }
    else { setMood('ok'); setText(msg, 'Schalter geschlossen!'); msg.color = k.rgb('#ffd43b'); msgAge = 0; audio.sfx('win'); say('done', 0); }
    ctx.finish({ score: scoreOf(n, bonus), label: `${n} Stempel` });
  }

  function resolve(action) {
    const r = judge(turn, action);
    if (r === 'ok') {
      n++; bonus += speedBonus(tIn, windowMs(i)); res = 1;
      audio.sfx('stamp', { rate: 0.9 + Math.random() * 0.25 }); av.bounce();
    } else if (r === 'safe') {
      res = 3; audio.sfx('tick', { rate: 1.3 });
    } else {
      lives--; res = 2; shake = 0.45;
      audio.sfx(action < 0 ? 'error' : 'splat'); audio.sfx('boing', { volume: 0.5 });
      say('miss');
    }
    showResult(res, turn, action);
    if (lives <= 0) { finishNow('over'); return; }
    phase = 'gap';
    gapLeft = gapMs(i) + (res === 2 ? 320 : 0);
  }

  function readAction() {
    if (input.pressed('confirm') || input.pressed('jump')) return 0;
    if (input.pressed('action')) return 1;
    if (input.pressedDir('left')) return 2;
    if (input.pressedDir('right')) return 3;
    return -1;
  }

  function progress() {
    const key = `${i}|${n}|${lives}|${res}`;
    if (key === lastKey) return;
    lastKey = key;
    ctx.sendProgress({ i, n, l: lives, s: res });
  }

  function paint(dt, count, lv) {
    hearts.forEach((h, idx) => setText(h, idx < lv ? '❤️' : '🖤'));
    setText(countTxt, `${count} Stempel`);
    if (big) { setText(big, String(count)); setText(bigSub, 'Stempel'); }
    popAge += dt; stampAge += dt; msgAge += dt; shake = Math.max(0, shake - dt);
    bubble.scale = k.vec2(0.82 + 0.18 * Math.min(1, popAge / 0.14));
    const sg = Math.min(1, stampAge / 0.12);
    stampLbl.scale = k.vec2(1 + (1 - sg) * 1.6);
    stampLbl.opacity = stampAge === Infinity ? 0 : 1;
    off.pos = shake > 0 ? k.vec2((Math.random() - 0.5) * 14 * shake * 2, (Math.random() - 0.5) * 8 * shake * 2) : k.vec2(0, 0);
    msg.opacity = msgAge < 3 || finished ? 1 : 0;
    for (const c of [0, 1, 2, 3]) {
      pulse[c] = Math.max(0, pulse[c] - dt * 5);
      if (stations[c]) stations[c].scale = k.vec2(1 - 0.14 * pulse[c]);
    }
  }

  root.onUpdate(() => {
    const dt = k.dt();
    if (thumb) {
      if (remote.i !== shownI || remote.s !== shownS) {
        const newTurn = remote.i !== shownI;
        turn = turns.at(remote.i);
        if (newTurn) showTurn(turn);
        if (remote.s === 1 || remote.s === 2 || remote.s === 3) showResult(remote.s, turn, -2);
        else if (remote.s === 4) { setMood(remote.l <= 0 ? 'bad' : 'ok'); setText(msg, remote.l <= 0 ? 'Feierabend!' : 'Geschlossen!'); msg.color = k.rgb('#ffd43b'); msgAge = 0; }
        if (remote.s !== 4 && remote.s !== 0) shake = remote.s === 2 ? 0.35 : 0;
        shownI = remote.i; shownS = remote.s;
      }
      paint(dt, remote.n, remote.l);
      return;
    }
    if (phase === 'wait') { paint(dt, 0, LIVES); return; }
    if (phase !== 'done') {
      playMs += dt * 1000;
      if (playMs >= PLAY_MS) finishNow('time');
    }
    if (phase === 'turn') {
      tIn += dt * 1000;
      const a = readAction();
      const w = windowMs(i);
      if (a >= 0) { pulse[a] = 1; resolve(a); }
      else if (tIn >= w) resolve(-1);
      if (timerFill) {
        const f = Math.max(0, 1 - tIn / w);
        timerFill.width = Math.max(0, BAR.w * f);
        timerFill.color = k.rgb(f < 0.3 ? '#ff6b5a' : f < 0.6 ? '#ffd43b' : '#8ce99a');
      }
    } else if (phase === 'gap') {
      gapLeft -= dt * 1000;
      if (timerFill) timerFill.width = Math.max(0, timerFill.width - dt * 2400);
      if (gapLeft <= 0) { i++; startTurn(); }
    }
    paint(dt, n, lives);
    progress();
  });

  // ---- bot: reacts after a human-ish delay with noise, sometimes falls for the sign, sometimes presses on a "don't" ----
  let botI = -1, plan = null;
  const press = (a) => (a === 0 ? { confirm: true } : a === 1 ? { action: true } : a === 2 ? { move: { x: -1, y: 0 } } : { move: { x: 1, y: 0 } });
  function botInput() {
    if (thumb || phase !== 'turn') return {};
    if (botI !== i) {
      botI = i;
      const react = 330 + botRng.next() * 420 + botRng.next() * 120 - Math.min(i * 5, 90);
      let act = turn.expect;
      const r1 = botRng.next(), r2 = botRng.next(), r3 = botRng.next();
      if (turn.expect < 0) { if (r1 < 0.1) act = Math.floor(r2 * 4); }
      else {
        if (turn.sign !== turn.cmd && r1 < 0.2) act = turn.sign;      // falls for the decoy
        else if (r2 < 0.04) act = (turn.expect + 1 + Math.floor(r3 * 3)) % 4;   // slip
        else if (r3 < 0.03) act = -1;                                   // dozes off
      }
      plan = { at: react, act, done: false };
    }
    if (!plan.done && plan.act >= 0 && tIn >= plan.at) { plan.done = true; return press(plan.act); }
    return {};
  }

  return {
    go() { if (phase === 'wait' && !thumb) { startTurn(); input.takeFrame?.(); audio.say(pick(LINES.start)); lastSay = 0; } },
    update(p) { if (thumb && p && typeof p === 'object') remote = { n: p.n ?? 0, l: p.l ?? LIVES, i: p.i ?? 0, s: p.s ?? 0 }; },
    botInput,
    destroy() {},   // everything hangs off root (the runner destroys it)
  };
}
