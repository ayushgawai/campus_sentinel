/* Wire payload -> view model.
 *
 * Every field the UI needs is either (a) present in the frozen contracts, or
 * (b) derived here, or (c) an OPTIONAL extra that only the mock emitter
 * supplies. Category (c) must always degrade gracefully, because the real
 * services/api will not send it:
 *
 *   display_title   -> falls back to CLASS_TITLE[class_token]
 *   track_path      -> falls back to [camera_id] (no trail drawn)
 *   predicted_next  -> falls back to null (no prediction ring)
 *   models_count    -> falls back to the models_resident boolean
 *   gpu_temp_c      -> hidden when absent
 *
 * No field below is ever written back to the wire.
 */

import { CLASS_TITLE, uiSeverity, STATE_LABEL, isOpen, isAlerting } from './contracts.js';

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Contracts guarantee timezone-aware UTC ISO-8601 strings. */
function toDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** contracts/incident.py :: incident_to_dict -> incident view model */
export function normalizeIncident(dict) {
  const fused = num(dict.fused_prob);
  const state = dict.state;

  return {
    id: dict.incident_id,
    trackId: dict.track_id,
    cameraId: dict.camera_id,

    classToken: dict.class_token,
    title: dict.display_title || CLASS_TITLE[dict.class_token] || 'Incident',

    // Three score readouts in the detail panel.
    routerScore: num(dict.router_score),
    visionProb: num(dict.class_logprob_calibrated),
    fusedProb: fused,
    confidencePct: Math.round(fused * 100),

    severity: dict.severity,
    uiSeverity: uiSeverity(dict.severity, fused),

    description: dict.description || '',
    locationText: dict.location_text || '',
    personDescription: dict.person_description || '',

    state,
    stateLabel: STATE_LABEL[state] || state,
    open: isOpen(state),
    alerting: isAlerting(state),

    clipUri: dict.clip_uri || '',
    rulesFired: Array.isArray(dict.rules_fired) ? [...dict.rules_fired] : [],

    peakTs: toDate(dict.peak_ts),
    createdAt: toDate(dict.created_at),
    updatedAt: toDate(dict.updated_at),

    timeline: (dict.timeline || []).map((ev) => ({
      ts: toDate(ev.ts),
      state: ev.state,
      note: ev.note || '',
    })),

    dismissedReason: dict.dismissed_reason || null,

    // optional mock-only extras
    trackPath: Array.isArray(dict.track_path) && dict.track_path.length
      ? [...dict.track_path]
      : [dict.camera_id],
    predictedNext: dict.predicted_next || null,
  };
}

/** contracts/events.py :: HealthStrip -> health view model */
export function normalizeHealth(dict) {
  const screened = num(dict.frames_screened);
  const escalated = num(dict.frames_escalated);

  return {
    camerasOnline: num(dict.cameras_online),
    camerasTotal: num(dict.cameras_total),

    // contract field is a boolean; models_count is a mock-only nicety
    modelsResident: Boolean(dict.models_resident),
    modelsCount: typeof dict.models_count === 'number' ? dict.models_count : null,

    gpuUtil: num(dict.gpu_util),
    gpuTempC: typeof dict.gpu_temp_c === 'number' ? dict.gpu_temp_c : null,

    p95Ms: num(dict.p95_ms),

    framesScreened: screened,
    framesEscalated: escalated,
    // derived, not sent on the wire
    escalationPct: screened > 0 ? (escalated / screened) * 100 : 0,

    ts: toDate(dict.ts),
  };
}

/** contracts/events.py :: OverlayBoxes -> overlay view model.
 *  BBox x/y/w/h are assumed normalised 0..1 (the contract does not say;
 *  confirm with services/vision before going live). */
export function normalizeOverlay(dict) {
  const boxes = (dict.boxes || []).map((b) => ({
    x: num(b.x),
    y: num(b.y),
    w: num(b.w),
    h: num(b.h),
    trackId: b.track_id,
    label: b.label || '',
    score: typeof b.score === 'number' ? b.score : null,
  }));

  const scores = boxes.map((b) => b.score).filter((s) => s !== null);

  return {
    cameraId: dict.camera_id,
    ts: toDate(dict.ts),
    boxes,
    tracked: boxes.length,
    // per-pane "ROUTER 0.74" readout is not a contract field
    routerScore: scores.length ? Math.max(...scores) : 0,
  };
}

/** contracts/events.py :: IncidentStateChange */
export function normalizeStateChange(dict) {
  return {
    incidentId: dict.incident_id,
    state: dict.state,
    severity: dict.severity || null,
    ts: toDate(dict.ts),
    note: dict.note || '',
  };
}

/** contracts/events.py :: CameraOnline */
export function normalizeCameraOnline(dict) {
  return {
    cameraId: dict.camera_id,
    online: Boolean(dict.online),
    ts: toDate(dict.ts),
  };
}

/** contracts/events.py :: CallTranscriptDelta */
export function normalizeTranscriptDelta(dict) {
  return {
    incidentId: dict.incident_id,
    // contract restricts this to 'dispatcher' | 'sentinel'
    speaker: dict.speaker === 'dispatcher' ? 'dispatcher' : 'sentinel',
    text: dict.text || '',
    ts: toDate(dict.ts),
  };
}

/** contracts/events.py :: ToolCallLive */
export function normalizeToolCall(dict) {
  return {
    incidentId: dict.incident_id,
    tool: dict.tool || '',
    args: dict.args && typeof dict.args === 'object' ? dict.args : {},
    result: dict.result && typeof dict.result === 'object' ? dict.result : {},
    ts: toDate(dict.ts),
  };
}

/** contracts/call_brief.py :: call_brief_to_dict -> call brief view model.
 *  Facts only by contract: no summary or assessment fields exist to read. */
export function normalizeCallBrief(dict) {
  return {
    incidentId: dict.incident_id,
    cameraId: dict.camera_id,
    address: dict.address || '',
    building: dict.building || null,
    coordinates: Array.isArray(dict.coordinates) ? [...dict.coordinates] : null,
    entrances: Array.isArray(dict.entrances) ? [...dict.entrances] : [],
    personDescription: dict.person_description || '',
    incidentStartedAt: toDate(dict.incident_started_at),
    briefGeneratedAt: toDate(dict.brief_generated_at),
    peakTs: toDate(dict.peak_ts),
    dispatchedTs: toDate(dict.dispatched_ts),
    mapLookupRefs: Array.isArray(dict.map_lookup_refs) ? [...dict.map_lookup_refs] : [],
  };
}
