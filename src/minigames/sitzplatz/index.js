// "Sitzplatz-Krieg im ICE" (team, host-simulated). Rules: sim.js (pure, tested). Drawing: client.js.
import { mountSitzplatz } from './client.js';
import { DURATION_MS, hostInit, hostStep, hostResult } from './sim.js';

export default {
  id: 'sitzplatz',
  name: 'Sitzplatz-Krieg im ICE',
  instructions: 'Der ICE ist rappelvoll und Wagen 7 hat nur 40 Sitze! Lauft über die Sitze, um sie in eurer Teamfarbe zu färben, und überfärbt die Sitze der anderen. Mit der Jacke reserviert ihr alle Plätze ringsum, aber der Schaffner rempelt jeden um. Das Team mit den meisten Sitzen gewinnt.',
  controlHints: ['{key:WASD} / {key:←↑↓→} / {LS} / {DPAD} Laufen', '{key:E} / {key:Shift} / {X} / {Y} Jacke werfen (reserviert die Sitze ringsum)'],
  durationMs: DURATION_MS,
  clientMount: mountSitzplatz,
  hostInit,
  hostStep,
  hostResult,
};
