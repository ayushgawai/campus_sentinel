/* Call console — playbook §04-F.
 *
 * Three columns: the Call Brief the agent is allowed to read from, both sides
 * of the transcript, and the tool calls landing live. The tool column is the
 * visible proof of the agentic loop: every fact spoken traces back to a lookup.
 *
 * Consumes contracts/events.py :: CallTranscriptDelta and ToolCallLive.
 */

import { h, mount, clear, fmtUtcTime } from './dom.js';
import { icons } from './icons.js';
import { Change } from '../store.js';

const SPEAKER_LABEL = {
  dispatcher: 'Dispatcher',
  sentinel: 'Sentinel',
};

export function createCall(root, store, { onClose }) {
  let headEl;
  let briefBody;
  let turnsBody;
  let toolsBody;
  let lastTurnCount = 0;
  let lastToolCount = 0;

  function briefRow(label, value, opts = {}) {
    if (value === null || value === undefined || value === '') return null;
    return h('div', { class: 'brief__row' }, [
      h('div', { class: 'brief__k', text: label }),
      h('div', {
        class: `brief__v${opts.mono ? ' brief__v--mono' : ''}`,
        text: String(value),
      }),
    ]);
  }

  function renderBrief(call) {
    const b = call.brief;
    clear(briefBody);

    if (!b) {
      briefBody.append(h('div', { class: 'call-empty', text: 'No Call Brief.' }));
      return;
    }

    briefBody.append(
      briefRow('Incident', b.incidentId, { mono: true }),
      briefRow('Address', b.address),
      briefRow('Building', b.building),
      b.coordinates
        ? briefRow('Coordinates', `${b.coordinates[0].toFixed(6)}, ${b.coordinates[1].toFixed(6)}`, { mono: true })
        : null,
      b.entrances.length
        ? h('div', { class: 'brief__row' }, [
          h('div', { class: 'brief__k', text: 'Entrances' }),
          h('ul', { class: 'brief__list' }, b.entrances.map((e) => h('li', { text: e }))),
        ])
        : null,
      briefRow('Person', b.personDescription),
      briefRow('Incident started', fmtUtcTime(b.incidentStartedAt), { mono: true }),
      briefRow('Brief generated', fmtUtcTime(b.briefGeneratedAt), { mono: true }),
      b.mapLookupRefs.length
        ? briefRow('Lookup refs', b.mapLookupRefs.join(', '), { mono: true })
        : null,

      h('div', { class: 'brief__note' },
        'Facts only. On a call the system states what is in this brief, or says '
        + 'it cannot confirm. It never infers an address, a location or a '
        + 'medical fact.'),
    );
  }

  function renderTurns(call) {
    const grow = call.transcript.length > lastTurnCount;
    lastTurnCount = call.transcript.length;

    clear(turnsBody);

    if (!call.transcript.length) {
      turnsBody.append(h('div', { class: 'call-empty', text: 'Connecting…' }));
      return;
    }

    const wrap = h('div', { class: 'turns' });

    call.transcript.forEach((t, i) => {
      const isLast = i === call.transcript.length - 1;
      const bubble = h('div', { class: 'turn__bubble' }, [t.text]);

      // a caret on the newest line reads as speech still arriving
      if (isLast && !call.ended) {
        bubble.append(h('span', { class: 'turn__cursor', 'aria-hidden': 'true' }));
      }

      wrap.append(h('div', { class: `turn turn--${t.speaker}` }, [
        h('div', { class: 'turn__who' }, [
          h('span', {
            html: t.speaker === 'sentinel' ? icons.shield : icons.bell,
            style: 'width:10px;height:10px;display:block',
          }),
          SPEAKER_LABEL[t.speaker] || t.speaker,
        ]),
        bubble,
        h('div', { class: 'turn__ts', text: fmtUtcTime(t.ts) }),
      ]));
    });

    turnsBody.append(wrap);

    if (grow) turnsBody.scrollTop = turnsBody.scrollHeight;
  }

  function renderTools(call) {
    const grow = call.toolCalls.length > lastToolCount;
    lastToolCount = call.toolCalls.length;

    clear(toolsBody);

    if (!call.toolCalls.length) {
      toolsBody.append(h('div', { class: 'call-empty', text: 'No tool calls yet.' }));
      return;
    }

    const wrap = h('div', { class: 'tools' });

    for (const tc of call.toolCalls) {
      const rows = Object.entries(tc.result).map(([k, v]) => {
        const val = Array.isArray(v)
          ? v.map((x) => (typeof x === 'number' ? x.toFixed(4) : x)).join(', ')
          : String(v);
        return h('div', { class: 'tool__kv' }, [
          h('b', { text: `${k}: ` }),
          val,
        ]);
      });

      wrap.append(h('div', { class: 'tool' }, [
        h('div', { class: 'tool__top' }, [
          h('span', { class: 'tool__name', text: `${tc.tool}()` }),
          h('span', { class: 'tool__ts', text: fmtUtcTime(tc.ts) }),
        ]),
        ...rows,
      ]));
    }

    toolsBody.append(wrap);

    if (grow) toolsBody.scrollTop = toolsBody.scrollHeight;
  }

  function renderHead(call) {
    clear(headEl);

    headEl.append(
      h('div', { class: 'panel__head-l' }, [
        h('div', { class: 'eyebrow eyebrow--alert', text: 'Simulated call · 911' }),
        h('h2', {
          class: 'panel__title',
          id: 'call-title',
          text: 'Call console',
        }),
      ]),
      h('div', { class: 'panel__head-r' }, [
        h('span', {
          class: `callstat${call.ended ? ' callstat--ended' : ''}`,
        }, [
          h('span', { class: 'callstat__dot', 'aria-hidden': 'true' }),
          call.ended ? 'Call ended' : 'Call live',
        ]),
        h('button', {
          class: 'panelbtn',
          type: 'button',
          'aria-label': 'Close the call console and return to the map',
          onClick: () => onClose(),
        }, [
          h('span', { html: icons.grid }),
          h('span', { class: 'panelbtn__text', text: 'Map' }),
        ]),
      ]),
    );
  }

  function render() {
    const state = store.getState();
    const call = store.activeCall();

    root.hidden = !(state.callVisible && call);
    if (root.hidden) return;

    renderHead(call);
    renderBrief(call);
    renderTurns(call);
    renderTools(call);
  }

  headEl = h('div', { class: 'panel__head' });
  briefBody = h('div', { class: 'call__colbody' });
  turnsBody = h('div', { class: 'call__colbody' });
  toolsBody = h('div', { class: 'call__colbody', 'aria-live': 'polite' });

  function column(label, body) {
    return h('div', { class: 'call__col' }, [
      h('div', { class: 'call__colhead' }, [
        h('div', { class: 'eyebrow eyebrow--muted', text: label }),
      ]),
      body,
    ]);
  }

  mount(root,
    headEl,
    h('div', { class: 'panel__body panel__body--flush' }, [
      h('div', { class: 'call' }, [
        column('Call brief · lookups only', briefBody),
        column('Transcript', turnsBody),
        column('Tool calls · live', toolsBody),
      ]),
    ]),
  );

  render();

  store.subscribe((_state, kind) => {
    if (kind === Change.CALL) render();
  });
}
