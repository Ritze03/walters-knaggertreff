// DOM layer (contracts section 11). One overlay element (#ui) above the Kaplay canvas: panels (title, connecting, lobby, victory),
// the HUD strip, mute button, caption bubble, toasts and the "Host ist weg" overlay. Knows nothing about sessions or core.
import { h } from './dom.js';
import { createNav } from './nav.js';
import { buildTitle } from './title.js';
import { buildLobby } from './lobby.js';
import { buildVictory } from './victory.js';
import { renderHud } from './hud.js';
import { hintBar } from './hints.js';

export function createUi({ parent, input, audio }) {
  const root = h('div', { id: 'ui' });
  const panelSlot = h('div', { class: 'panel-slot' });
  const hud = h('div', { class: 'hud' });
  const toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
  const caption = h('div', { class: 'caption', hidden: true });
  const hostGone = h('div', { class: 'overlay', testid: 'host-gone', role: 'alert', hidden: true },
    h('div', { class: 'card' }, h('h2', null, 'Host ist weg — warte…'), h('p', null, 'Sobald der Host denselben Link wieder öffnet, geht es weiter.')));
  const mute = h('button', {
    class: 'mute', testid: 'mute', title: 'Ton an/aus', 'aria-label': 'Ton an/aus',
    onclick: (e) => { audio.toggleMuted(); sync(); e.currentTarget.blur(); },
  });
  // master volume 0..100 (audio persists it). Native range: mouse drag, Tab + arrows/Home/End/PageUp/Down. It drops focus after a mouse drag
  // and on Enter/Escape, because the Input layer ignores keys while an <input> is focused (the game would stop reacting to arrows/space).
  let lastTick = 0;
  const volume = h('input', {
    class: 'volume', testid: 'volume', type: 'range', min: 0, max: 100, step: 5, 'aria-label': 'Lautstärke', title: 'Lautstärke',
    oninput: () => {
      audio.setMasterVolume(volume.value / 100);
      if (audio.isMuted() && volume.value > 0) audio.setMuted(false);   // turning it up means "I want sound"
      sync();
      const now = performance.now();
      if (now - lastTick > 120) { lastTick = now; audio.sfx('menuMove'); }
    },
    onpointerup: () => volume.blur(),
    onkeydown: (e) => { if (['Enter', 'NumpadEnter', 'Escape'].includes(e.code)) volume.blur(); },
  });
  volume.value = String(Math.round(audio.getMasterVolume() * 100));
  const sync = () => {
    const off = audio.isMuted() || audio.getMasterVolume() === 0;
    mute.textContent = off ? '🔇' : audio.getMasterVolume() < 0.4 ? '🔉' : '🔊';
    mute.setAttribute('aria-pressed', String(audio.isMuted()));
    volume.style.setProperty('--v', `${volume.value}%`);
    volume.classList.toggle('off', audio.isMuted());
  };
  sync();
  const sound = h('div', { class: 'sound' }, volume, mute);
  root.append(panelSlot, hud, caption, toasts, hostGone, sound);
  parent.append(root);

  const nav = createNav({ input, audio, root });
  let kind = null;
  let lobby = null;

  function toast(text) {
    const t = h('div', { class: 'toast' }, text);
    toasts.append(t);
    setTimeout(() => t.remove(), 3200);
  }

  let captionTimer;
  audio.onCaption((text) => {
    caption.textContent = text;
    caption.hidden = false;
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => { caption.hidden = true; }, Math.max(2200, text.length * 70));
  });

  function setPanel(next, built) {
    kind = next;
    lobby = null;
    panelSlot.replaceChildren(...(built ? [h('div', { class: 'panel' }, built.el)] : []));
    nav.setPanel(built ? panelSlot : null, built?.first);
  }

  return {
    toast,
    panelKind: () => kind,
    setHostGone: (on) => { hostGone.hidden = !on; },
    hidePanel: () => setPanel(null),
    renderHud: (state, selfSeat) => renderHud(hud, state, selfSeat),

    showTitle: (o) => setPanel('title', buildTitle({ ...o, toast })),
    showConnecting(text, onLeave) {
      const leave = h('button', { testid: 'leave', onclick: onLeave }, 'Abbrechen');
      setPanel('connecting', {
        first: leave,
        el: h('div', { class: 'card', testid: 'connecting' }, h('h2', null, text), h('div', { 'data-row': '', class: 'actions' }, leave), hintBar('{key:Enter} / {A} abbrechen')),
      });
    },
    showLobby(o) {
      const built = buildLobby({ ...o, toast });
      setPanel('lobby', built);
      lobby = built;
    },
    updateLobby: (state) => lobby?.update(state),
    showVictory: (o) => setPanel('victory', buildVictory(o)),
  };
}
