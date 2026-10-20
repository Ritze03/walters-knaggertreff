// Board 1 "Späti-Kiez" (D10). PURE data + event handlers: no DOM, no Kaplay (core runs this headless in node).
// Rendering lives in ../decor/spaeti.js, keyed by this board's id and space ids.
import { MAX_ITEMS, ITEM, ITEM_INFO } from '../../contracts.js';

/** compact table: [id, type, x, y, next[], eventId, label] */
const NO = undefined;
const T = [
  // Hauptstraße unten (West -> Ost)
  ['s00', 'start', 240, 1200, ['s01'], NO, 'Start'],
  ['s01', 'blue', 380, 1200, ['s02']],
  ['s02', 'red', 520, 1200, ['s03']],
  ['s03', 'event', 660, 1200, ['s04'], 'pfandautomat', 'Pfandautomat'],
  ['s04', 'blue', 800, 1200, ['s05']],
  ['s05', 'blue', 940, 1200, ['s06', 'h1']],            // Weggabelung: geradeaus oder durch den Hinterhof
  ['s06', 'red', 1080, 1200, ['s07']],
  ['s07', 'shop', 1220, 1200, ['s08'], NO, 'Späti Eck'],
  ['s08', 'blue', 1360, 1200, ['s09']],
  ['s09', 'blue', 1500, 1200, ['s10']],
  ['s10', 'red', 1640, 1170, ['s11']],
  ['s11', 'blue', 1750, 1080, ['s12']],
  // Karl-Marx-Allee rechts (Süd -> Nord)
  ['s12', 'event', 1860, 960, ['s13'], 'doener', 'Döner-Bude'],
  ['s13', 'blue', 1900, 820, ['s14']],
  ['s14', 'red', 1900, 680, ['s15']],
  ['s15', 'blue', 1870, 540, ['s16']],
  ['s16', 'blue', 1790, 420, ['s17']],
  ['s17', 'blue', 1680, 330, ['s18']],
  // Spreeufer oben (Ost -> West)
  ['s18', 'red', 1540, 250, ['s19']],
  ['s19', 'blue', 1400, 250, ['s20']],
  ['s20', 'blue', 1260, 250, ['s21', 't1']],            // Weggabelung: Ufer oder Spätkauf-Passage
  ['s21', 'blue', 1120, 250, ['s22']],
  ['s22', 'event', 980, 250, ['s23'], 'mittwoch', 'Mittwoch'],
  ['s23', 'blue', 840, 250, ['s24']],
  ['s24', 'blue', 700, 250, ['s25']],
  ['s25', 'red', 570, 260, ['s26']],
  ['s26', 'blue', 450, 340, ['s27']],
  // Kastanienallee links (Nord -> Süd)
  ['s27', 'event', 360, 450, ['s28'], 'ordnungsamt', 'Ordnungsamt'],
  ['s28', 'blue', 320, 590, ['s29']],
  ['s29', 'red', 300, 730, ['s30']],
  ['s30', 'blue', 290, 870, ['s31']],
  ['s31', 'event', 280, 1000, ['s32'], 'rabatt', 'Spätkauf-Rabatt'],
  ['s32', 'blue', 250, 1100, ['s00']],
  // Hinterhof (Umweg von s05 nach s08) -- hier kommt die Müllabfuhr
  ['h1', 'blue', 940, 1060, ['h2']],
  ['h2', 'event', 1060, 990, ['h3'], 'muellabfuhr', 'Müllabfuhr'],
  ['h3', 'blue', 1190, 1000, ['h4']],
  ['h4', 'red', 1310, 1070, ['s08']],
  // Spätkauf-Passage (Umweg von s20 nach s23)
  ['t1', 'blue', 1260, 410, ['t2']],
  ['t2', 'shop', 1120, 440, ['t3'], NO, 'Spätkauf 24/7'],
  ['t3', 'event', 980, 410, ['t4'], 'ordnungsamt', 'Ordnungsamt'],
  ['t4', 'red', 850, 370, ['s23']],
];

const HINTERHOF = ['h1', 'h2', 'h3', 'h4'];
const itemIds = Object.keys(ITEM);

const coins = (seat, delta) => ({ type: 'coins', seat, delta });
const full = (state, seat) => state.players[seat].items.length >= MAX_ITEMS;

export default {
  id: 'spaeti',
  name: 'Späti-Kiez',
  blurb: 'Pfandflaschen sammeln, Döner ergattern und dem Ordnungsamt ausweichen.',
  world: { w: 2200, h: 1400 },
  theme: { bg: '#241d3b', accent: '#ffb400' },
  startSpaceId: 's00',
  spaces: T.map(([id, type, x, y, next, eventId, label]) => ({ id, type, x, y, next, ...(eventId ? { eventId } : {}), ...(label ? { label } : {}) })),
  starSpaceIds: ['s04', 's16', 's24', 's30', 'h3'],
  events: {
    ordnungsamt: ({ state, seat }) => (state.players[seat].coins > 0
      ? { banner: 'Ordnungsamt kontrolliert — 5 Pfand Bußgeld!', lineId: 'ordnungsamt', sfx: 'coinLoss', effects: [coins(seat, -5)] }
      : { banner: 'Ordnungsamt kontrolliert — bei dir ist nichts zu holen.', lineId: 'ordnungsamt', sfx: 'bump', effects: [] }),

    doener: ({ state, seat }) => (full(state, seat)
      ? { banner: 'Döner mit alles — aber deine Taschen sind voll. +3 Pfand Trinkgeld!', lineId: 'doener', sfx: 'coinGain', effects: [coins(seat, 3)] }
      : { banner: 'Döner mit alles — +1 Goldener Döner!', lineId: 'doener', sfx: 'item', effects: [{ type: 'giveItem', seat, item: ITEM.goldenDoener }] }),

    pfandautomat: ({ seat, rng }) => (rng.next() < 0.5
      ? { banner: 'Pfandautomat kaputt — Flaschen weg, 3 Pfand verloren!', lineId: 'jam', sfx: 'coinLoss', effects: [coins(seat, -3)] }
      : { banner: 'Pfandautomat spuckt Bons aus — +4 Pfand!', lineId: 'pfand', sfx: 'coinGain', effects: [coins(seat, 4)] }),

    mittwoch: ({ seat }) => ({ banner: 'Es ist Mittwoch, meine Kerle! 🐸 +4 Pfand', lineId: 'mittwoch', sfx: 'coinGain', effects: [coins(seat, 4)] }),

    rabatt: ({ state, seat, rng }) => {
      if (full(state, seat)) return { banner: 'Spätkauf-Rabatt — aber du kannst nichts mehr tragen. +2 Pfand!', sfx: 'coinGain', effects: [coins(seat, 2)] };
      const item = rng.pick(itemIds);
      return { banner: `Spätkauf-Rabatt! ${ITEM_INFO[item].name} heute gratis!`, lineId: 'itemGot', sfx: 'item', effects: [{ type: 'giveItem', seat, item }] };
    },

    // Board-Hazard: alle, die gerade im Hinterhof stehen (auch der Auslöser), müssen zurück zum Start.
    muellabfuhr: ({ state, board }) => ({
      banner: 'Die Müllabfuhr kommt! Alle im Hinterhof zurück zum Start!',
      lineId: 'dasCrazy',
      sfx: 'whoosh',
      effects: state.players.flatMap((p, seat) => (HINTERHOF.includes(p.spaceId) ? [{ type: 'moveTo', seat, spaceId: board.startSpaceId }] : [])),
    }),
  },
};
