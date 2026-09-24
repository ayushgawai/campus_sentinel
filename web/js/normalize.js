/* Wire payload -> view model.
 *
 * Every field below is either present in the frozen contracts or derived here
 * from something that is. The optional mock-only extras this file used to
 * tolerate are gone, because the mock is gone and services/api never sent any
 * of them:
 *
 *   display_title   -> always CLASS_TITLE[class_token]
 *   track_path      -> removed with the map trail
 *   predicted_next  -> removed with the prediction ring (nobody computes it)
 *   models_count    -> removed; the health tile shows models_resident
 *   gpu_temp_c      -> removed with the GPU tile
 *   clip_uri        -> removed; nothing renders it, and vision_bridge leaves
 *                      it empty anyway
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
    title: CLASS_TITLE[dict.class_token] || 'Incident',

    // Three score readouts in the detail panel.
    routerScore: num(dict.router_score),
    visionProb: num(dict.class_logprob_calibrated),
    fusedProb: fused,
    confidencePct: Math.round(fused * 100),

    severity: dict.severity,
    uiSeverity: uiSeverity(dict.severity),

    description: dict.description || '',
    locationText: dict.location_text || '',
    personDescription: dict.person_description || '',

    state,
    stateLabel: STATE_LABEL[state] || state,
    open: isOpen(state),
    alerting: isAlerting(state),

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
  };
}

/** contracts/events.py :: HealthStrip -> health view model.
 *
 *  gpu_util and p95_ms are on the wire but omitted here on purpose:
 *  DemoHub._health() sends them as the literal constants 0.68 and 182.0 on
 *  every tick, so no tile can honestly display them. Add them back when the
 *  hub reports measured values. */
export function normalizeHealth(dict) {
  const screened = num(dict.frames_screened);
  const escalated = num(dict.frames_escalated);

  return {
    camerasOnline: num(dict.cameras_online),
    camerasTotal: num(dict.cameras_total),

    modelsResident: Boolean(dict.models_resident),

    framesScreened: screened,
    framesEscalated: escalated,
    // derived, not sent on the wire
    escalationPct: screened > 0 ? (escalated / screened) * 100 : 0,

    ts: toDate(dict.ts),
  };
}

/** contracts/events.py :: OverlayBoxes -> overlay view model.
 *
 *  x/y/w/h are normalised 0..1. The contract does not say so, but
 *  _norm_boxes() in services/api/vision_bridge.py divides the YOLO pixel
 *  values by the frame size and clamps to 0..1 before publishing. */
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
    // per-pane "ROUTER 0.74" readout is derived, not a contract field
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
