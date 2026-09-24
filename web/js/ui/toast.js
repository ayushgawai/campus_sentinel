/* Corner toasts. The container is aria-live=polite in index.html, so each
 * message is announced once without stealing focus. */

import { h } from './dom.js';
import { config } from '../config.js';

export function createToasts(root) {
  function show(title, body = '', tone = '') {
    const node = h('div', { class: `toast${tone ? ` toast--${tone}` : ''}` }, [
      h('div', { class: 'toast__title', text: title }),
      body ? h('div', { class: 'toast__body', text: body }) : null,
    ]);

    root.append(node);

    setTimeout(() => {
      node.classList.add('toast--leaving');
      setTimeout(() => node.remove(), 200);
    }, config.TOAST_MS);
  }

  return {
    info: (t, b) => show(t, b),
    ok: (t, b) => show(t, b, 'ok'),
    warn: (t, b) => show(t, b, 'warn'),
    alert: (t, b) => show(t, b, 'alert'),
  };
}
