// "Pfandautomat" (solo). Feed bottles into the reverse-vending machine in rhythm; junk and bad timing jam it. Rules and scoring: seq.js.
import { mountPfand } from './client.js';
import { DURATION_MS } from './seq.js';
import { HINT } from '../../ui/glyphs.js';

export default {
  id: 'pfand',
  name: 'Pfandautomat',
  instructions: 'Flaschen und Dosen mit Pfand-Logo rollen zum Einwurf: Wirf sie genau im grünen Fenster ein, 0,25 € pro Stück. Socken, Gläser und Döner will der Automat nicht, und zu früh oder zu spät klemmt er. Hämmere ihn dann wieder frei!',
  controlHints: ['{key:Leertaste} / {A} Einwerfen', `${HINT.mgBack} Wegwerfen`, '{key:E} / {X} Hämmern (wenn er klemmt)'],
  durationMs: DURATION_MS,
  clientMount: mountPfand,
};
