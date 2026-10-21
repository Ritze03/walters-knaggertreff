// "Doodle-Knagger" (solo). Endless 2D bounce-climb on squared notebook paper; score = max height. Rules + bot: sim.js. Drawing, controls, HUD: client.js.
import { mountDoodle } from './client.js';
import { DURATION_MS } from './sim.js';

export default {
  id: 'doodle',
  name: 'Doodle-Knagger',
  instructions: 'Dein Kritzelblob hüpft ganz von allein: Du steuerst nur links und rechts, der Bildschirmrand ist ein Portal. Pappe bricht, Döner-Federn katapultieren dich hoch, die Möwe klaut deinen Döner und das Ordnungsamt schickt Drohnen. Wer am höchsten kommt, gewinnt.',
  controlHints: ['{key:←}{key:→} / {key:A}{key:D} / {LS} / {DPAD} Steuern'],
  durationMs: DURATION_MS,
  clientMount: mountDoodle,
};
