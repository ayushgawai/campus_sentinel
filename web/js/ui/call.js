/* Call console — playbook §04-F, reduced to what the wire carries.
 *
 * Two columns: both sides of the transcript, and the tool calls landing live.
 * The tool column is the visible proof of the agentic loop — every fact spoken
 * traces back to a lookup.
 *
 * Consumes contracts/events.py :: CallTranscriptDelta and ToolCallLive, both
 * published by services/voice/agent.py.
 *
 * The Call Brief column is gone. services/brain assembles a CallBrief
 * (assemble_call_brief, called from DemoHub._maybe_start_voice) but it is never
 * serialized onto the socket — there is no event type carrying one — so the
 * browser has no way to obtain it.
 */

import { h, mount, clear, fmtUtcTime } from './dom.js';
import { icons } from './icons.js';
import { Change } from '../store.js';

const SPEAKER_LABEL = {
  dispatcher: 'Dispatcher',
  sentinel: 'Sentinel',
};

/* How long after the last delta the stream is still considered active.
 *
 * There is no call.ended envelope, so the console cannot know a call finished
 * — it can only observe that deltas stopped arriving. The pill therefore
 * reports the state of the stream, not the state of the call. The gap is
 * generous because WEAPON_SCRIPT in services/voice/agent.py consumes its
 * after_s values as cumulative sleeps, which stretches the exchange to roughly
 * 52 seconds with a 9 second pause before the closing line. */
const STALE_MS = 15000;

function streaming(call) {
  if (!call || !call.lastDeltaAt) return false;
  return Date.now() - call.lastDeltaAt.getTime() < STALE_MS;
}

export function createCall(root, store, { onClose }) {
  let headEl;
  let turnsBody;
  let toolsBody;
  let cursorEl = null;
  let lastTurnCount = 0;
  let lastToolCount = 0;

  function renderTurns(call) {
    const grow = call.transcript.length > lastTurnCount;
    lastTurnCount = call.transcript.length;
    cursorEl = null;

    clear(turnsBody);

    if (!call.transcript.length) {
      turnsBody.append(h('div', {
        class: 'call-empty',
        text: 'Waiting for the first transcript delta…',
      }));
      return;
    }

    const wrap = h('div', { class: 'turns' });

    call.transcript.forEach((t, i) => {
      const isLast = i === call.transcript.length - 1;
      const bubble = h('div', { class: 'turn__bubble' }, [t.text]);

      // a caret on the newest line reads as speech still arriving
      if (isLast) {
        cursorEl = h('span', {
          class: 'turn__cursor',
          'aria-hidden': 'true',
          hidden: !streaming(call),
        });
        bubble.append(cursorEl);
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

    wrap.append(h('div', { class: 'call__note' },
      'Lookups only. Every fact the system states on a call is read from the '
      + 'incident record or the camera map. Where it holds no fact, it says it '
      + 'cannot confirm.'));

    toolsBody.append(wrap);

    if (grow) toolsBody.scrollTop = toolsBody.scrollHeight;
  }

  function renderHead(call) {
    const live = streaming(call);
    clear(headEl);

    headEl.append(
      h('div', { class: 'panel__head-l' }, [
        h('div', { class: 'eyebrow eyebrow--alert', text: 'Simulated call · 911' }),
        h('h2', {
          class: 'panel__title',
          id: 'call-title',
          text: 'Live transcript',
        }),
      ]),
      h('div', { class: 'panel__head-r' }, [
        h('span', {
          class: `callstat${live ? '' : ' callstat--ended'}`,
          // No call.ended event exists — this reports the stream, not the call.
          title: live
            ? 'Transcript deltas are arriving'
            : `No transcript delta in the last ${STALE_MS / 1000}s`,
        }, [
          h('span', { class: 'callstat__dot', 'aria-hidden': 'true' }),
          live ? 'Receiving' : 'Idle',
        ]),
        h('button', {
          class: 'panelbtn',
          type: 'button',
          'aria-label': 'Close the transcript and return to the campus map',
          onClick: () => onClose(),
        }, [
          h('span', { html: icons.pin }),
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
    renderTurns(call);
    renderTools(call);
  }

  headEl = h('div', { class: 'panel__head' });
  turnsBody = h('div', { class: 'call__colbody', 'aria-live': 'polite' });
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
        column('Transcript · services/voice', turnsBody),
        column('Tool calls · live', toolsBody),
      ]),
    ]),
  );

  render();

  store.subscribe((_state, kind) => {
    if (kind === Change.CALL) render();
  });

  /* The pill and the caret age out on their own once deltas stop, so they need
   * a tick of their own. Only the head is redrawn — re-rendering the columns
   * here would throw away the operator's scroll position. */
  setInterval(() => {
    if (root.hidden) return;
    const call = store.activeCall();
    if (!call) return;
    renderHead(call);
    if (cursorEl) cursorEl.hidden = !streaming(call);
  }, 3000);
}
