// "Forza lädt herunter" (solo). Stop the fake download bar as close to 100 % as possible. Rules, curve and scoring: curve.js.
import { mountForza } from './client.js';
import { DURATION_MS } from './curve.js';

export default {
  id: 'forza',
  name: 'Forza lädt herunter',
  instructions: 'Forza Horizon lädt herunter – und der Balken lügt, hängt und springt zurück. Stoppe ihn so nah wie möglich an 100\u00a0%. Drüber ist die Datei beschädigt! Du hast drei Versuche.',
  controlHints: ['{key:Enter} / {key:Leertaste} / {A} Download stoppen'],
  durationMs: DURATION_MS,
  clientMount: mountForza,
};
