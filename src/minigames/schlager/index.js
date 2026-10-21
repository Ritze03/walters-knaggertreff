// "Schlager Hero" (solo). Hit the falling notes on the beat of a procedural Schlager loop. Song, chart and rules: song.js; band: synth.js.
import { mountSchlager } from './client.js';
import { DURATION_MS } from './song.js';

export default {
  id: 'schlager',
  name: 'Schlager Hero',
  instructions: 'Im Bierzelt spielt die Kapelle auf! Triff die Noten genau auf der Linie, sammle Combos und löse ab 10 Treffern die Schlager-Ekstase aus. Danebengehauen heißt Combo weg!',
  controlHints: ['{DPAD} / {LS} / {key:WASD} / {key:←↓↑→}  Pfeile im Takt treffen'],
  durationMs: DURATION_MS,
  clientMount: mountSchlager,
};
