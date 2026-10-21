import test from 'node:test';
import assert from 'node:assert/strict';
import spaeti from './boards/spaeti.js';
import bahnhof from './boards/bahnhof.js';
import { layoutLabels, labelProblems, LABEL_H, TOKEN_ZONE } from './labels.js';

// the label font is monospace (0.6 em per char); 0.72 is a generous stand-in for a wider fallback font
const widthAt = (em) => (text, size) => [...text].length * em * size;
const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

for (const board of [spaeti, bahnhof]) {
  for (const em of [0.6, 0.72]) {
    test(`${board.id}: no two space labels overlap, none sits under its own tokens or on a tile (${em} em)`, () => {
      assert.deepEqual(labelProblems(board, widthAt(em)), []);
    });
  }
  test(`${board.id}: every labelled space gets a pill near it`, () => {
    const L = layoutLabels(board, widthAt(0.6));
    const labelled = board.spaces.filter((s) => s.label);
    assert.equal(L.size, labelled.length);
    for (const sp of labelled) {
      const l = L.get(sp.id);
      assert.equal(l.h, LABEL_H);
      assert.equal(l.clash, 0, `${sp.id} found no free spot`);
      assert.ok(Math.hypot(l.x - sp.x, l.y - sp.y) < 260, `${sp.id} label too far from its space`);
    }
  });
}

test('bahnhof: Zug fällt aus / Gleis 7 no longer overlap, Haupteingang is clear of the avatars standing on the start', () => {
  const L = layoutLabels(bahnhof, widthAt(0.6));
  assert.ok(!hit(L.get('g1'), L.get('g2')));
  const start = bahnhof.spaces.find((s) => s.id === 'b00');
  const zone = { x0: start.x + TOKEN_ZONE.x0, x1: start.x + TOKEN_ZONE.x1, y0: start.y + TOKEN_ZONE.y0, y1: start.y + TOKEN_ZONE.y1 };
  assert.ok(!hit(L.get('b00'), zone));
});

test('tile icons: Bahnhof has its own blue/red glyphs, Späti-Kiez keeps the defaults', () => {
  assert.deepEqual(bahnhof.tileIcons, { blue: '🚆', red: '🧾' });
  assert.equal(spaeti.tileIcons, undefined);
});
