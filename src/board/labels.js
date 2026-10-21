// Space-label placement. PURE (no Kaplay): scene.js draws what this returns, labels.test.js asserts it for every board.
//
// A label is a pill (text + padding). Each labelled space tries a short list of spots, in order, and takes the first one that is free:
//   event + start spaces:  below the tile, then above the token stack
//   other spaces:          above the token stack, then below the tile
// each spot first as is, then pushed further out and sideways. "Free" means the pill overlaps
//   - no other label,
//   - no tile disc (any space), so a label never sits on a neighbouring tile,
//   - not the token zone of its own space (up to four avatars standing on it, hats included).
// Positions are static (never depend on who stands where), so labels never jump around.

export const LABEL_SIZE = 19;
export const LABEL_PAD_X = 9, LABEL_H = LABEL_SIZE + 9;     // the pill around the text
const MARGIN = 4;                                           // keep-clear gap around a pill
const DISC_EXTRA = 6;                                       // outline + shadow around a tile disc
/** the box (relative to the space centre) that avatars standing on the space can cover: 4 on a space, fan + hats */
export const TOKEN_ZONE = { x0: -62, x1: 62, y0: -97, y1: 15 };

export const TILE_R = { start: 46, blue: 36, red: 36, event: 38, shop: 50 };
export const tileRadius = (sp) => TILE_R[sp.type] ?? 36;

const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const discHits = (b, cx, cy, r) => {
  const dx = Math.max(b.x0 - cx, 0, cx - b.x1), dy = Math.max(b.y0 - cy, 0, cy - b.y1);
  return dx * dx + dy * dy < r * r;
};
const grow = (b, m) => ({ x0: b.x0 - m, x1: b.x1 + m, y0: b.y0 - m, y1: b.y1 + m });

/**
 * @param board BoardDef (spaces with optional `label`)
 * @param measure (text, size) => text width in px
 * @returns Map spaceId -> { x, y (pill centre), w, h, x0, x1, y0, y1 (pill box) }
 */
export function layoutLabels(board, measure) {
  const out = new Map();
  const discs = board.spaces.map((s) => ({ x: s.x, y: s.y, r: tileRadius(s) + DISC_EXTRA }));
  for (const sp of board.spaces) {
    if (!sp.label) continue;
    const r = tileRadius(sp), w = measure(sp.label, LABEL_SIZE) + 2 * LABEL_PAD_X, h = LABEL_H;
    const zone = { x0: sp.x + TOKEN_ZONE.x0, x1: sp.x + TOKEN_ZONE.x1, y0: sp.y + TOKEN_ZONE.y0, y1: sp.y + TOKEN_ZONE.y1 };
    const below = (extra) => sp.y + r + 8 + h / 2 + extra;
    const above = (extra) => sp.y + TOKEN_ZONE.y0 - 2 - h / 2 - extra;
    const side = sp.type === 'event' || sp.type === 'start' ? 'below' : 'above';
    const order = side === 'below' ? [below, above] : [above, below];
    const spots = [];
    order.forEach((yAt, i) => {
      for (const extra of [0, 22, 44]) for (const dx of [0, -50, 50, -100, 100]) spots.push({ cost: i * 60 + extra + Math.abs(dx) * 0.6, x: sp.x + dx, y: yAt(extra) });
    });
    for (const dir of [-1, 1]) spots.push({ cost: 130, x: sp.x + dir * (TOKEN_ZONE.x1 + 4 + w / 2), y: sp.y });   // last resort: beside the tile
    spots.sort((a, b) => a.cost - b.cost);   // stable: ties keep the preferred side first
    const box = (s) => ({ x0: s.x - w / 2, x1: s.x + w / 2, y0: s.y - h / 2, y1: s.y + h / 2 });
    const bad = (s) => {
      const b = box(s), g = grow(b, MARGIN);
      let n = 0;
      for (const o of out.values()) if (overlaps(g, o)) n++;
      for (const dsc of discs) if (discHits(grow(b, 2), dsc.x, dsc.y, dsc.r)) n++;
      if (overlaps(b, zone)) n++;
      return n;
    };
    let best = spots[0], bestBad = Infinity;
    for (const s of spots) { const n = bad(s); if (n < bestBad) { best = s; bestBad = n; } if (!n) break; }
    out.set(sp.id, { id: sp.id, x: best.x, y: best.y, w, h, ...box(best), clash: bestBad });
  }
  return out;
}

/** every pair of labels (and label vs own token zone) that still overlaps: [] on a good board */
export function labelProblems(board, measure) {
  const L = [...layoutLabels(board, measure).values()], bad = [];
  for (let i = 0; i < L.length; i++) {
    for (let j = i + 1; j < L.length; j++) if (overlaps(L[i], L[j])) bad.push(`${L[i].id} x ${L[j].id}`);
    const sp = board.spaces.find((s) => s.id === L[i].id);
    const zone = { x0: sp.x + TOKEN_ZONE.x0, x1: sp.x + TOKEN_ZONE.x1, y0: sp.y + TOKEN_ZONE.y0, y1: sp.y + TOKEN_ZONE.y1 };
    if (overlaps(L[i], zone)) bad.push(`${L[i].id} under its own tokens`);
    for (const o of board.spaces) if (discHits(L[i], o.x, o.y, tileRadius(o))) bad.push(`${L[i].id} covers tile ${o.id}`);
  }
  return bad;
}
