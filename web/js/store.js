/** Single app state + event reducers. Mirrors contracts/events.py + incident.py. */

import { compareIncidents, isOpenIncident, preferredIncidentId } from "./format.js";
import { isConfiguredCamera, redactPlaces } from "./site.js";

const warnedCameras = new Set();

function acceptCameraId(cameraId) {
  if (!cameraId) return false;
  if (isConfiguredCamera(cameraId)) return true;
  if (!warnedCameras.has(cameraId)) {
    warnedCameras.add(cameraId);
    console.warn("[store] ignored event for unknown camera", cameraId);
  }
  return false;
}

const MAX_INCIDENTS = 50;
const MAX_TRANSCRIPT = 200;
const MAX_TOOLS = 100;

const warnedTypes = new Set();

function emptyHealth() {
  return {
    type: "health.strip",
    cameras_online: 0,
    cameras_total: 0,
    models_resident: false,
    gpu_util: null,
    p95_ms: null,
    frames_screened: 0,
    frames_escalated: 0,
    ts: null,
  };
}

function createInitialState() {
  return {
    cameras: {},
    incidents: {},
    order: [],
    selectedId: null,
    route: "live",
    health: emptyHealth(),
    call: {
      incidentId: null,
      transcript: [],
      tools: [],
      dispatchedAt: null,
    },
    /** incident_id → ordered camera_id list for pursuit drawing after seek */
    cameraPath: {},
    demo: {
      t: 0,
      running: false,
      speed: 1,
      scenario: "full",
      autoFollow: false,
    },
    connection: {
      status: "MOCK",
    },
  };
}

function ensureCamera(state, cameraId) {
  if (!state.cameras[cameraId]) {
    state.cameras[cameraId] = {
      online: false,
      boxes: [],
      lastTs: null,
    };
  }
  return state.cameras[cameraId];
}

function resolveIncidentPayload(event) {
  if (event.incident != null) return event.incident;
  if (event.incident_dict != null) return event.incident_dict;
  return null;
}

function resortOrder(state) {
  state.order.sort((a, b) =>
    compareIncidents(state.incidents[a], state.incidents[b]),
  );
}

function capIncidents(state) {
  while (state.order.length > MAX_INCIDENTS) {
    const dropId = state.order.pop();
    delete state.incidents[dropId];
    if (state.selectedId === dropId) state.selectedId = state.order[0] ?? null;
  }
}

/** Keep selection on the highest-priority open incident. */
function syncSelection(state) {
  const pref = preferredIncidentId(state);
  const cur = state.selectedId ? state.incidents[state.selectedId] : null;
  if (!pref) {
    if (cur && !isOpenIncident(cur)) state.selectedId = null;
    return;
  }
  if (!cur || !isOpenIncident(cur)) {
    state.selectedId = pref;
    return;
  }
  // Upgrade to severe if a higher-priority open incident exists
  const prefInc = state.incidents[pref];
  if (
    prefInc?.severity === "SEVERE" &&
    isOpenIncident(prefInc) &&
    cur.severity !== "SEVERE"
  ) {
    state.selectedId = pref;
  }
}

export function createStore() {
  let state = createInitialState();
  const listeners = new Set();
  let raf = 0;
  let dirty = false;

  function notify() {
    dirty = true;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!dirty) return;
      dirty = false;
      const snap = state;
      for (const fn of listeners) fn(snap);
    });
  }

  function flush() {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (!dirty) return;
    dirty = false;
    const snap = state;
    for (const fn of listeners) fn(snap);
  }

  function setConnection(status) {
    state.connection = { ...state.connection, status };
    notify();
  }

  function setDemo(partial) {
    state.demo = { ...state.demo, ...partial };
    notify();
  }

  function setSelected(id) {
    state.selectedId = id;
    notify();
  }

  function setRoute(route) {
    if (state.route === route) return;
    state.route = route;
    notify();
  }

  function reset() {
    const conn = state.connection;
    const route = state.route;
    const autoFollow = state.demo?.autoFollow;
    state = createInitialState();
    state.connection = { ...conn };
    state.route = route;
    state.demo.autoFollow = Boolean(autoFollow);
    notify();
  }

  function softReset() {
    const conn = state.connection;
    const route = state.route;
    const autoFollow = state.demo?.autoFollow;
    const cameras = {};
    for (const [id, cam] of Object.entries(state.cameras)) {
      cameras[id] = {
        online: Boolean(cam.online),
        boxes: [],
        lastTs: null,
      };
    }
    state = createInitialState();
    state.connection = { ...conn };
    state.route = route;
    state.demo.autoFollow = Boolean(autoFollow);
    state.cameras = cameras;
    notify();
  }

  function handle(event) {
    if (!event || typeof event !== "object") {
      console.warn("[store] ignored non-object event", event);
      return;
    }
    const type = event.type;
    switch (type) {
      case "incident.upsert": {
        const rec = resolveIncidentPayload(event);
        if (!rec || !rec.incident_id) {
          console.warn("[store] incident.upsert missing incident", event);
          break;
        }
        if (rec.camera_id && !acceptCameraId(rec.camera_id)) break;
        if (typeof rec.description === "string") {
          rec.description = redactPlaces(rec.description);
        }
        if (typeof rec.person_description === "string") {
          rec.person_description = redactPlaces(rec.person_description);
        }
        // Keep location_text in the record (contract) but never display it.
        const id = rec.incident_id;
        const isNew = !state.incidents[id];
        // Preserve richer timeline if incoming is thinner
        const prev = state.incidents[id];
        if (rec.camera_id) {
          const path = state.cameraPath[id] ? state.cameraPath[id].slice() : [];
          if (!path.length && prev?.camera_id) path.push(prev.camera_id);
          if (!path.length) path.push(rec.camera_id);
          else if (path[path.length - 1] !== rec.camera_id) path.push(rec.camera_id);
          state.cameraPath[id] = path;
        }
        let timeline = Array.isArray(rec.timeline) ? rec.timeline.slice() : [];
        if (prev && Array.isArray(prev.timeline) && prev.timeline.length > timeline.length) {
          timeline = prev.timeline.slice();
        }
        state.incidents[id] = { ...rec, timeline };
        if (!state.order.includes(id)) state.order.push(id);
        resortOrder(state);
        capIncidents(state);
        if (isNew && rec.severity === "SEVERE" && isOpenIncident(rec)) {
          state.selectedId = id;
        }
        syncSelection(state);
        break;
      }
      case "incident.state_change": {
        const id = event.incident_id;
        const existing = state.incidents[id];
        if (!existing) {
          console.warn("[store] state_change for unknown incident", id);
          break;
        }
        const next = { ...existing, state: event.state };
        if (event.severity != null) next.severity = event.severity;
        next.updated_at = event.ts ?? existing.updated_at;
        if (event.state === "DISMISSED") {
          next.dismissed_reason = event.note || next.dismissed_reason || null;
        }
        const timeline = Array.isArray(existing.timeline)
          ? existing.timeline.slice()
          : [];
        timeline.push({
          ts: event.ts ?? existing.updated_at,
          state: event.state,
          note: event.note ?? "",
        });
        next.timeline = timeline;
        state.incidents[id] = next;
        if (event.state === "DISPATCHED") {
          state.call.incidentId = id;
          state.call.dispatchedAt = event.ts || next.updated_at;
        }
        resortOrder(state);
        syncSelection(state);
        break;
      }
      case "overlay.boxes": {
        if (!acceptCameraId(event.camera_id)) break;
        const cam = ensureCamera(state, event.camera_id);
        cam.boxes = Array.isArray(event.boxes) ? event.boxes.slice() : [];
        cam.lastTs = event.ts ?? cam.lastTs;
        break;
      }
      case "health.strip": {
        state.health = {
          type: "health.strip",
          cameras_online: event.cameras_online ?? 0,
          cameras_total: event.cameras_total ?? 0,
          models_resident: Boolean(event.models_resident),
          gpu_util: event.gpu_util ?? null,
          p95_ms: event.p95_ms ?? null,
          frames_screened: event.frames_screened ?? 0,
          frames_escalated: event.frames_escalated ?? 0,
          ts: event.ts ?? null,
        };
        break;
      }
      case "call.transcript_delta": {
        if (event.incident_id) state.call.incidentId = event.incident_id;
        state.call.transcript = [
          ...state.call.transcript,
          {
            incident_id: event.incident_id,
            speaker: event.speaker,
            text: redactPlaces(event.text),
            ts: event.ts ?? null,
          },
        ].slice(-MAX_TRANSCRIPT);
        break;
      }
      case "tool.call_live": {
        if (event.incident_id) state.call.incidentId = event.incident_id;
        state.call.tools = [
          ...state.call.tools,
          {
            incident_id: event.incident_id,
            tool: event.tool,
            args: event.args ?? {},
            result: event.result ?? {},
            ts: event.ts ?? null,
          },
        ].slice(-MAX_TOOLS);
        break;
      }
      case "demo.control": {
        break;
      }
      case "camera.online": {
        if (!acceptCameraId(event.camera_id)) break;
        const cam = ensureCamera(state, event.camera_id);
        cam.online = Boolean(event.online);
        cam.lastTs = event.ts ?? cam.lastTs;
        break;
      }
      default: {
        if (type == null) {
          console.warn("[store] event missing type", event);
        } else if (!warnedTypes.has(type)) {
          warnedTypes.add(type);
          console.warn("[store] unknown event type (ignored once):", type);
        }
        return;
      }
    }
    notify();
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function getState() {
    return state;
  }

  function getActiveSevere() {
    for (const id of state.order) {
      const inc = state.incidents[id];
      if (!inc || inc.severity !== "SEVERE") continue;
      if (!isOpenIncident(inc)) continue;
      return inc;
    }
    return null;
  }

  return {
    getState,
    handle,
    subscribe,
    setConnection,
    setDemo,
    setSelected,
    setRoute,
    reset,
    softReset,
    getActiveSevere,
    flush,
  };
}
