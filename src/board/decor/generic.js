// Fallback visuals for boards without their own decor/<boardId>.js: a plain night-time backdrop.
import { makeDraw } from '../draw.js';

export default function buildDecor({ k, board }) {
  const d = makeDraw(k);
  const drawStatic = () => {
    const { w, h } = board.world;
    d.rect(0, 0, w, h, board.theme.bg);
    d.rect(60, 60, w - 120, h - 120, '#ffffff', { r: 50, a: 0.06 });
  };
  return { eventIcons: {}, pathLabels: {}, drawStatic, event: () => null };
}
