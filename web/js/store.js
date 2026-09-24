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

    /** incidentId -> { incidentId, transcript: [], toolCalls: [],
     *                  startedAt, lastDeltaAt, dismissed }
     *  No `brief`: services/api never serializes a CallBrief onto the socket.
     *  No `ended`: there is no call.ended envelope either — see ensureCall. */
    calls: new Map(),
    activeCallId: null,
    /** whether the console has taken the panel below the camera wall */
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

  /** Back to an empty board.
   *
   *  Nothing is seeded client-side: the backend's own reset (DemoHub.reset →
   *  seed) re-publishes camera.online, health.strip and a fresh scenario, so
   *  the queue refills from the wire. Fabricating starter incidents here would
   *  put rows in the queue that no service knows about.
   */
  function clearIncidents() {
    state.incidents = new Map();
    state.overlays = new Map();
    state.selectedId = null;
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

  /**
   * Open (or find) the console entry for an incident the voice service has
   * started talking about.
   *
   * There is no call.started envelope: services/voice publishes only
   * call.transcript_delta and tool.call_live, and DemoHub.publish() kicks the
   * VoiceAgent off on any SEVERE upsert with no operator involvement. So the
   * arrival of a delta IS the signal that a call exists, and this runs on every
   * one of them. It must stay idempotent.
   *
   * Once the operator closes the console the call is marked `dismissed` and
   * later deltas keep accumulating without popping the panel back open.
   */
  function ensureCall(incidentId) {
    if (!incidentId) return null;

    let call = state.calls.get(incidentId);
    let changed = false;

    if (!call) {
      call = {
        incidentId,
        transcript: [],
        toolCalls: [],
        startedAt: new Date(),
        lastDeltaAt: new Date(),
        dismissed: false,
      };
      state.calls.set(incidentId, call);
      changed = true;
    }

    if (!call.dismissed) {
      if (state.activeCallId !== incidentId) {
        state.activeCallId = incidentId;
        changed = true;
      }
      if (!state.callVisible) {
        state.callVisible = true;
        changed = true;
      }
    }

    if (changed) notify(Change.CALL);
    return call;
  }

  function appendTranscript(vm) {
    const call = ensureCall(vm.incidentId);
    if (!call) return;
    call.transcript = [...call.transcript, vm];
    call.lastDeltaAt = new Date();
    notify(Change.CALL);
  }

  function appendToolCall(vm) {
    const call = ensureCall(vm.incidentId);
    if (!call) return;
    call.toolCalls = [...call.toolCalls, vm];
    call.lastDeltaAt = new Date();
    notify(Change.CALL);
  }

  function setCallVisible(visible) {
    if (!visible) {
      const call = activeCall();
      if (call) call.dismissed = true;
    }
    state.callVisible = visible;
    notify(Change.CALL);
  }

  function activeCall() {
    return state.activeCallId ? state.calls.get(state.activeCallId) || null : null;
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
    clearIncidents,
    // intent
    select,
    setFilter,
    toggleExpand,
    expandCamera,
    setPaused,
    setPrewarmed,
    clearUnseen,
    // call console
    ensureCall,
    appendTranscript,
    appendToolCall,
    setCallVisible,
    activeCall,
    // selectors
    visibleIncidents,
    selected,
    alertingCameraIds,
    alertingTracks,
    openCount,
  };
}
