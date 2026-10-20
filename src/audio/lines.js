// Voice-line catalog (German, goofy). Pure data + one picker: safe to import in node (core/sim/tests).
// Array = random variant. FIXED_LINES ids are single verbatim strings (contracts.js). Content rules: see contracts.js section 9.
import { FIXED_LINES } from '../contracts.js';

export const LINES = {
  // --- fixed memes (verbatim) ---
  forza: FIXED_LINES.forza,        // quote only
  monteYes: FIXED_LINES.monteYes,
  dasCrazy: FIXED_LINES.dasCrazy,
  aura: FIXED_LINES.aura,
  mittwoch: FIXED_LINES.mittwoch,
  yallah: FIXED_LINES.yallah,
  // --- more approved meme quotes ---
  sybau: ['Sybau!', 'Sybau, gib das zurück!', 'Sybau, das waren meine Münzen!', 'Sybau, ey, wirklich jetzt?'],
  nase: 'Ich küss deine Nase, großer ELoTRiX!',
  // --- announcer ---
  endspurt: [
    'Endspurt! Alle Münzfelder zählen doppelt, jetzt wird gerannt!',
    'Endspurt, meine Damen und Herren! Jetzt oder nie!',
    'Letzte Runden! Der Späti macht gleich zu!',
    'Endspurt! Der Wecker klingelt und der Döner wird kalt!',
  ],
  starBought: [
    'Ein Stern! Funkelt wie frisch geputzt.',
    'Stern gekauft! Das Finanzamt wird neidisch.',
    'Sternchen im Beutel, die Kasse stimmt!',
    'Ein neuer Stern am Himmel, und zwar in deiner Tasche!',
  ],
  duel: [
    'Duell! Auf die Plätze, fertig, Kebab!',
    'Zwei gehen rein, einer geht schlafen. Duell!',
    'Duell! Klärt das unter euch, ich hol Popcorn.',
    'Showdown am Späti!',
  ],
  yourTurn: [
    'Du bist dran!',
    'Dein Zug, Chef!',
    'Hallo? Jemand zuhause? Du bist dran!',
    'Du bist dran. Nimm dir Zeit, aber nicht zu viel.',
  ],
  rollDice: [
    'Ab dafür, würfel!',
    'Wirf den Würfel, es wird schon.',
    'Rollen, Meister!',
    'Zeig dem Würfel, wer der Chef ist!',
  ],
  coinsLost: [
    'Münzen weg! Hat der Hund gefressen.',
    'Au weia, das Portemonnaie weint.',
    'Ups, Münzen verloren. Gibt es im Fundbüro, ab Dienstag.',
    'Tschüss, Taschengeld!',
  ],
  trapTriggered: [
    'Falle! Mitten rein, wie ein Profi.',
    'Stolperfalle! Das tat nur beim Zugucken weh.',
    'Peng! Hättest du mal auf den Boden geguckt.',
    'Gestolpert! Aber elegant.',
  ],
  shopWelcome: [
    'Willkommen im Späti! Wir haben alles, außer Ruhe.',
    'Hereinspaziert! Kein Pfand, kein Problem.',
    'Moin! Heute im Angebot: Sterne und schlechte Entscheidungen.',
    'Willkommen! Bitte nichts anfassen, was du nicht bezahlen kannst.',
  ],
  noMoney: [
    'Zu wenig Geld, Kollege.',
    'Kein Geld, kein Stern. So ist das Leben.',
    'Das Konto sagt nein. Das Konto hat immer recht.',
    'Leider zu arm. Versuch es mit Pfandflaschen.',
  ],
  minigameGo: [
    'Los geht\'s!',
    'Und ab die Post!',
    'Alle Mann an die Tasten!',
    'Startschuss! Viel Spaß, ihr Nasen.',
  ],
  winner: [
    'Wir haben einen Gewinner! Applaus, Applaus!',
    'Gewonnen! Das gibt eine Runde Döner für alle, bezahlt von dir.',
    'Der Champion! Ehre, wem Ehre gebührt, und Döner.',
    'Sieg! Verdient, na ja, sagen wir: glücklich.',
  ],
  zugFaelltAus: [
    'Der Zug fällt heute leider aus.',
    'Achtung, Durchsage: Der Zug fällt aus. Grund: Ja.',
    'Ihr Zug fällt aus. Wir bitten um Verständnis, nicht um Beschwerden.',
    'Der Zug fällt aus wegen Zug.',
  ],
  schienenersatz: [
    'Schienenersatzverkehr! Der Bus ist unterwegs. Irgendwo.',
    'Achtung: Schienenersatzverkehr. Bitte sprinten Sie zum Bus.',
    'Heute mit Schienenersatzverkehr, jetzt mit noch mehr Abenteuer!',
    'Der Ersatzbus fährt am Hintereingang ab, hinter dem Hintereingang.',
  ],
  jam: [
    'Leergut wird nicht angenommen!',
    'Leergut wird nicht angenommen. Bitte Flasche wenden.',
    'Fehler: Flasche ist zu flaschig.',
  ],
  // --- extras (not required by the contract) ---
  ordnungsamt: [
    'Ordnungsamt! Alle Mann Ausweis zücken.',
    'Das Ordnungsamt kommt! Wer nicht parkt, hat nicht verloren.',
    'Ordnungsamt im Anmarsch! Gleich gibt es einen Strafzettel für gute Laune.',
  ],
  pfand: [
    'Pfandflaschen sind das neue Gold.',
    'Fünfundzwanzig Cent pro Flasche, davon träumst du nachts.',
    'Pfand! Der Reichtum wartet im Automaten.',
  ],
  doener: [
    'Döner mit allem! Und scharf!',
    'Mit Zwiebeln? Mit Zwiebeln!',
    'Der Döner ruft!',
    'Ein Döner geht noch.',
  ],
  itemGot: [
    'Ein Item! Was auch immer das jetzt nützt.',
    'Neues Spielzeug!',
    'Das Ding kann bestimmt irgendwas.',
  ],
  buergeramt: [
    'Bitte ziehen Sie eine Nummer. Ihre Nummer wird in drei bis sechs Wochen aufgerufen.',
    'Das Bürgeramt hat zu. Das Bürgeramt hatte immer zu.',
  ],
};

const last = {};
/** id -> random variant (never the same twice in a row); anything else is returned as raw text. */
export function pickLine(idOrText) {
  if (!Object.hasOwn(LINES, idOrText)) return String(idOrText ?? '');
  const v = LINES[idOrText];
  if (!Array.isArray(v)) return v;
  let i = Math.floor(Math.random() * v.length);
  if (v.length > 1 && i === last[idOrText]) i = (i + 1) % v.length;
  last[idOrText] = i;
  return v[i];
}
