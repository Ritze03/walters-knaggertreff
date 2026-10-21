// "Pfandautomat" (solo). Feed bottles into the reverse-vending machine in rhythm; junk and bad timing jam it. Rules and scoring: seq.js.
import { mountPfand } from './client.js';
import { DURATION_MS } from './seq.js';
import { HINT } from '../../ui/glyphs.js';

export default {
  id: 'pfand',
  name: 'Pfandautomat',
  instructions: 'Pfand-Flaschen im grünen Fenster einwerfen: 0,25 €.\nMüll (Socke, Glas, Döner): Wegwerfen (Q / B)!\nMate-Kiste: 1 €, aber nur GENAU MITTIG einwerfen!\nZu früh, zu spät, schief: klemmt! Hämmern (E / X)',
  controlHints: ['{key:Leertaste} / {A} Einwerfen', `${HINT.mgBack} Wegwerfen`, '{key:E} / {X} Hämmern (wenn er klemmt)'],
  durationMs: DURATION_MS,
  clientMount: mountPfand,
};
