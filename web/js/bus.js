/* Event transport.
 *
 * Every UI module subscribes to this bus and never to the mock directly, so
 * going live means flipping config.SOURCE — no UI changes.
 *
 * A "source" both publishes contracts/events.py envelopes onto the bus and
 * accepts operator commands. The mock implements them locally; the live
 * source forwards them to services/api over the websocket.
 */

import { config, wsUrl } from './config.js';
import { createMockSource } from './mock/emitter.js';

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

/**
 * Live transport — one JSON envelope per WS message (event_to_dict shape).
 * Operator commands go upstream as {cmd, ...} matching services/api/hub.py.
 */
function createLiveSource(targetBus = bus) {
  let ws = null;
  let paused = false;
  let starters = [];

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
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
      // Command acks ({ok:true,cmd:...}) are not bus events.
      if (msg && typeof msg.type === 'string') {
        targetBus.publish(msg);
        if (msg.type === 'incident.upsert' && msg.incident) {
          // keep a soft starter list for reset UX parity
          starters = [msg.incident, ...starters.filter(
            (i) => i.incident_id !== msg.incident.incident_id
          )].slice(0, 8);
        }
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

    startCall() {
      return { brief: null, durationMs: 0 };
    },

    cancelCall() {},

    setPaused(next) {
      paused = !!next;
      send({ cmd: 'setPaused', paused });
      return paused;
    },

    isPaused() {
      return paused;
    },

    runScenario(scenarioId) {
      send({ cmd: 'runScenario', scenario_id: scenarioId });
      return null;
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

    get starters() {
      return () => starters;
    },
  };
}

export function createSource(targetBus = bus) {
  if (config.SOURCE === 'live') return createLiveSource(targetBus);
  return createMockSource(targetBus);
}
