/* Incident queue — severity filters plus a selectable list.
 *
 * Severity chips are display buckets from js/contracts.js :: uiSeverity, not
 * contract values. Selecting a row also focuses that incident's camera.
 */

import { h, mount, clear, fmtUtcTime, severityClass } from './dom.js';
import { icons } from './icons.js';
import { Change } from '../store.js';

const FILTERS = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM'];

export function createQueue(root, store, { onSelectIncident }) {
  let countEl;
  let filtersEl;
  let listEl;

  function renderCount() {
    countEl.textContent = String(store.openCount());
  }

  function renderFilters() {
    const { filter } = store.getState();
    clear(filtersEl);

    for (const f of FILTERS) {
      filtersEl.append(h('button', {
        class: 'filter',
        type: 'button',
        'aria-pressed': String(filter === f),
        text: f,
        onClick: () => store.setFilter(f),
      }));
    }
  }

  function renderList() {
    const incidents = store.visibleIncidents();
    const { selectedId, filter } = store.getState();

    clear(listEl);

    if (!incidents.length) {
      listEl.append(h('li', {
        class: 'queue-empty',
        text: filter === 'ALL'
          ? 'No incidents. The system is watching.'
          : `No ${filter.toLowerCase()} incidents.`,
      }));
      return;
    }

    for (const inc of incidents) {
      const sev = severityClass(inc.uiSeverity);

      listEl.append(h('li', { role: 'presentation' }, [
        h('button', {
          class: `qrow qrow--${sev}${inc.open ? '' : ' qrow--closed'}`,
          type: 'button',
          role: 'option',
          'aria-selected': String(inc.id === selectedId),
          onClick: () => onSelectIncident(inc.id),
        }, [
          h('div', { class: 'qrow__top' }, [
            h('span', { class: 'qrow__title', text: inc.title }),
            h('span', { class: 'qrow__time mono', text: fmtUtcTime(inc.createdAt) }),
          ]),
          h('div', { class: 'qrow__loc' }, [
            h('span', { html: icons.pin, style: 'width:11px;height:11px;display:block;flex:0 0 auto' }),
            inc.locationText,
          ]),
          h('div', { class: 'qrow__bot' }, [
            h('div', { class: 'qrow__badges' }, [
              h('span', { class: `badge badge--${sev}`, text: inc.uiSeverity }),
              h('span', { class: 'badge badge--state', text: inc.stateLabel }),
            ]),
            h('span', {
              class: 'qrow__conf mono',
              text: `${inc.confidencePct}%`,
              title: 'Calibrated fused confidence',
            }),
          ]),
        ]),
      ]));
    }
  }

  countEl = h('span', {
    class: 'badge-count mono',
    style: 'position:static;border:0;min-width:16px;height:16px',
  });
  filtersEl = h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter by severity' });
  listEl = h('ul', {
    class: 'qlist',
    role: 'listbox',
    'aria-label': 'Incidents',
    'aria-live': 'polite',
  });

  mount(root,
    h('div', { class: 'panel__head' }, [
      h('div', { class: 'panel__head-l' }, [
        h('div', { class: 'eyebrow eyebrow--alert', text: 'Action required' }),
        h('h2', {
          class: 'panel__title',
          id: 'queue-title',
          style: 'display:flex;align-items:center;gap:7px',
        }, ['Incident queue', countEl]),
      ]),
    ]),
    filtersEl,
    h('div', { class: 'panel__body' }, [listEl]),
  );

  renderFilters();
  renderList();
  renderCount();

  store.subscribe((_state, kind) => {
    if (kind === Change.INCIDENTS) {
      renderList();
      renderCount();
    } else if (kind === Change.FILTER) {
      renderFilters();
      renderList();
    } else if (kind === Change.SELECTION) {
      renderList();
    }
  });
}
