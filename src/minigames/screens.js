// The runner's own full-screen views: instructions ("Bereit!") and results. Kaplay shapes/text only, built under a parent object.
import { SCREEN, TIMING, rankOf } from '../contracts.js';
import { box, label, setText } from './draw.js';
import { addHint } from './hint.js';

const INK = '#1b2a49';
const bg = (k, parent) => {
  box(k, parent, 0, 0, SCREEN.w, SCREEN.h, '#1b2a49');
  for (let i = -2; i < 12; i++) box(k, parent, i * 130, 0, 60, SCREEN.h * 2, '#22345a', { angle: -12 });   // diagonal stripes
};

/** Instructions + controls + who is ready. Returns {update(state, msLeft)}. `addAvatar(profile, {size, showName, parent})` is the ctx wrapper. */
export function buildIntro({ k, parent, mod, desc, state, participant, addAvatar }) {
  bg(k, parent);
  const duel = desc.purpose === 'duel';
  label(k, parent, duel ? `⚔️ DUELL${state.rules?.duelStake ? ` · Einsatz ${state.rules.duelStake} Flaschen` : ''}` : '🎮 MINISPIEL', SCREEN.w / 2, 46, { size: 28, color: '#ffd43b', outline: [5, INK] });
  label(k, parent, mod.name, SCREEN.w / 2, 120, { size: 66, color: '#ffffff', outline: [8, '#c0392b'] });
  label(k, parent, mod.instructions, SCREEN.w / 2, 200, { size: 26, width: 940, align: 'center', anchor: 'top', color: '#f2e8d5', lineSpacing: 8 });
  box(k, parent, 190, 372, 900, 52 + mod.controlHints.length * 36, '#000000', { radius: 14, opacity: 0.35, outline: [3, '#ffd43b'] });
  label(k, parent, 'Steuerung', SCREEN.w / 2, 392, { size: 22, color: '#ffd43b' });
  mod.controlHints.forEach((h, i) => addHint(k, parent, h, SCREEN.w / 2, 432 + i * 36, { size: 24 }));   // tokens like {A} {key:Enter}: src/ui/glyphs.js

  const seats = desc.seats;
  const gap = Math.min(190, 1100 / Math.max(1, seats.length));
  const status = seats.map((s, i) => {
    const x = SCREEN.w / 2 + (i - (seats.length - 1) / 2) * gap;
    const av = addAvatar(state.seats[s].profile, { size: 62, showName: true, parent });
    av.pos = k.vec2(x, 560);
    return label(k, parent, '…', x, 632, { size: 20, color: '#aaaaaa' });
  });
  const prompt = label(k, parent, '', SCREEN.w / 2, 686, { size: 30, color: '#ffffff', outline: [5, INK] });
  const readyHint = addHint(k, parent, '{key:Enter} / {key:Leertaste} / {A} Bereit!', SCREEN.w / 2, 686, { size: 30, outline: [5, INK] });
  const timer = label(k, parent, '', 24, 28, { size: 20, anchor: 'left', color: '#aaaaaa' });   // top-left: the DOM sound control covers the top-right corner

  return {
    update(st, msLeft, selfReady) {
      const ready = st.minigame?.ready ?? [];
      seats.forEach((s, i) => {
        const online = st.seats[s].connected !== false;
        setText(status[i], !online ? 'offline' : ready.includes(s) ? '✓ Bereit!' : 'wartet…');
        status[i].color = k.rgb(!online ? '#777777' : ready.includes(s) ? '#8ce99a' : '#aaaaaa');
      });
      const pulse = 0.65 + 0.35 * Math.abs(Math.sin(k.time() * 4));
      const waiting = participant && !selfReady;
      readyHint.hidden = !waiting;
      prompt.hidden = waiting;
      if (waiting) readyHint.setOpacity(pulse);
      setText(prompt, !participant ? '👀 Du schaust diesmal nur zu' : 'Warte auf die anderen…');
      setText(timer, msLeft > 0 ? `Start in ${Math.ceil(msLeft / 1000)} s` : '');
    },
  };
}

/** Placements with labels and coin changes. Returns {update(msSinceStart)}. */
export function buildResults({ k, parent, mod, desc, state, selfSeat, addAvatar }) {
  bg(k, parent);
  const res = desc.results ?? { placements: [] };
  const delta = desc.coinDelta ?? {};
  const duel = desc.purpose === 'duel';
  label(k, parent, duel ? 'DUELL-ERGEBNIS' : 'ERGEBNIS', SCREEN.w / 2, 44, { size: 52, color: '#ffd43b', outline: [7, INK] });
  label(k, parent, mod?.name ?? desc.id, SCREEN.w / 2, 92, { size: 24, color: '#f2e8d5' });

  const rank = rankOf(res.placements);
  const rows = res.placements.flat();
  const rowH = Math.min(86, 520 / Math.max(1, rows.length));
  const medal = (r) => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `${r}.`);
  rows.forEach((s, i) => {
    const y = 140 + i * rowH + rowH / 2;
    const me = s === selfSeat;
    box(k, parent, 220, y - rowH / 2 + 4, 840, rowH - 8, me ? '#fff3a8' : '#000000', { radius: 14, opacity: me ? 0.9 : 0.35, outline: [me ? 4 : 2, me ? '#c98a00' : state.seats[s].profile.color] });
    label(k, parent, medal(rank[s]), 276, y, { size: Math.min(48, rowH * 0.6) });
    const av = addAvatar(state.seats[s].profile, { size: Math.min(44, rowH * 0.55), parent });
    av.pos = k.vec2(366, y + 8);
    label(k, parent, state.seats[s].profile.name, 420, desc.results?.labels?.[s] ? y - rowH * 0.17 : y, { size: Math.min(30, rowH * 0.38), anchor: 'left', color: me ? '#1b2a49' : '#ffffff', width: 330 });
    if (res.labels?.[s]) label(k, parent, res.labels[s], 420, y + rowH * 0.2, { size: Math.min(20, rowH * 0.26), anchor: 'left', color: me ? '#5a4a00' : '#c8c8d8', width: 420 });
    const d = delta[s] ?? 0;
    label(k, parent, '🍾', 1030, y, { size: Math.min(34, rowH * 0.45), anchor: 'right' });   // own label: emoji must not be tinted
    label(k, parent, `${d > 0 ? '+' : ''}${d}`, 972, y, { size: Math.min(40, rowH * 0.52), anchor: 'right', color: d > 0 ? (me ? '#2b8a3e' : '#8ce99a') : d < 0 ? (me ? '#c0392b' : '#ff8080') : '#8a8a8a' });
  });
  const bar = box(k, parent, 0, SCREEN.h - 10, SCREEN.w, 10, '#ffd43b');
  return {
    update(ms) { bar.width = SCREEN.w * Math.max(0, 1 - ms / TIMING.RESULTS_MS); },
    rank,
  };
}
