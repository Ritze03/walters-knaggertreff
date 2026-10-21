// "Only Up: Knaggerturm" (solo, 3D). Rules + physics: sim.js (pure, tested). Scene: world.js. Controls, HUD, thumbnails and the bot: client.js.
import { preload3D } from '../three3d.js';
import { mountOnlyUp } from './client.js';
import { DURATION_MS } from './sim.js';

export default {
  id: 'onlyup',
  name: 'Nur nach oben: Knaggerturm',
  instructions: 'Der Knaggerturm ist schwebender Sperrmüll aus Pfandkästen, Döner-Spießen und einer Riesen-Mate-Flasche. Hüpf nach oben: Wer abstürzt, landet weiter unten und verliert Zeit. Am schnellsten oben gewinnt, sonst zählt die größte Höhe.',
  controlHints: ['{key:WASD} / {LS} / {DPAD} Laufen (zur Kamera)', '{key:Leertaste} / {A} Springen'],
  durationMs: DURATION_MS,
  preload: () => preload3D(),
  clientMount: mountOnlyUp,
};
