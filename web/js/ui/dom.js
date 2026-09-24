/* Small DOM + formatting helpers. No framework, no build step. */

/**
 * Build an element. Attributes go in `props`; anything in `children` is
 * appended. Text children are created as text nodes, never parsed as HTML,
 * so incident text can never inject markup.
 */
export function h(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }

  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  return node;
}

/** Namespaced element builder for SVG content. */
export function svg(tag, props = {}, children = []) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'text') {
      node.textContent = value;
    } else {
      node.setAttribute(key, String(value));
    }
  }

  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function mount(root, ...nodes) {
  clear(root);
  for (const n of nodes) if (n) root.append(n);
}

/* ---------------- formatting ---------------- */

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Contracts guarantee timezone-aware UTC, so every timestamp in this UI is
 * rendered in UTC and labelled as such. Local time would silently disagree
 * with the audit log and the Call Brief.
 */
export function fmtUtcTime(date) {
  if (!date) return '--:--:--';
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

export function fmtUtcDateTime(date) {
  if (!date) return '';
  return `${DAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
    + ` · ${fmtUtcTime(date)}`;
}

export function fmtInt(n) {
  return Math.round(n || 0).toLocaleString('en-US');
}

/** 0.96 -> "0.96" */
export function fmtScore(n) {
  return (n || 0).toFixed(2);
}

/** 0.6843 -> "68%" */
export function fmtPct(n, digits = 0) {
  return `${((n || 0) * 100).toFixed(digits)}%`;
}

/** Already-percent value, e.g. 0.0006 -> "0.0006%" */
export function fmtPctValue(n, digits = 4) {
  const v = n || 0;
  if (v === 0) return '0%';
  if (v >= 1) return `${v.toFixed(1)}%`;
  return `${v.toFixed(digits)}%`;
}

export function severityClass(uiSeverity) {
  return String(uiSeverity || '').toLowerCase();
}
