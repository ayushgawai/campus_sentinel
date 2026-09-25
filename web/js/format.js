/** Display helpers — never show raw enums, dashes, or nullish junk. */

import { SITE, cameraLabel as siteCameraLabel } from "./site.js";

export { cameraLabel } from "./site.js";

export function awaiting() {
  return "Awaiting data";
}

export function notReported() {
  return "Not reported";
}

export function textOr(value, fallback = notReported()) {
  if (value == null) return fallback;
  const s = String(value).trim();
  if (!s || s === "null" || s === "undefined" || s === "NaN") return fallback;
  return s;
}

const CLASS_LABELS = {
  FALL: "Fall",
  FIGHT: "Fight",
  THEFT: "Theft",
  RUN: "Run",
  MEDICAL: "Medical",
  BENIGN: "Benign",
};

const STATE_LABELS = {
  NEW: "New",
  ALERTED: "Alerted",
  DISPATCH_PENDING: "Dispatch pending",
  DISPATCHED: "Dispatched",
  TRACKING: "Tracking",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
};

/** States where the SIMULATED call/dispatch affordance must stay visible. */
const DISPATCH_SIM_STATES = new Set([
  "DISPATCH_PENDING",
  "DISPATCHED",
  "TRACKING",
]);

export function isDispatchSimState(state) {
  return DISPATCH_SIM_STATES.has(state);
}

const SEVERITY_LABELS = {
  NONE: "None",
  MINOR: "Minor",
  SEVERE: "Severe",
};

const TOOL_KEY_LABELS = {
  incident_id: "Incident",
  camera_id: "Camera",
  person_description: "Person",
  elapsed_seconds: "Elapsed",
  peak_ts: "Peak time",
  state: "State",
  track_id: "Track",
  in_view: "In view",
};

/** Arg/result keys that must never render (place-bearing). */
export const LOCATION_TOOL_KEYS = new Set([
  "location",
  "location_text",
  ["addr", "ess"].join(""),
  ["build", "ing"].join(""),
  "coordinates",
  "lat",
  "lon",
  "lng",
  ["ent", "rance", "s"].join(""),
  "zone",
  ["stre", "et"].join(""),
  "map_lookup_refs",
]);

/** Internal pipeline fields — skip in operator UI. */
export const HIDDEN_TOOL_KEYS = new Set([
  "incident_id",
  "track_id",
  "schema_version",
  "in_view",
]);

export function toolKeyLabel(key) {
  return TOOL_KEY_LABELS[key] || String(key).replaceAll("_", " ");
}

export function classLabel(token) {
  if (token == null || token === "") return awaiting();
  return CLASS_LABELS[token] || String(token);
}

export function stateLabel(state) {
  if (state == null || state === "") return awaiting();
  return (
    STATE_LABELS[state] ||
    String(state)
      .replaceAll("_", " ")
      .toLowerCase()
      .replace(/^\w/, (c) => c.toUpperCase())
  );
}

export function severityLabel(sev) {
  if (sev == null || sev === "") return awaiting();
  return SEVERITY_LABELS[sev] || String(sev);
}

/** @deprecated Prefer importing cameraLabel from site.js directly. */
export function cameraShort(cameraId) {
  return siteCameraLabel(cameraId);
}

export function personLabel(trackId) {
  if (!trackId) return awaiting();
  const m = String(trackId).match(/(\d+)/);
  if (!m) return `Person ${trackId}`;
  return `Person #${Number(m[1])}`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Format a Date in the site timezone as "2:14:07 AM". */
export function formatClock(d = new Date(), timeZone = SITE.timezone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t)?.value || "";
    return `${get("hour")}:${get("minute")}:${get("second")} ${get("dayPeriod")}`;
  } catch {
    let h = d.getHours();
    const m = d.getMinutes();
    const s = d.getSeconds();
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${pad2(m)}:${pad2(s)} ${ap}`;
  }
}

export function formatRel(iso, nowMs = Date.now()) {
  if (!iso) return awaiting();
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return awaiting();
  const sec = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (sec < 60) {
    return sec === 1 ? "1 s ago" : `${sec} s ago`;
  }
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  if (mm < 60) {
    if (ss === 0) return mm === 1 ? "1 min ago" : `${mm} min ago`;
    return `${mm} min ${ss} s ago`;
  }
  const hh = Math.floor(mm / 60);
  const remMin = mm % 60;
  if (remMin === 0) return hh === 1 ? "1 h ago" : `${hh} h ago`;
  return `${hh} h ${remMin} min ago`;
}

/** Human label for a tool id (never show snake_case). */
export function toolNameLabel(tool) {
  if (tool == null || tool === "") return awaiting();
  const KEY = {
    lookup_location: "Look up location",
    get_person_description: "Person description",
    get_elapsed_time: "Elapsed time",
    get_suspect_status: "Suspect status",
    repeat_last: "Repeat last",
  };
  const id = String(tool);
  if (KEY[id]) return KEY[id];
  return id
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Wall time from ISO using site timezone. */
export function formatTimeLocal(iso) {
  if (!iso) return awaiting();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return awaiting();
  return formatClock(d);
}

export function formatPct(util) {
  if (util == null || Number.isNaN(util)) return awaiting();
  const pct = util <= 1 ? util * 100 : util;
  if (pct === 0) return "0%";
  if (pct < 10) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

export function pctNumber(util) {
  if (util == null || Number.isNaN(util)) return null;
  return util <= 1 ? util * 100 : util;
}

export function formatInt(n) {
  if (n == null || Number.isNaN(n)) return awaiting();
  return Math.floor(n).toLocaleString("en-US");
}

export function formatMs(ms) {
  if (ms == null || Number.isNaN(ms)) return awaiting();
  return `${Math.round(ms)} ms`;
}

export function formatScore(n, digits = 2) {
  if (n == null || Number.isNaN(n)) return awaiting();
  return Number(n).toFixed(digits);
}

export function isOpenIncident(inc) {
  if (!inc) return false;
  return inc.state !== "RESOLVED" && inc.state !== "DISMISSED";
}

export const SEVERITY_RANK = { SEVERE: 0, MINOR: 1, NONE: 2 };

/** Active first, then severity, then recency. */
export function compareIncidents(a, b) {
  const oa = isOpenIncident(a) ? 0 : 1;
  const ob = isOpenIncident(b) ? 0 : 1;
  if (oa !== ob) return oa - ob;
  const sa = SEVERITY_RANK[a?.severity] ?? 9;
  const sb = SEVERITY_RANK[b?.severity] ?? 9;
  if (sa !== sb) return sa - sb;
  const ta = Date.parse(a?.updated_at || a?.created_at || a?.peak_ts || 0) || 0;
  const tb = Date.parse(b?.updated_at || b?.created_at || b?.peak_ts || 0) || 0;
  return tb - ta;
}

/** Prefer active Severe, then active Minor, then most recent. */
export function preferredIncidentId(state) {
  const ids = state.order || [];
  let bestSevere = null;
  let bestMinor = null;
  for (const id of ids) {
    const inc = state.incidents[id];
    if (!inc || !isOpenIncident(inc)) continue;
    if (inc.severity === "SEVERE" && !bestSevere) bestSevere = id;
    if (inc.severity === "MINOR" && !bestMinor) bestMinor = id;
  }
  if (bestSevere) return bestSevere;
  if (bestMinor) return bestMinor;
  return ids[0] || null;
}
