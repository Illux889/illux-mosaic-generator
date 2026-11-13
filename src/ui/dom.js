/** Illux Mosaik — small DOM helpers and inline icons (no external icon font). */

/** Collect every [data-ref] element under root into an object keyed by ref name. */
export function collectRefs(root) {
  const refs = {};
  for (const node of root.querySelectorAll('[data-ref]')) refs[node.dataset.ref] = node;
  return refs;
}

/** Create an element with properties and children. */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const svg = path => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + path + '</svg>';

export const ICONS = {
  image: svg('<rect x="3" y="3" width="18" height="18"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>'),
  images: svg('<rect x="7" y="7" width="14" height="14"/><path d="M3 17V3h14"/><path d="m21 17-4-4-6 6"/>'),
  close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  swap: svg('<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  fit: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  fullscreen: svg('<path d="M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5"/>'),
  exitFullscreen: svg('<path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5"/>'),
  download: svg('<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>'),
  lock: svg('<rect x="4" y="11" width="16" height="10"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>'),
  refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'),
  upload: svg('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'),
  arrowRight: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  arrowLeft: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  check: svg('<path d="m5 12 5 5 9-10"/>'),
  checkCircle: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>'),
  alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.01"/>'),
  spinner: '<svg class="ilx-mosaic-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M12 3a9 9 0 1 1-9 9" /></svg>'
};
