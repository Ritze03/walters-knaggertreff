// "Aura-Farming" (arena, host-simulated). Rules: sim.js (pure, tested). Drawing: client.js. Voice lines: lines.js.
import { mountAura } from './client.js';
import { DURATION_MS, hostInit, hostStep, hostResult, hostAdopt } from './sim.js';

export default {
  id: 'aura',
  name: 'Aura-Farming',
  instructions: 'Sammle leuchtende Aura-Orbs, die goldenen Sigma-Orbs zählen tausend! Rempel die anderen an, dann verlieren sie Aura, die du dir schnappen kannst. Wer am Ende die meiste Aura hat, gewinnt.',
  controlHints: ['{key:WASD} / {key:←↑↓→} / {LS} / {DPAD} Laufen', '{key:E} / {key:Shift} / {key:Leertaste} / {A} / {X} Rempeln (klaut Aura)'],
  durationMs: DURATION_MS,
  clientMount: mountAura,
  hostInit,
  hostStep,
  hostResult,
  hostAdopt,   // owner-authoritative movement: the host adopts each player's reported body (client.js ownState)
};
