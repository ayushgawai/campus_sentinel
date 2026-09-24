/* Event transport.
 *
 * Every UI module subscribes to this bus and never to the mock directly, so
 * going live means flipping config.SOURCE — no UI changes.
 *
 * A "source" both publishes contracts/events.py envelopes onto the bus and
 * accepts operator commands. The mock implements them locally; the live
 * source will forward them to services/api.
 */

import { config } from './config.js';
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
 * Placeholder for the real transport.
 *
 * services/api does not exist yet. When it does, this opens wsUrl(), parses
 * each contracts/events.py envelope, publishes it onto the bus unchanged, and
 * forwards operator commands back over the socket. The rest of the dashboard
 * is already compatible because it only ever reads normalised view models.
 */
function createLiveSource() {
  throw new Error(
    'config.SOURCE = "live" requires services/api (websocket + MJPEG), which is not built yet. '
    + 'Keep config.SOURCE = "mock" until it lands.'
  );
}

export function createSource(targetBus = bus) {
  if (config.SOURCE === 'live') return createLiveSource(targetBus);
  return createMockSource(targetBus);
}
