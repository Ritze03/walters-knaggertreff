// "Bürgeramt-Stempel" (solo). A grumpy official gives orders; only obey on "Bitte", and trust his word, not his sign. Rules: logic.js. Drawing: client.js.
import { mountBuergeramt } from './client.js';
import { DURATION_MS } from './logic.js';

export default {
  id: 'buergeramt',
  name: 'Bürgeramt-Stempel',
  instructions: 'Der Sachbearbeiter gibt Befehle – aber du gehorchst nur, wenn er „Bitte“ sagt! Und du hörst auf sein WORT, nicht auf das Schild, das er hochhält. Ohne „Bitte“ heißt: Finger weg. Drei Fehler, dann ist Feierabend.',
  controlHints: ['{key:Leertaste} / {A} Stempel GRÜN  {key:E} / {X} Stempel ROT', '{key:←} Abheften  {key:→} Wegwerfen'],
  durationMs: DURATION_MS,
  clientMount: mountBuergeramt,
};
