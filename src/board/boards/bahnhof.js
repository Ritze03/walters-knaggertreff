// Board 2 "DB Hauptbahnhof" (D14). PURE data + event handlers: no DOM, no Kaplay (core runs this headless in node).
// Affectionate parody of German rail travel: delays, "Grund: Ja", Schienenersatzverkehr. Rendering lives in ../decor/bahnhof.js.
import { MAX_ITEMS, ITEM, ITEM_INFO } from '../../contracts.js';

/** compact table: [id, type, x, y, next[], eventId, label] */
const NO = undefined;
const T = [
  // Bahnhofsvorplatz (West -> Ost)
  ['b00', 'start', 240, 1200, ['b01'], NO, 'Haupteingang'],
  ['b01', 'blue', 380, 1200, ['b02']],
  ['b02', 'red', 520, 1200, ['b03']],
  ['b03', 'event', 660, 1200, ['b04'], 'verspaetung', 'Durchsage'],
  ['b04', 'blue', 800, 1200, ['b05']],
  ['b05', 'blue', 940, 1200, ['b06', 'g1']],            // Weggabelung: Vorplatz oder quer durchs Gleisfeld
  ['b06', 'red', 1080, 1200, ['b07']],
  ['b07', 'shop', 1220, 1200, ['b08'], NO, 'Deutschlandticket'],
  ['b08', 'blue', 1360, 1200, ['b09']],
  ['b09', 'blue', 1500, 1200, ['b10']],
  ['b10', 'red', 1640, 1170, ['b11']],
  ['b11', 'blue', 1750, 1080, ['b12']],
  // Ostflügel (Süd -> Nord)
  ['b12', 'event', 1860, 960, ['b13'], 'schienenersatz', 'Ersatzbus'],
  ['b13', 'blue', 1900, 820, ['b14']],
  ['b14', 'red', 1900, 680, ['b15']],
  ['b15', 'blue', 1870, 540, ['b16']],
  ['b16', 'blue', 1790, 420, ['b17']],
  ['b17', 'blue', 1680, 330, ['b18']],
  // Bahnsteig oben (Ost -> West)
  ['b18', 'red', 1540, 250, ['b19']],
  ['b19', 'blue', 1400, 250, ['b20']],
  ['b20', 'blue', 1260, 250, ['b21', 't1']],            // Weggabelung: Bahnsteig oder Reisezentrum
  ['b21', 'blue', 1120, 250, ['b22']],
  ['b22', 'event', 980, 250, ['b23'], 'zugfaelltaus', 'Anzeigetafel'],
  ['b23', 'blue', 840, 250, ['b24']],
  ['b24', 'blue', 700, 250, ['b25']],
  ['b25', 'red', 570, 260, ['b26']],
  ['b26', 'blue', 450, 340, ['b27']],
  // Westflügel / Unterführung (Nord -> Süd)
  ['b27', 'event', 360, 450, ['b28'], 'kontrolle', 'Kontrolle'],
  ['b28', 'blue', 320, 590, ['b29']],
  ['b29', 'red', 300, 730, ['b30']],
  ['b30', 'blue', 290, 870, ['b31']],
  ['b31', 'event', 280, 1000, ['b32'], 'fundbuero', 'Fundbüro'],
  ['b32', 'blue', 250, 1100, ['b00']],
  // Gleisfeld (Umweg von b05 nach b08) -- hier fällt der Zug aus
  ['g1', 'blue', 940, 1060, ['g2'], NO, 'Gleis 7'],
  ['g2', 'event', 1060, 990, ['g3'], 'zugfaelltaus', 'Zug fällt aus'],
  ['g3', 'blue', 1190, 1000, ['g4']],
  ['g4', 'red', 1310, 1070, ['b08']],
  // Reisezentrum (Umweg von b20 nach b23)
  ['t1', 'blue', 1260, 410, ['t2']],
  ['t2', 'shop', 1120, 440, ['t3'], NO, 'Ticket-Schalter'],
  ['t3', 'event', 980, 410, ['t4'], 'gleiswechsel', 'Gleiswechsel'],
  ['t4', 'red', 850, 370, ['b23']],
];

/** the spaces that stand on the tracks: a cancelled train sends everybody here back to the start */
export const TRACK_IDS = Object.freeze(['g1', 'g2', 'g3', 'g4']);

/** where a space is, for the replacement bus announcement */
const zoneOf = (id) => {
  if (id.startsWith('t')) return 'im Reisezentrum';
  const n = +id.slice(1);
  if (n <= 11 || n === 32) return 'auf dem Bahnhofsvorplatz';
  if (n <= 17) return 'im Ostflügel';
  if (n <= 26) return 'auf dem Bahnsteig';
  return 'in der Unterführung';
};

const itemIds = Object.keys(ITEM);
const coins = (seat, delta) => ({ type: 'coins', seat, delta });
const full = (state, seat) => state.players[seat].items.length >= MAX_ITEMS;
const spaceOfSeat = (state, seat) => state.players[seat].spaceId;

export default {
  id: 'bahnhof',
  name: 'DB Hauptbahnhof',
  blurb: 'Zug fällt aus, Schienenersatzverkehr und Deutschlandticket. Grund: Ja.',
  world: { w: 2200, h: 1400 },
  theme: { bg: '#1b2531', accent: '#ff4a3d' },
  startSpaceId: 'b00',
  spaces: T.map(([id, type, x, y, next, eventId, label]) => ({ id, type, x, y, next, ...(eventId ? { eventId } : {}), ...(label ? { label } : {}) })),
  starSpaceIds: ['b04', 'b16', 'b24', 'b30', 'g3'],
  events: {
    // Board-Hazard: alle, die gerade im Gleisfeld stehen (auch der Auslöser), müssen zurück zum Start.
    zugfaelltaus: ({ state, board }) => {
      const onTrack = state.players.flatMap((p, seat) => (TRACK_IDS.includes(p.spaceId) ? [seat] : []));
      return {
        banner: onTrack.length
          ? 'Der Zug fällt aus! Grund: Ja. Alle im Gleisfeld zurück zum Start!'
          : 'Der Zug fällt aus! Zum Glück steht niemand im Gleisfeld.',
        lineId: 'zugFaelltAus',
        sfx: 'bahnDing',
        effects: onTrack.map((seat) => ({ type: 'moveTo', seat, spaceId: board.startSpaceId })),
      };
    },

    // Der Ersatzbus nimmt dich mit, irgendwohin (nie ins Gleisfeld, nie zum Start, nie zum Kiosk).
    schienenersatz: ({ state, seat, rng, board }) => {
      const here = spaceOfSeat(state, seat);
      const targets = board.spaces.filter((s) => s.type !== 'start' && s.type !== 'shop' && !TRACK_IDS.includes(s.id) && s.id !== here);
      const to = rng.pick(targets);
      return {
        banner: `Schienenersatzverkehr! Der Bus setzt dich ${zoneOf(to.id)} ab. Irgendwo.`,
        lineId: 'schienenersatz',
        sfx: 'whoosh',
        effects: [{ type: 'moveTo', seat, spaceId: to.id }],
      };
    },

    verspaetung: ({ seat, rng }) => {
      const r = rng.next();
      if (r < 0.45) return { banner: 'Ihr Zug hat 40 Minuten Verspätung. Fahrgastrechte: +4 Münzen!', lineId: 'verspaetung', sfx: 'coinGain', effects: [coins(seat, 4)] };
      if (r < 0.8) return { banner: 'Störung im Betriebsablauf! Kaffee to go am Bahnhof: -3 Münzen.', lineId: 'verspaetung', sfx: 'coinLoss', effects: [coins(seat, -3)] };
      return { banner: 'Weichenstörung! Du verpasst den Anschluss und wartest eine Runde.', lineId: 'weichenstoerung', sfx: 'bahnDing', effects: [{ type: 'skipTurns', seat, count: 1 }] };
    },

    kontrolle: ({ state, seat }) => (state.players[seat].coins > 0
      ? { banner: 'Fahrkartenkontrolle! Das Handy-Ticket hat 1 % Akku: 5 Münzen Bußgeld.', lineId: 'fahrkartenkontrolle', sfx: 'coinLoss', effects: [coins(seat, -5)] }
      : { banner: 'Fahrkartenkontrolle! Bei dir ist nichts zu holen, nicht mal ein Ticket.', sfx: 'bump', effects: [] }),

    fundbuero: ({ state, seat, rng }) => {
      if (full(state, seat)) return { banner: 'Fundbüro: Du kannst nichts mehr tragen. Finderlohn +2 Münzen!', sfx: 'coinGain', effects: [coins(seat, 2)] };
      const item = rng.pick(itemIds);
      return { banner: `Fundbüro! Jemand hat ${ITEM_INFO[item].name} liegen lassen. Jetzt gehört es dir.`, lineId: 'fundbuero', sfx: 'item', effects: [{ type: 'giveItem', seat, item }] };
    },

    // Der Zug fährt von Gleis 13 ab, nein, Gleis 7: du tauschst den Platz mit einem zufälligen Mitspieler.
    gleiswechsel: ({ state, seat, rng }) => {
      const here = spaceOfSeat(state, seat);
      const others = state.players.map((p, i) => i).filter((i) => i !== seat && spaceOfSeat(state, i) && spaceOfSeat(state, i) !== here);
      if (!others.length) return { banner: 'Gleiswechsel! Dein Zug fährt jetzt von Gleis 13. Nein, Gleis 7. Ach, bleib einfach hier.', sfx: 'bahnDing', effects: [] };
      const other = rng.pick(others);
      return {
        banner: 'Gleiswechsel! Ihr Zug fährt heute von einem ganz anderen Gleis: Platztausch!',
        lineId: 'gleiswechsel',
        sfx: 'whoosh',
        effects: [{ type: 'moveTo', seat, spaceId: spaceOfSeat(state, other) }, { type: 'moveTo', seat: other, spaceId: here }],
      };
    },
  },
};
