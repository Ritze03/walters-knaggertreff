// "U-Bahn-Surfers" (solo, 3D). Rules + track + bot: sim.js / bot.js (pure, node-tested). 3D scene: world.js. Client: client.js.
import { mountUbahn } from './client.js';
import { preload3D } from '../three3d.js';
import { DURATION_MS } from './sim.js';

export default {
  id: 'ubahn',
  name: 'U-Bahn-Surfers',
  instructions: 'Du rennst durch den Tunnel, und die Züge fahren dir entgegen: Wer hupt und blinkt, kommt gleich! Wechsle die Spur, spring über E-Scooter und Pfandkisten, rutsch unter Absperrungen durch und weich Kontrolleuren und Zügen aus. Sammle Pfandflaschen: Distanz plus Pfand-Bonus zählt.',
  controlHints: ['{key:←} / {key:→} / {LS} / {DPAD} Spur wechseln', '{key:Leertaste} / {A} Springen  {key:↓} Rutschen'],
  durationMs: DURATION_MS,
  preload: () => preload3D(),
  clientMount: mountUbahn,
};
