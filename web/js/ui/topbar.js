/* Top bar: brand, live indicator, UTC clock, simulation tag, notifications. */

import { h, mount, fmtUtcDateTime, fmtUtcTime, clear } from './dom.js';
import { icons } from './icons.js';
import { Change } from '../store.js';

export function createTopbar(root, store, { onSelectIncident }) {
  let clockEl;
  let badgeEl;
  let panelEl;
  let listEl;
  let bellBtn;
  let open = false;

  function renderShell() {
    clockEl = h('span', { class: 'clock mono' });

    badgeEl = h('span', {
      class: 'badge-count mono',
      'aria-hidden': 'true',
      hidden: true,
    });

    bellBtn = h('button', {
      class: 'iconbtn',
      type: 'button',
      'aria-haspopup': 'true',
      'aria-expanded': 'false',
      'aria-label': 'Recent alerts',
      onClick: toggle,
    }, [h('span', { html: icons.bell, style: 'width:15px;height:15px;display:block' }), badgeEl]);

    listEl = h('ul', { class: 'notif__list' });

    panelEl = h('div', { class: 'notif__panel', hidden: true, role: 'dialog', 'aria-label': 'Recent alerts' }, [
      h('div', { class: 'notif__head' }, [
        h('span', { class: 'eyebrow eyebrow--muted', text: 'Recent alerts' }),
      ]),
      listEl,
    ]);

    mount(root,
      h('div', { class: 'topbar__brand' }, [
        h('span', { class: 'brand__mark', html: icons.shield }),
        h('div', {}, [
          h('div', { class: 'brand__name', text: 'CAMPUS SENTINEL' }),
          h('div', { class: 'brand__sub', text: 'Security Operations · North Campus' }),
        ]),
      ]),

      h('div', { class: 'topbar__center' }, [
        h('span', { class: 'livetag' }, [
          h('span', { class: 'livedot', 'aria-hidden': 'true' }),
          'System Live',
        ]),
        clockEl,
      ]),

      h('div', { class: 'topbar__right' }, [
        h('span', {
          class: 'simtag',
          text: 'Simulation',
          title: 'No real emergency number is ever dialled. Every dispatch in this system is simulated.',
        }),
        h('div', { class: 'notif' }, [bellBtn, panelEl]),
        h('span', { class: 'avatar mono', text: 'OP', 'aria-label': 'Operator' }),
      ]),
    );
  }

  function toggle() {
    open = !open;
    panelEl.hidden = !open;
    bellBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      store.clearUnseen();
      renderList();
    }
  }

  function close() {
    if (!open) return;
    open = false;
    panelEl.hidden = true;
    bellBtn.setAttribute('aria-expanded', 'false');
  }

  function renderList() {
    const { notifications } = store.getState();
    clear(listEl);

    if (!notifications.length) {
      listEl.append(h('li', { class: 'notif__empty', text: 'No alerts yet.' }));
      return;
    }

    for (const n of notifications) {
      listEl.append(h('li', {}, [
        h('button', {
          class: 'notif__item',
          type: 'button',
          onClick: () => {
            onSelectIncident(n.incidentId);
            close();
          },
        }, [
          h('div', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:baseline' }, [
            h('span', { style: 'font-weight:600', text: n.title }),
            h('span', { class: 'mono', style: 'font-size:9.5px;color:var(--muted)', text: fmtUtcTime(n.ts) }),
          ]),
          h('div', { style: 'font-size:11px;color:var(--muted);margin-top:1px', text: n.locationText }),
        ]),
      ]));
    }
  }

  function renderBadge() {
    const { unseen } = store.getState();
    badgeEl.textContent = String(unseen);
    badgeEl.hidden = unseen === 0;
    bellBtn.setAttribute(
      'aria-label',
      unseen ? `Recent alerts, ${unseen} unread` : 'Recent alerts'
    );
  }

  function tickClock() {
    const now = new Date();
    clockEl.textContent = fmtUtcDateTime(now);
    clockEl.append(h('span', { class: 'clock__zone', text: 'UTC' }));
  }

  renderShell();
  tickClock();
  setInterval(tickClock, 1000);
  renderBadge();

  document.addEventListener('click', (ev) => {
    if (open && !panelEl.contains(ev.target) && !bellBtn.contains(ev.target)) close();
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') close();
  });

  store.subscribe((_state, kind) => {
    if (kind === Change.NOTIFICATIONS) {
      renderBadge();
      if (open) renderList();
    }
  });
}
