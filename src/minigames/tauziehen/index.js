// "Pfand-Tauziehen" (team, host-simulated). Rules: sim.js (pure, tested). Drawing: client.js.
import { mountTauziehen } from './client.js';
import { DURATION_MS, hostInit, hostStep, hostResult } from './sim.js';

export default {
  id: 'tauziehen',
  name: 'Pfand-Tauziehen',
  instructions: 'Zwei Teams ziehen an einem Seil, in der Mitte hängt der Pfandkasten! Hämmert abwechselnd auf die zwei Knöpfe: Abwechseln zählt doppelt, nur einen Knopf kloppen zählt halb. Wer zu wild rödelt, wird müde. Wessen Linie der Kasten zuerst erreicht, gewinnt.',
  controlHints: ['{key:Leertaste} / {A} und {key:E} / {X}  abwechselnd hämmern!'],
  durationMs: DURATION_MS,
  clientMount: mountTauziehen,
  hostInit,
  hostStep,
  hostResult,
};
