/* Campus Sentinel dashboard — boot and wiring.
 *
 * Flow: source -> bus (contracts/events.py envelopes) -> normalize -> store
 *       -> UI modules. Operator intent travels back out through the source.
 *
 * Nothing here knows whether the events are mock or live.
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
  normalizeCallBrief,
} from './normalize.js';
import { Action, ACTION_NOTE, actionPath } from './transitions.js';
import { CAMERAS, cameraNo, starterIncidents } from './mock/fixtures.js';

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
        if (dict) store.upsertIncident(normalizeIncident(dict));
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

      case EventType.CALL_TRANSCRIPT_DELTA:
        store.appendTranscript(normalizeTranscriptDelta(ev));
        break;

      case EventType.TOOL_CALL_LIVE:
        store.appendToolCall(normalizeToolCall(ev));
        break;

      case EventType.DEMO_CONTROL:
        if (ev.action === 'prewarm') store.setPrewarmed(true);
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

    // Dispatch opens the simulated call. In production the voice service drives
    // this; here the mock plays a scripted exchange over the same wire events.
    if (action === Action.DISPATCH && source.startCall) {
      const dict = starterOrStaged(incidentId);
      if (dict) {
        const { brief, durationMs } = source.startCall(dict);
        store.startCall(incidentId, normalizeCallBrief(brief));
        setTimeout(() => store.endCall(incidentId), durationMs + 900);
      }
    }
  }

  /**
   * The mock's call playback needs the raw wire payload, not the view model.
   * Rebuild a minimal one from the store so the console works for both starter
   * and staged incidents. The live source will not need this.
   */
  function starterOrStaged(incidentId) {
    const inc = store.getState().incidents.get(incidentId);
    if (!inc) return null;
    return {
      incident_id: inc.id,
      track_id: inc.trackId,
      camera_id: inc.cameraId,
      class_token: inc.classToken,
      location_text: inc.locationText,
      person_description: inc.personDescription,
      created_at: (inc.createdAt || new Date()).toISOString(),
      peak_ts: (inc.peakTs || new Date()).toISOString(),
    };
  }

  function runScenario(scenarioId) {
    const incidentId = source.runScenario(scenarioId);
    if (!incidentId) return;

    selectIncident(incidentId);

    const inc = store.getState().incidents.get(incidentId);
    toasts.alert(
      'Scenario staged',
      inc ? `${inc.title} · CAM ${cameraNo(inc.cameraId)}` : scenarioId
    );
  }

  function resetDemo() {
    if (source.cancelCall) source.cancelCall();
    store.resetIncidents(starterIncidents().map(normalizeIncident));
    source.reset();

    const newest = store.visibleIncidents()[0];
    if (newest) selectIncident(newest.id);

    toasts.info('Demo reset', 'Back to the three starter incidents.');
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

  // the lower half swaps between map+detail and the call console
  const mainEl = document.querySelector('.main');
  store.subscribe((state, kind) => {
    if (kind !== Change.CALL) return;
    const live = Boolean(state.callVisible && store.activeCall());
    mainEl.classList.toggle('main--call', live);
  });

  /* ---------------- start ---------------- */

  source.start();

  // open on the most recent incident so the panel is never empty
  const newest = store.visibleIncidents()[0];
  if (newest) store.select(newest.id);

  console.info(
    `[sentinel] dashboard up · source=${source.kind} · `
    + `MJPEG expected at ${config.API_BASE || location.origin}${config.MJPEG_PATH}/<camera_id>`
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
