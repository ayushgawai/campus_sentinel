/* Event transport — services/api websocket only.
 *
 * One JSON envelope per WS message, shaped exactly like event_to_dict() output
 * with the discriminator on a top-level `type` field. Operator commands go
 * upstream as {cmd, ...} matching handle_cmd() in services/api/hub.py.
 *
 * Two kinds of message arrive on the same socket:
 *   - bus events      have a `type` field, and are republished unchanged
 *   - command acks    have an `ok` flag instead, e.g.
 *                     {ok:true, cmd:'runScenario', incident_id:'inc-…'}
 * Acks are not events, so they go to onAck subscribers rather than the bus.
 * Without that, the incident_id the backend assigns to a staged scenario never
 * reaches the UI.
 *
 * Failure acks are matched on `ok` rather than `cmd` because the unhappy paths
 * omit the command name entirely — hub.handle_cmd returns
 * {ok:false, error:'unknown cmd: …'} and server.py returns
 * {ok:false, error:'bad json'}.
 */

import { wsUrl } from './config.js';

export class EventBus {
  constructor() {
    this._handlers = new Set();
  }

  subscribe(fn) {
    this._handlers.add(fn);
    return () => this._handlers.delete(fn);
  }

  publish(event) {
    for (const fn of this._handlers) {
      try {
        fn(event);
      } catch (err) {
        console.error('[bus] handler failed for', event && event.type, err);
      }
    }
  }
}

export const bus = new EventBus();

function createLiveSource(targetBus = bus) {
  let ws = null;
  let paused = false;
  const ackHandlers = new Set();

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function emitAck(ack) {
    for (const fn of ackHandlers) {
      try {
        fn(ack);
      } catch (err) {
        console.error('[live] ack handler failed for', ack && ack.cmd, err);
      }
    }
  }

  function connect() {
    ws = new WebSocket(wsUrl());

    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (err) {
        console.error('[live] bad json', err);
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      if (typeof msg.type === 'string') {
        targetBus.publish(msg);
      } else if (typeof msg.ok === 'boolean' || typeof msg.cmd === 'string') {
        emitAck(msg);
      }
    });

    ws.addEventListener('close', () => {
      console.warn('[live] ws closed — retry in 2s');
      setTimeout(connect, 2000);
    });

    ws.addEventListener('open', () => {
      send({ cmd: 'start' });
    });
  }

  return {
    kind: 'live',

    start() {
      connect();
    },

    stop() {
      send({ cmd: 'stop' });
      if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
      }
    },

    /** Subscribe to command acks. Returns an unsubscribe function. */
    onAck(fn) {
      ackHandlers.add(fn);
      return () => ackHandlers.delete(fn);
    },

    setPaused(next) {
      paused = !!next;
      send({ cmd: 'setPaused', paused });
      return paused;
    },

    isPaused() {
      return paused;
    },

    /** Fire and forget. The new incident_id comes back as a runScenario ack. */
    runScenario(scenarioId) {
      send({ cmd: 'runScenario', scenario_id: scenarioId });
    },

    sendStateChange(incidentId, nextState, note) {
      send({
        cmd: 'sendStateChange',
        incident_id: incidentId,
        state: nextState,
        note: note || '',
      });
    },

    reset() {
      send({ cmd: 'reset' });
    },
  };
}

export function createSource(targetBus = bus) {
  return createLiveSource(targetBus);
}
