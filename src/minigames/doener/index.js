// "Döner mit alles" (solo). Build the shown order as fast as possible. Orders, rules and scoring: order.js.
import { mountDoener } from './client.js';
import { DURATION_MS } from './order.js';

export default {
  id: 'doener',
  name: 'Döner mit alles',
  instructions: 'Der Kunde sagt, was er will: bau seinen Döner genau so nach, mit alles, ohne Zwiebel, extra Fleisch. Falsch gebaut heißt neu machen und der Kunde schimpft. Wer die meisten Döner raushaut, gewinnt.',
  controlHints: [
    '{key:E} / {X} Fleisch  {key:Esc} / {B} Scharf  {key:Enter} / {A} Servieren',
    '{DPAD} / {key:WASD}  Salat ↑  Tomate ↓  Zwiebel ←  Soße →',
  ],
  durationMs: DURATION_MS,
  clientMount: mountDoener,
};
