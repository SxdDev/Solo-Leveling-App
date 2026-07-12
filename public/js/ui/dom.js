// dom.js — the whole "framework". A builder, a sheet, a toast. That's the discipline (§2.1).

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

export const svg = (tag, props = {}) => {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(props)) if (v != null) n.setAttribute(k, v);
  return n;
};

export const panel = (opts, ...children) => el('div', { class: `panel ${opts.class || ''}`, ...opts }, ...children);

export function sheet(title, buildBody) {
  const scrim = el('div', { class: 'scrim' });
  const s = el('div', { class: 'sheet' }, el('div', { class: 'sheet-grab' }));
  const close = () => {
    scrim.classList.remove('open');
    s.classList.remove('open');
    setTimeout(() => { scrim.remove(); s.remove(); }, 300);
  };
  if (title) s.append(el('h1', { class: 'screen' }, title));
  s.append(buildBody(close));
  scrim.addEventListener('click', close);
  document.body.append(scrim, s);
  requestAnimationFrame(() => { scrim.classList.add('open'); s.classList.add('open'); });
  return close;
}

let toastTimer;
export function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = el('div', { class: 'toast' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 250);
  }, 2200);
}

/** A3 — the +XP chip that lifts off the row that earned it. */
export function flyUp(anchor, amount) {
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  const chip = el('div', { class: 'flyup' }, `+${amount} XP`);
  chip.style.left = `${r.right - 70}px`;
  chip.style.top = `${r.top + 6}px`;
  document.body.append(chip);
  setTimeout(() => chip.remove(), 650);
}

export function confirmDialog(title, body, confirmLabel, onConfirm, { danger = false } = {}) {
  sheet(title, (close) => el('div', { class: 'stack' },
    el('p', { class: 'muted' }, body),
    el('div', { class: 'btn-row', style: { marginTop: '16px' } },
      el('button', { class: 'btn ghost', onClick: close }, 'Cancel'),
      el('button', {
        class: `btn ${danger ? 'danger' : 'primary'}`,
        onClick: () => { close(); onConfirm(); },
      }, confirmLabel),
    ),
  ));
}
