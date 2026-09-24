/* Campus Sentinel dashboard — boot and wiring.
 *
 * Flow: source -> bus (contracts/events.py envelopes) -> normalize -> store
 *       -> UI modules. Operator intent travels back out through the source.
 *
 * Every panel reads normalised view models from the store, never the wire
 * format directly.
 */

import { config } from './config.js';
import { bus, createSource } from './bus.js';
import { createStore, Change } from './store.js';
import { EventType, IncidentState } from './contracts.js';
import {
  normalizeIncident,
  normalizeHealth,
  normalizeOverlay,
  normalizeStateChange,
  normalizeCameraOnline,
  normalizeTranscriptDelta,
  normalizeToolCall,
} from './normalize.js';
import { Action, ACTION_NOTE, actionPath } from './transitions.js';
import { CAMERAS, cameraNo } from './cameras.js';

import { createTopbar } from './ui/topbar.js';
import { createHealthStrip } from './ui/health.js';
import { createWall } from './ui/wall.js';
import { createQueue } from './ui/queue.js';
import { createDetail } from './ui/detail.js';
import { createMap } from './ui/map.js';
import { createDemoControl } from './ui/democontrol.js';
import { createCall } from './ui/call.js';
import { createToasts } from './ui/toast.js';

/** Notes written for the intermediate states a single click walks through. */
const STEP_NOTE = {
  [IncidentState.ALERTED]: 'Acknowledged before dispatch',
  [IncidentState.DISPATCH_PENDING]: 'Threshold crossed · arming dispatch',
  [IncidentState.TRACKING]: 'Tracking subject across cameras',
};

const TOAST = {
  [Action.ACKNOWLEDGE]: ['Acknowledged', 'Operator has seen this incident.'],
  [Action.DISPATCH]: ['Dispatch sent', 'Campus security notified — simulated.'],
  [Action.RESOLVE]: ['Resolved', 'Incident closed as handled.'],
  [Action.FALSE_ALARM]: ['Dismissed', 'Marked as a false alarm.'],
};

function boot() {
  const store = createStore();
  const toasts = createToasts(document.getElementById('toasts'));
  const source = createSource(bus);

  store.setCameras(CAMERAS);

  /* ---------------- inbound: bus -> store ---------------- */

  bus.subscribe((ev) => {
    switch (ev.type) {
      case EventType.INCIDENT_UPSERT: {
        const dict = ev.incident || ev.incident_dict;
        if (!dict) break;
        store.upsertIncident(normalizeIncident(dict));
        // Nothing is seeded client-side, so the detail panel would sit empty
        // until the operator clicked. Land on the first incident that arrives.
        if (!store.getState().selectedId) selectIncident(dict.incident_id);
        break;
      }

      case EventType.INCIDENT_STATE_CHANGE:
        store.applyStateChange(normalizeStateChange(ev));
        break;

      case EventType.OVERLAY_BOXES:
        store.setOverlay(normalizeOverlay(ev));
        break;

      case EventType.HEALTH_STRIP: {
        const hs = normalizeHealth(ev);
        store.setHealth(hs);
        if (hs.modelsResident && !store.getState().prewarmed) {
          store.setPrewarmed(true);
        }
        break;
      }

      case EventType.CAMERA_ONLINE:
        store.setCameraOnline(normalizeCameraOnline(ev));
        break;

      /* Both of these lazily create the call entry and reveal the transcript
       * panel, because no call.started envelope exists to do it explicitly. */
      case EventType.CALL_TRANSCRIPT_DELTA:
        store.appendTranscript(normalizeTranscriptDelta(ev));
        break;

      case EventType.TOOL_CALL_LIVE:
        store.appendToolCall(normalizeToolCall(ev));
        break;

      /* DemoHub emits 'reset' and 'scenario' only — never 'prewarm' — so the
       * prewarm indicator is driven from health.strip's models_resident above.
       *
       * Reset is server-authoritative: DemoHub.reset() publishes this envelope
       * and then re-seeds, so the clear lands before the fresh incidents and
       * the board stays in step even when another client triggered it. */
      case EventType.DEMO_CONTROL:
        if (ev.action === 'reset') store.clearIncidents();
        break;

      default:
        break;
    }
  });

  /* ---------------- outbound: intent -> source ---------------- */

  function selectIncident(incidentId) {
    const inc = store.getState().incidents.get(incidentId);
    store.select(incidentId);
    if (inc) store.expandCamera(inc.cameraId);
  }

  function selectCamera(cameraId) {
    store.expandCamera(cameraId);

    // jump to the newest incident on that camera, if any
    const match = store.visibleIncidents().find((i) => i.cameraId === cameraId);
    if (match) store.select(match.id);
  }

  /**
   * Walk the legal chain for an action. Every intermediate hop is emitted as
   * its own state change so the timeline and the audit trail match what the
   * brain's state machine would have recorded.
   */
  function runAction(incidentId, action) {
    const inc = store.getState().incidents.get(incidentId);
    if (!inc) return;

    const path = actionPath(inc.state, action);
    if (!path.length) return;

    path.forEach((next, i) => {
      const isLast = i === path.length - 1;
      const note = isLast ? ACTION_NOTE[action] : (STEP_NOTE[next] || '');
      source.sendStateChange(incidentId, next, note);
    });

    const [title, body] = TOAST[action] || ['Updated', ''];
    if (action === Action.DISPATCH) toasts.alert(title, body);
    else if (action === Action.FALSE_ALARM) toasts.warn(title, body);
    else toasts.ok(title, body);

    /* Dispatch does NOT open the transcript panel.
     *
     * services/voice is driven by the backend, not by this button:
     * DemoHub.publish() starts the VoiceAgent on any SEVERE incident.upsert,
     * which usually lands before an operator has touched anything. The panel
     * therefore opens when transcript deltas start arriving — see
     * store.ensureCall, called from appendTranscript/appendToolCall. */
  }

  /**
   * Staging a scenario is fire-and-forget: the brain assigns the incident id,
   * so it comes back on the runScenario ack rather than from this call. The
   * hub publishes the incident.upsert before it returns that ack, so by the
   * time the handler below runs the incident is already in the store.
   */
  function runScenario(scenarioId) {
    source.runScenario(scenarioId);
  }

  source.onAck((ack) => {
    if (ack.ok === false) {
      toasts.warn('Command rejected', ack.error || 'The backend refused it.');
      return;
    }
    if (ack.cmd !== 'runScenario' || !ack.incident_id) return;

    selectIncident(ack.incident_id);

    const inc = store.getState().incidents.get(ack.incident_id);
    toasts.alert(
      'Scenario staged',
      inc ? `${inc.title} · CAM ${cameraNo(inc.cameraId)}` : ack.incident_id
    );
  });

  /** Ask the backend to reset. The board is cleared by the demo.control
   *  envelope that comes back, not here, so a reset triggered from anywhere
   *  lands the same way. */
  function resetDemo() {
    source.reset();
    toasts.info('Demo reset', 'Asked the backend to clear and re-seed.');
  }

  function togglePause() {
    const next = !store.getState().paused;
    source.setPaused(next);
    store.setPaused(next);
    toasts.info(next ? 'Feeds paused' : 'Feeds resumed',
      next ? 'Frame counter held.' : 'Screening again.');
  }

  /* ---------------- mount UI ---------------- */

  createTopbar(document.getElementById('topbar'), store, {
    onSelectIncident: selectIncident,
  });

  createHealthStrip(document.getElementById('healthstrip'), store);

  createWall(document.getElementById('wall-panel'), store, {
    onTogglePause: togglePause,
  });

  createQueue(document.getElementById('queue-panel'), store, {
    onSelectIncident: selectIncident,
  });

  createMap(document.getElementById('map-panel'), store, {
    onSelectCamera: selectCamera,
  });

  createDetail(document.getElementById('detail-panel'), store, {
    onAction: runAction,
  });

  createCall(document.getElementById('call-panel'), store, {
    onClose: () => store.setCallVisible(false),
  });

  createDemoControl(document.getElementById('demobar'), store, {
    onRunScenario: runScenario,
    onReset: resetDemo,
  });

  /* The transcript panel takes the cell directly below the camera wall,
   * replacing the campus map. The incident detail panel stays put, so the
   * operator keeps the evidence and the action buttons while a call runs. */
  const mainEl = document.querySelector('.main');
  store.subscribe((state, kind) => {
    if (kind !== Change.CALL) return;
    const live = Boolean(state.callVisible && store.activeCall());
    mainEl.classList.toggle('main--call', live);
  });

  /* ---------------- start ---------------- */

  source.start();

  console.info(
    `[sentinel] dashboard up · ${config.API_BASE || location.origin} · `
    + `MJPEG at ${config.MJPEG_PATH}/<camera_id> · nothing is seeded locally, `
    + 'the board fills from /ws'
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
