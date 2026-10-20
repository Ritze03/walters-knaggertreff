// Menu navigation for every DOM panel: arrows/stick/D-pad via input.onNav, A/Enter confirms. Panels wrap their widgets in row()s;
// left/right move inside a row, up/down jump between rows (keeping the column where possible).
const SELECTOR = 'button:not([disabled]), input:not([disabled])';

export function createNav({ input, audio, root }) {
  let panel = null;

  const rows = () => [...panel.querySelectorAll('[data-row]')].map((r) => [...r.querySelectorAll(SELECTOR)]).filter((r) => r.length);

  function move(dir) {
    const all = rows();
    if (!all.length) return;
    const active = document.activeElement;
    let r = all.findIndex((items) => items.includes(active));
    if (r < 0) { all[0][0].focus(); return; }
    let c = all[r].indexOf(active);
    if (dir === 'left') c = Math.max(0, c - 1);
    else if (dir === 'right') c = Math.min(all[r].length - 1, c + 1);
    else {
      r = Math.max(0, Math.min(all.length - 1, r + (dir === 'down' ? 1 : -1)));
      c = Math.min(c, all[r].length - 1);
    }
    if (all[r][c] !== active) { all[r][c].focus(); audio.sfx('menuMove'); }
  }

  input.onNav((n) => {
    if (!panel?.isConnected || n === 'back') return;
    if (n !== 'confirm') return move(n);
    const el = document.activeElement;
    if (el && panel.contains(el) && el.tagName === 'BUTTON') el.click();
    else move('down');
  });

  // The Input layer already turns Enter/Space into 'confirm'; stop the browser from also "clicking" the focused button.
  const swallow = (e) => {
    if (panel?.contains(e.target) && e.target.tagName === 'BUTTON' && ['Enter', 'NumpadEnter', 'Space'].includes(e.code)) e.preventDefault();
  };
  document.addEventListener('keydown', swallow, true);
  document.addEventListener('keyup', swallow, true);
  // Text fields are ignored by the Input layer, so they handle their own Enter/Escape.
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName !== 'INPUT' || !panel?.contains(e.target)) return;
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); e.target.dispatchEvent(new Event('change')); move('down'); }
    else if (e.code === 'Escape') e.target.blur();
  });
  root.addEventListener('click', (e) => { if (e.target.closest?.('button')) audio.sfx('menuSelect'); });

  return {
    /** The visible panel (null = none). `first` gets the initial focus. */
    setPanel(el, first) {
      panel = el;
      if (el && first) setTimeout(() => first.focus(), 0);
    },
  };
}
