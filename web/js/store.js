/* Single in-memory store.
 *
 * Subscribers receive (state, changeKind) so high-frequency overlay ticks
 * never force the queue or detail panel to re-render.
 */

import { STATE_LABEL, isOpen, isAlerting } from './contracts.js';

export const Change = {
  INCIDENTS: 'incidents',
  HEALTH: 'health',
  OVERLAYS: 'overlays',
  CAMERAS: 'cameras',
  SELECTION: 'selection',
  FILTER: 'filter',
  WALL: 'wall',
  NOTIFICATIONS: 'notifications',
  DEMO: 'demo',
  CALL: 'call',
};

export function createStore() {
  const state = {
    /** id -> camera descriptor (name, map position, online) */
    cameras: new Map(),
    /** camera ids shown on the wall, in order */
    wall: [],

    /** id -> incident view model */
    incidents: new Map(),
    /** cameraId -> overlay view model */
    overlays: new Map(),

    health: null,

    selectedId: null,
    expandedCameraId: null,
    filter: 'ALL',

    paused: false,
    prewarmed: false,

    notifications: [],
    unseen: 0,

    /** incidentId -> { brief, transcript: [], toolCalls: [], startedAt, ended } */
    calls: new Map(),
    activeCallId: null,
    /** whether the console has taken over the lower half of the screen */
    callVisible: false,
  };

  const subs = new Set();

  function notify(kind) {
    for (const fn of subs) {
      try {
        fn(state, kind);
      } catch (err) {
        console.error('[store] subscriber failed on', kind, err);
      }
    }
  }

  /* ---------------- ingest ---------------- */

  function setCameras(list) {
    state.cameras = new Map(list.map((c) => [c.id, { ...c, online: true }]));
    state.wall = list.filter((c) => c.onWall).map((c) => c.id);
    notify(Change.CAMERAS);
  }

  function setCameraOnline({ cameraId, online }) {
    const cam = state.cameras.get(cameraId);
    if (!cam) return;
    cam.online = online;
    notify(Change.CAMERAS);
  }

  function upsertIncident(vm) {
    const isNew = !state.incidents.has(vm.id);
    state.incidents.set(vm.id, vm);

    if (isNew) {
      state.notifications.unshift({
        incidentId: vm.id,
        title: vm.title,
        locationText: vm.locationText,
        uiSeverity: vm.uiSeverity,
        ts: vm.createdAt || new Date(),
      });
      state.notifications = state.notifications.slice(0, 12);
      state.unseen += 1;
      notify(Change.NOTIFICATIONS);
    }

    notify(Change.INCIDENTS);
    return isNew;
  }

  /** Append a timeline entry and move the incident's state. */
  function applyStateChange({ incidentId, state: next, ts, note }) {
    const inc = state.incidents.get(incidentId);
    if (!inc) return null;

    inc.state = next;
    inc.updatedAt = ts || new Date();
    inc.timeline = [...inc.timeline, { ts: ts || new Date(), state: next, note }];

    // recompute derived display fields
    inc.stateLabel = STATE_LABEL[next] || next;
    inc.open = isOpen(next);
    inc.alerting = isAlerting(next);

    notify(Change.INCIDENTS);
    return inc;
  }

  function setHealth(vm) {
    state.health = vm;
    notify(Change.HEALTH);
  }

  function setOverlay(vm) {
    state.overlays.set(vm.cameraId, vm);
    notify(Change.OVERLAYS);
  }

  function resetIncidents(list) {
    state.incidents = new Map(list.map((vm) => [vm.id, vm]));
    state.overlays = new Map();
    state.selectedId = list.length ? list[0].id : null;
    state.notifications = [];
    state.unseen = 0;
    state.expandedCameraId = null;
    state.filter = 'ALL';
    state.calls = new Map();
    state.activeCallId = null;
    state.callVisible = false;
    notify(Change.INCIDENTS);
    notify(Change.NOTIFICATIONS);
    notify(Change.SELECTION);
    notify(Change.CALL);
  }

  /* ---------------- ui intent ---------------- */

  function select(incidentId) {
    if (state.selectedId === incidentId) return;
    state.selectedId = incidentId;
    notify(Change.SELECTION);
  }

  function setFilter(filter) {
    state.filter = filter;
    notify(Change.FILTER);
  }

  function toggleExpand(cameraId) {
    state.expandedCameraId = state.expandedCameraId === cameraId ? null : cameraId;
    notify(Change.WALL);
  }

  function expandCamera(cameraId) {
    state.expandedCameraId = cameraId;
    notify(Change.WALL);
  }

  function setPaused(paused) {
    state.paused = paused;
    notify(Change.DEMO);
  }

  function setPrewarmed(prewarmed) {
    state.prewarmed = prewarmed;
    notify(Change.DEMO);
  }

  function clearUnseen() {
    if (state.unseen === 0) return;
    state.unseen = 0;
    notify(Change.NOTIFICATIONS);
  }

  /* ---------------- call console ---------------- */

  function startCall(incidentId, brief) {
    state.calls.set(incidentId, {
      incidentId,
      brief,
      transcript: [],
      toolCalls: [],
      startedAt: new Date(),
      ended: false,
    });
    state.activeCallId = incidentId;
    state.callVisible = true;
    notify(Change.CALL);
  }

  function appendTranscript(vm) {
    const call = state.calls.get(vm.incidentId);
    if (!call) return;
    call.transcript = [...call.transcript, vm];
    notify(Change.CALL);
  }

  function appendToolCall(vm) {
    const call = state.calls.get(vm.incidentId);
    if (!call) return;
    call.toolCalls = [...call.toolCalls, vm];
    notify(Change.CALL);
  }

  function endCall(incidentId) {
    const call = state.calls.get(incidentId);
    if (!call) return;
    call.ended = true;
    notify(Change.CALL);
  }

  function setCallVisible(visible) {
    state.callVisible = visible;
    notify(Change.CALL);
  }

  function clearCalls() {
    state.calls = new Map();
    state.activeCallId = null;
    state.callVisible = false;
    notify(Change.CALL);
  }

  function activeCall() {
    return state.activeCallId ? state.calls.get(state.activeCallId) || null : null;
  }

  function hasCall(incidentId) {
    return state.calls.has(incidentId);
  }

  /* ---------------- selectors ---------------- */

  /** Newest first, filtered by the severity chips. */
  function visibleIncidents() {
    const all = [...state.incidents.values()].sort(
      (a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)
    );
    if (state.filter === 'ALL') return all;
    return all.filter((i) => i.uiSeverity === state.filter);
  }

  function selected() {
    return state.selectedId ? state.incidents.get(state.selectedId) || null : null;
  }

  /** Cameras that should show the red alert border. */
  function alertingCameraIds() {
    const ids = new Set();
    for (const inc of state.incidents.values()) {
      if (inc.alerting) ids.add(inc.cameraId);
    }
    return ids;
  }

  /** cameraId -> Set(track_id) for the tracks tied to an alerting incident,
   *  so the wall reddens only the box that belongs to the incident. */
  function alertingTracks() {
    const map = new Map();
    for (const inc of state.incidents.values()) {
      if (!inc.alerting) continue;
      if (!map.has(inc.cameraId)) map.set(inc.cameraId, new Set());
      map.get(inc.cameraId).add(inc.trackId);
    }
    return map;
  }

  function openCount() {
    let n = 0;
    for (const inc of state.incidents.values()) if (inc.open) n += 1;
    return n;
  }

  function counts() {
    const out = { ALL: 0, CRITICAL: 0, HIGH: 0, MEDIUM: 0 };
    for (const inc of state.incidents.values()) {
      out.ALL += 1;
      if (inc.uiSeverity in out) out[inc.uiSeverity] += 1;
    }
    return out;
  }

  return {
    getState: () => state,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    // ingest
    setCameras,
    setCameraOnline,
    upsertIncident,
    applyStateChange,
    setHealth,
    setOverlay,
    resetIncidents,
    // intent
    select,
    setFilter,
    toggleExpand,
    expandCamera,
    setPaused,
    setPrewarmed,
    clearUnseen,
    // call console
    startCall,
    appendTranscript,
    appendToolCall,
    endCall,
    setCallVisible,
    clearCalls,
    activeCall,
    hasCall,
    // selectors
    visibleIncidents,
    selected,
    alertingCameraIds,
    alertingTracks,
    openCount,
    counts,
  };
}
