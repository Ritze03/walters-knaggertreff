// "Bahnsteig-Chaos" (arena, host-simulated, three.js). Rules: sim.js (pure, tested). Drawing: client.js (three comes in lazily through mount3D).
import { preload3D } from '../three3d.js';
import { mountBahnsteig } from './client.js';
import { DURATION_MS, hostInit, hostStep, hostResult } from './sim.js';

export default {
  id: 'bahnsteig',
  name: 'Bahnsteig-Chaos',
  instructions: 'Der Bahnsteig fällt aus, Feld für Feld! Wackelnde Felder stürzen ab, also nichts wie runter von ihnen. Schubs die anderen auf die Gleise, aber Vorsicht vor dem ICE, der dich wegsaugt. Wer am Ende noch steht, gewinnt.',
  controlHints: ['{key:WASD} / {key:←↑↓→} / {LS} / {DPAD} Laufen', '{key:E} / {key:Shift} / {key:Leertaste} / {A} / {X} Schubsen'],
  durationMs: DURATION_MS,
  clientMount: mountBahnsteig,
  preload: () => preload3D(),
  hostInit,
  hostStep,
  hostResult,
};
