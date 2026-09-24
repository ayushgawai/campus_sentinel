/* Read-only mirror of the frozen schemas in /contracts.
 *
 * This file is a COPY, not an import — the Python package cannot be loaded
 * in the browser, and nothing outside web/ may be modified. If contracts/
 * ever changes, this file must be updated to match by hand.
 *
 * Source of truth: contracts/incident.py, contracts/events.py
 */

/** contracts/events.py :: EventType */
export const EventType = {
  INCIDENT_UPSERT: 'incident.upsert',
  INCIDENT_STATE_CHANGE: 'incident.state_change',
  OVERLAY_BOXES: 'overlay.boxes',
  HEALTH_STRIP: 'health.strip',
  CALL_TRANSCRIPT_DELTA: 'call.transcript_delta',
  TOOL_CALL_LIVE: 'tool.call_live',
  DEMO_CONTROL: 'demo.control',
  CAMERA_ONLINE: 'camera.online',
};

/** contracts/incident.py :: IncidentState */
export const IncidentState = {
  NEW: 'NEW',
  ALERTED: 'ALERTED',
  DISPATCH_PENDING: 'DISPATCH_PENDING',
  DISPATCHED: 'DISPATCHED',
  TRACKING: 'TRACKING',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'DISMISSED',
};

/** contracts/incident.py :: IncidentClass — the VLM six-class set. */
export const IncidentClass = {
  WEAPON: 'WEAPON',
  FIGHT: 'FIGHT',
  THEFT: 'THEFT',
  RUN: 'RUN',
  MEDICAL: 'MEDICAL',
  BENIGN: 'BENIGN',
};

/** contracts/incident.py :: Severity — exactly three values. */
export const Severity = {
  NONE: 'NONE',
  MINOR: 'MINOR',
  SEVERE: 'SEVERE',
};

/* ------------------------------------------------------------------ *
 * PRESENTATION-ONLY MAPPINGS
 *
 * CRITICAL / MEDIUM and the REVIEW badge are not contract values. Everything
 * below is display vocabulary that lives entirely in the browser; the wire
 * format is untouched.
 * ------------------------------------------------------------------ */

/* There used to be a HIGH bucket here, splitting Severity.MINOR at
 * fused_prob >= 0.8. It was unreachable and has been removed.
 *
 * bench/thresholds.json sets severe_at to 0.80, and
 * services/brain/thresholds.py :: severity_from_fused returns SEVERE at
 * fused_prob >= severe_at. So MINOR implies fused_prob < 0.80, and the
 * condition fused_prob >= 0.8 could never hold for a MINOR incident. The chip
 * and badge were permanently empty.
 *
 * Dispatch thresholds are owned by brain. If severe_at ever moves back above
 * 0.8, a display split becomes possible again — but it should be derived from
 * the real threshold rather than hardcoded here. */
export const UiSeverity = {
  CRITICAL: 'CRITICAL',
  MEDIUM: 'MEDIUM',
  NONE: 'NONE',
};

/** Severity -> queue badge / filter bucket. */
export function uiSeverity(severity) {
  if (severity === Severity.SEVERE) return UiSeverity.CRITICAL;
  if (severity === Severity.MINOR) return UiSeverity.MEDIUM;
  return UiSeverity.NONE;
}

/** IncidentState -> badge text shown in the queue. */
export const STATE_LABEL = {
  NEW: 'REVIEW',
  ALERTED: 'ALERTED',
  DISPATCH_PENDING: 'PENDING',
  DISPATCHED: 'DISPATCHED',
  TRACKING: 'TRACKING',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'FALSE ALARM',
};

/** IncidentClass -> headline shown in the queue and detail panel.
 *  A mock incident may override this with the optional display_title
 *  field; see js/normalize.js. */
export const CLASS_TITLE = {
  WEAPON: 'Weapon detected',
  FIGHT: 'Altercation',
  THEFT: 'Forced entry',
  RUN: 'Running subject',
  MEDICAL: 'Medical distress',
  BENIGN: 'Benign activity',
};

/** Terminal states lock every action button. */
export const CLOSED_STATES = new Set([
  IncidentState.RESOLVED,
  IncidentState.DISMISSED,
]);

/** States that count as an active, unresolved incident. */
export function isOpen(state) {
  return !CLOSED_STATES.has(state);
}

/** An incident whose camera gets the red alert border and red overlay box.
 *  NEW is excluded on purpose: it is still under review, so its pane stays
 *  calm until the system has actually raised the incident. */
export function isAlerting(state) {
  return state === IncidentState.ALERTED
    || state === IncidentState.DISPATCH_PENDING
    || state === IncidentState.DISPATCHED
    || state === IncidentState.TRACKING;
}
