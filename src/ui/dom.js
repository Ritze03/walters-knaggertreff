// Tiny DOM builder: h('button', { class: 'x', testid: 'start', onclick: fn }, 'Text', child, ...)
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [key, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (key === 'class') el.className = v;
    else if (key === 'testid') el.dataset.testid = v;
    else if (key === 'value') el.value = v;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), v);
    else el.setAttribute(key, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

/** Rows of focusable widgets for gamepad/keyboard menu navigation: wrap them in a row(). */
export const row = (props, ...kids) => h('div', { ...props, 'data-row': '' }, ...kids);
