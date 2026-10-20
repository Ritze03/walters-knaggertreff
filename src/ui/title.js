// Title screen with the profile picker and create/join. Returns { el, first }.
import { HATS, NAME_MAX, PLAYER_COLORS, parseGameIdFromHash } from '../contracts.js';
import { h, row } from './dom.js';
import { blob, hatGlyph, HAT_LABEL } from './avatar.js';
import { menuHints } from './hints.js';

const NAMES = ['Döner-Dieter', 'Aura-Andi', 'Pfandpaul', 'Späti-Sven', 'Kevin', 'Chantal', 'Yallah-Yusuf', 'Schnitzel', 'Bernd', 'Monte-Mo'];
const TAGLINES = ['Das crazy.', 'Aura +1000.', 'Pfand gehört in die Kiste.', 'Monte man, yes!', 'Forza ist fertig heruntergeladen.', 'Yallah, auf geht’s!'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function randomProfile() {
  return { name: pick(NAMES), color: pick(PLAYER_COLORS), hat: pick(HATS) };
}

/** a stored profile if it is valid, else a random one (per field: an old hat id like 'party'/'beanie' falls back to 'none') */
function startProfile(stored) {
  const rnd = randomProfile();
  return {
    name: typeof stored?.name === 'string' && stored.name.trim() ? stored.name.slice(0, NAME_MAX) : rnd.name,
    color: PLAYER_COLORS.includes(stored?.color) ? stored.color : rnd.color,
    hat: HATS.includes(stored?.hat) ? stored.hat : stored ? 'none' : rnd.hat,
  };
}

/**
 * @param o.stored   saved profile or null
 * @param o.gameId   id from the invite link hash, or null
 * @param o.canCreate true when there is no hash, or the hash is a game this browser hosts
 * @param o.bot      ?bot: random profile and (with an invite) join without a click
 * @param o.message  German error text to show (e.g. a reject reason)
 * @param o.onCreate (profile) => void;  o.onJoin (profile, gameId) => void
 */
export function buildTitle({ stored, gameId, canCreate, bot, message, toast, onCreate, onJoin }) {
  const p = bot ? { ...randomProfile(), name: `${pick(NAMES)} ${Math.floor(Math.random() * 90 + 10)}`.slice(0, NAME_MAX) } : startProfile(stored);
  const wednesday = new Date().getDay() === 3;

  const preview = h('div', { class: 'preview' });
  const nameInput = h('input', {
    testid: 'name', type: 'text', maxlength: NAME_MAX, value: p.name, autocomplete: 'off', 'aria-label': 'Name', placeholder: 'Dein Name',
    oninput: () => { p.name = nameInput.value; },
  });
  const colorBtns = PLAYER_COLORS.map((c, i) => h('button', {
    class: 'swatch', testid: `color-${i}`, style: `--c:${c}`, 'aria-label': `Farbe ${i + 1}`, onclick: () => { p.color = c; refresh(); },
  }));
  const hatBtns = HATS.map((hat) => h('button', {
    class: 'hatbtn', testid: `hat-${hat}`, title: HAT_LABEL[hat], 'aria-label': HAT_LABEL[hat], onclick: () => { p.hat = hat; refresh(); },
  }, hat === 'none' ? '🚫' : hatGlyph(hat)));
  const joinInput = gameId ? null : h('input', {
    testid: 'join-input', type: 'text', autocomplete: 'off', placeholder: 'Einladungslink einfügen', 'aria-label': 'Einladungslink',
  });

  function refresh() {
    preview.replaceChildren(blob(p, 96));
    colorBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(PLAYER_COLORS[i] === p.color)));
    hatBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(HATS[i] === p.hat)));
  }

  function profile() {
    const name = nameInput.value.trim().slice(0, NAME_MAX);
    if (!name) { toast('Ohne Namen geht das nicht, Bro.'); nameInput.focus(); return null; }
    return { name, color: p.color, hat: p.hat };
  }

  function join() {
    const prof = profile();
    if (!prof) return;
    const id = gameId ?? parseGameIdFromHash(String(joinInput.value).trim().split('#').pop());
    if (!id) return toast('Das ist kein gültiger Einladungslink.');
    onJoin(prof, id);
  }
  const create = () => { const prof = profile(); if (prof) onCreate(prof); };

  const actions = row({ class: 'actions' },
    canCreate && h('button', { class: 'big', testid: 'create', onclick: create }, 'Spiel erstellen'),
    h('button', { class: canCreate ? '' : 'big', testid: 'join', onclick: join }, 'Beitreten'),
  );

  const el = h('div', { class: 'card title', testid: 'title' },
    h('h1', null, 'Walters Knaggertreff'),
    h('p', { class: 'tagline' }, wednesday ? 'Es ist Mittwoch, meine Kerle!' : pick(TAGLINES)),
    preview,
    h('label', { class: 'field' }, 'Name', row({}, nameInput)),
    row({ class: 'swatches' }, colorBtns),
    row({ class: 'swatches' }, hatBtns),
    joinInput && row({ class: 'field' }, joinInput),
    actions,
    h('p', { class: 'message', testid: 'title-message', role: 'alert' }, message || (gameId ? 'Du wurdest eingeladen.' : '')),
    menuHints(),
  );
  refresh();

  if (bot && gameId && !message) setTimeout(join, 0);
  return { el, first: nameInput };
}
