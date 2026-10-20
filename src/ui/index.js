// DOM layer (contracts section 11). One overlay element (#ui) above the Kaplay canvas: panels (title, connecting, lobby, victory),
// the HUD strip, mute button, caption bubble, toasts and the "Host ist weg" overlay. Knows nothing about sessions or core.
import { h } from './dom.js';
import { createNav } from './nav.js';
import { buildTitle } from './title.js';
import { buildLobby } from './lobby.js';
import { buildVictory } from './victory.js';
import { renderHud } from './hud.js';

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
  const sync = () => { mute.textContent = audio.isMuted() ? '🔇' : '🔊'; mute.setAttribute('aria-pressed', String(audio.isMuted())); };
  sync();
  root.append(panelSlot, hud, caption, toasts, hostGone, mute);
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
        el: h('div', { class: 'card', testid: 'connecting' }, h('h2', null, text), h('div', { 'data-row': '' }, leave)),
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
