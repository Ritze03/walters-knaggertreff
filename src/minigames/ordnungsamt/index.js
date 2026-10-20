// "Ordnungsamt-Flucht" (arena, host-simulated). Rules: sim.js (pure, tested). Drawing: client.js.
import { mountOrdnungsamt } from './client.js';
import { DURATION_MS, hostInit, hostStep, hostResult } from './sim.js';

export default {
  id: 'ordnungsamt',
  name: 'Ordnungsamt-Flucht',
  instructions: 'Das Ordnungsamt rollt über den Kiez-Platz! Weiche den Transportern aus, aber schubs auch die anderen vor die Kühler: Wer dreimal kontrolliert wird, ist raus. Der Letzte auf dem Platz gewinnt.',
  controlHints: ['WASD / Pfeile / Stick: Laufen', 'E / Shift / X: Rempeln (schubst andere weg)'],
  durationMs: DURATION_MS,
  clientMount: mountOrdnungsamt,
  hostInit,
  hostStep,
  hostResult,
};
