/* Incident detail — evidence, confidence, rules, operator actions, timeline.
 *
 * The four buttons are gated by js/transitions.js, which mirrors the brain's
 * state graph. A button is disabled whenever the backend would reject the
 * transition, so the UI can never ask for something illegal.
 */

import { h, mount, clear, fmtUtcTime, fmtScore, severityClass } from './dom.js';
import { icons } from './icons.js';
import { Change } from '../store.js';
import { IncidentState } from '../contracts.js';
import { Action, availableActions } from '../transitions.js';

const ACTION_LABEL = {
  [Action.ACKNOWLEDGE]: 'Acknowledge',
  [Action.DISPATCH]: 'Dispatch',
  [Action.RESOLVE]: 'Resolve',
  [Action.FALSE_ALARM]: 'False alarm',
};

const ACTION_HINT = {
  [Action.ACKNOWLEDGE]: 'Mark that an operator has seen this incident',
  [Action.DISPATCH]: 'Send campus security — simulated, no real call is placed',
  [Action.RESOLVE]: 'Close this incident as handled',
  [Action.FALSE_ALARM]: 'Dismiss this incident as nothing',
};

const ALERT_STATES = new Set([
  IncidentState.DISPATCH_PENDING,
  IncidentState.DISPATCHED,
  IncidentState.TRACKING,
]);

export function createDetail(root, store, { onAction }) {
  let headEl;
  let bodyEl;

  function renderEmpty() {
    clear(headEl);
    headEl.append(
      h('div', { class: 'panel__head-l' }, [
        h('div', { class: 'eyebrow eyebrow--muted', text: 'Evidence' }),
        h('h2', { class: 'panel__title', id: 'detail-title', text: 'Incident detail' }),
      ])
    );

    mount(bodyEl, h('div', {
      class: 'detail-empty',
      text: 'Select an incident from the queue to see its evidence.',
    }));
  }

  function renderHead(inc) {
    const sev = severityClass(inc.uiSeverity);
    clear(headEl);

    headEl.append(
      h('div', { class: 'panel__head-l' }, [
        h('div', {
          class: 'eyebrow eyebrow--muted mono',
          text: `${inc.id} · Evidence · ${inc.stateLabel}`,
        }),
        h('h2', { class: 'panel__title', id: 'detail-title', text: inc.title }),
      ]),
      h('div', { class: 'panel__head-r' }, [
        h('span', { class: `badge badge--${sev}`, text: inc.uiSeverity }),
      ])
    );
  }

  function renderActions(inc) {
    const allowed = availableActions(inc.state);

    const order = [
      Action.ACKNOWLEDGE,
      Action.DISPATCH,
      Action.RESOLVE,
      Action.FALSE_ALARM,
    ];

    return h('div', { class: 'actions' }, order.map((action) => h('button', {
      class: `abtn${action === Action.DISPATCH ? ' abtn--primary' : ''}`,
      type: 'button',
      text: ACTION_LABEL[action],
      title: ACTION_HINT[action],
      disabled: !allowed[action],
      onClick: () => onAction(inc.id, action),
    })));
  }

  function renderTimeline(inc) {
    if (!inc.timeline.length) return null;

    return h('ol', { class: 'timeline' }, inc.timeline.map((ev) => {
      const isAlert = ALERT_STATES.has(ev.state);
      return h('li', { class: 'tl' }, [
        h('span', { class: `tl__dot${isAlert ? ' tl__dot--alert' : ''}` }, [
          h('span', { html: isAlert ? icons.alert : icons.check }),
        ]),
        h('div', {}, [
          h('div', { class: 'tl__name', text: ev.note || ev.state }),
          h('div', { class: 'tl__meta', text: fmtUtcTime(ev.ts) }),
        ]),
      ]);
    }));
  }

  function renderBody(inc) {
    const sev = severityClass(inc.uiSeverity);

    mount(bodyEl, h('div', { class: 'detail' }, [
      h('p', { class: 'detail__desc', text: inc.description }),

      inc.personDescription
        ? h('p', {
          style: 'font-size:11.5px;color:var(--muted);margin:-6px 0 12px',
          text: `Person: ${inc.personDescription}`,
        })
        : null,

      // calibrated confidence
      h('div', { class: 'conf' }, [
        h('div', { class: 'conf__top' }, [
          h('span', { class: 'conf__label', text: 'Calibrated confidence' }),
          h('span', { class: 'conf__value mono', text: `${inc.confidencePct}%` }),
        ]),
        h('div', {
          class: 'meter',
          role: 'progressbar',
          'aria-valuenow': String(inc.confidencePct),
          'aria-valuemin': '0',
          'aria-valuemax': '100',
          'aria-label': 'Calibrated fused confidence',
        }, [
          h('div', {
            class: `meter__fill${sev === 'critical' ? '' : ` meter__fill--${sev}`}`,
            style: `width:${inc.confidencePct}%`,
          }),
        ]),

        // three score readouts
        h('div', { class: 'scores' }, [
          h('div', {}, [
            h('div', { class: 'score__label', text: 'Router' }),
            h('div', { class: 'score__value mono', text: fmtScore(inc.routerScore) }),
          ]),
          h('div', {}, [
            h('div', { class: 'score__label', text: 'Vision model' }),
            h('div', { class: 'score__value mono', text: fmtScore(inc.visionProb) }),
          ]),
          h('div', {}, [
            h('div', { class: 'score__label', text: 'Fused' }),
            h('div', { class: 'score__value mono', text: fmtScore(inc.fusedProb) }),
          ]),
        ]),
      ]),

      // rules fired
      inc.rulesFired.length
        ? h('div', {}, [
          h('div', { class: 'section-label', text: 'Rules fired' }),
          h('div', { class: 'chips' }, inc.rulesFired.map((rule) => h('span', { class: 'chip' }, [
            h('span', { html: icons.check }),
            rule,
          ]))),
        ])
        : null,

      renderActions(inc),

      h('div', { class: 'section-label', text: 'Timeline' }),
      renderTimeline(inc),

      inc.dismissedReason
        ? h('p', {
          style: 'font-size:11px;color:var(--muted);margin-top:8px',
          text: `Dismissed: ${inc.dismissedReason}`,
        })
        : null,
    ]));
  }

  function render() {
    const inc = store.selected();
    if (!inc) {
      renderEmpty();
      return;
    }
    renderHead(inc);
    renderBody(inc);
  }

  headEl = h('div', { class: 'panel__head' });
  bodyEl = h('div', { class: 'panel__body' });

  mount(root, headEl, bodyEl);
  render();

  store.subscribe((_state, kind) => {
    if (kind === Change.SELECTION || kind === Change.INCIDENTS) render();
  });
}
