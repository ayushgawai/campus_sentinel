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

/** The five agentic call tools from playbook §04-E, with the label shown in
 *  the call console. Each one is a lookup, never a generation. */
export const CALL_TOOLS = {
  lookup_location: 'lookup_location',
  get_suspect_status: 'get_suspect_status',
  get_elapsed_time: 'get_elapsed_time',
  get_person_description: 'get_person_description',
  repeat_last: 'repeat_last',
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
  FALL: 'FALL',
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
 * The mockup uses CRITICAL / HIGH / MEDIUM and a REVIEW badge. None of
 * those are contract values. Everything below is display vocabulary that
 * lives entirely in the browser; the wire format is untouched.
 * ------------------------------------------------------------------ */

/** UI-invented split inside Severity.MINOR. Display only — not a threshold
 *  the system acts on. Real dispatch thresholds live in
 *  services/brain/thresholds.py and are owned by brain. */
export const UI_HIGH_AT = 0.8;

export const UiSeverity = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  NONE: 'NONE',
};

/** Severity + fused_prob -> queue badge / filter bucket. */
export function uiSeverity(severity, fusedProb = 0) {
  if (severity === Severity.SEVERE) return UiSeverity.CRITICAL;
  if (severity === Severity.MINOR) {
    return fusedProb >= UI_HIGH_AT ? UiSeverity.HIGH : UiSeverity.MEDIUM;
  }
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
  FALL: 'Person down',
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
