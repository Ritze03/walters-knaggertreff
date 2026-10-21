// "Flappy Taube" (solo). One-button pigeon through a shared, seeded Berlin obstacle course. Rules: sim.js, bot: bot.js.
import { mountTaube } from './client.js';
import { DURATION_MS } from './sim.js';

export default {
  id: 'flappytaube',
  name: 'Flappy Taube',
  instructions: 'Du bist eine Berliner Taube und flatterst durch Lücken zwischen Plattenbau, Fernsehturm, Kran und Späti. Jede Lücke zählt, Brotkrümel geben Bonus. Wer irgendwo gegen knallt, ist raus!',
  controlHints: ['{key:Leertaste} / {key:Enter} / {A} Flattern'],
  durationMs: DURATION_MS,
  clientMount: mountTaube,
};
