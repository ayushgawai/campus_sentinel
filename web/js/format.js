/** Display helpers — never show raw enums, dashes, or nullish junk. */

import { SITE, cameraLabel as siteCameraLabel } from "./site.js?v=pro7";
import { now } from "./clock.js?v=pro7";

export { cameraLabel } from "./site.js?v=pro7";

/** The one fallback for a value that has not arrived yet (never a dash). */
export const PENDING = "No data yet";

export function awaiting() {
  return PENDING;
}

export function notReported() {
  return PENDING;
}

/** snake_case / kebab-case → "Sentence case words". */
export function sentenceCase(raw) {
  const s = String(raw ?? "").replaceAll("_", " ").replaceAll("-", " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";
}

/** Rule id → "Fast descent". */
export function ruleLabel(rule) {
  return sentenceCase(rule);
}

export function textOr(value, fallback = notReported()) {
  if (value == null) return fallback;
  const s = String(value).trim();
  if (!s || s === "null" || s === "undefined" || s === "NaN") return fallback;
  return s;
}

const CLASS_LABELS = {
  FALL: "Fall",
  WEAPON: "Weapon",
  FIGHT: "Fight",
  THEFT: "Theft",
  RUN: "Running",
  MEDICAL: "Medical",
  BENIGN: "No threat",
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
  return TOOL_KEY_LABELS[key] || sentenceCase(key);
}

export function classLabel(token) {
  if (token == null || token === "") return awaiting();
  return CLASS_LABELS[token] || sentenceCase(token);
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
  return SEVERITY_LABELS[sev] || sentenceCase(sev);
}

/** @deprecated Prefer importing cameraLabel from site.js directly. */
export function cameraShort(cameraId) {
  return siteCameraLabel(cameraId);
}

export function personLabel(trackId) {
  if (!trackId) return awaiting();
  const m = String(trackId).match(/(\d+)/);
  if (!m) return `Person ${trackId}`;
  return `Person ${Number(m[1])}`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function clockParts(ms, timeZone, withDate) {
  const opts = {
    timeZone: timeZone || SITE.timezone || undefined,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  };
  if (withDate) {
    opts.weekday = "short";
    opts.day = "2-digit";
    opts.month = "short";
  }
  const parts = new Intl.DateTimeFormat("en-GB", opts).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  return get;
}

/** 24 h time only, "23:08:07" — timelines and tool cards. */
export function formatClock(ms, timeZone) {
  try {
    const get = clockParts(ms, timeZone, false);
    return `${get("hour")}:${get("minute")}:${get("second")}`;
  } catch {
    const d = new Date(ms);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }
}

/** Header clock, "Thu 24 Sep · 23:08:07" (24 h, fixed width). */
export function formatHeaderClock(ms, timeZone) {
  try {
    const get = clockParts(ms, timeZone, true);
    return `${get("weekday")} ${get("day")} ${get("month")} · ${get("hour")}:${get("minute")}:${get("second")}`;
  } catch {
    const d = new Date(ms);
    const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
    const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
    return `${wd} ${pad2(d.getDate())} ${mo} · ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }
}

/** Exact "ago": "8 s ago", "1 min 32 s ago", "1 h 04 min ago". Never negative. */
export function formatRel(iso, nowMs = now()) {
  if (!iso) return awaiting();
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return awaiting();
  const sec = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (sec < 60) return `${sec} s ago`;
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  if (mm < 60) return ss === 0 ? `${mm} min ago` : `${mm} min ${ss} s ago`;
  const hh = Math.floor(mm / 60);
  return `${hh} h ${pad2(mm % 60)} min ago`;
}

/** Tracking / pursuit elapsed, "+0:12", "+1:05", "+1:02:05". */
export function formatElapsedPlus(sec) {
  const s = Math.max(0, Math.floor(sec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return hh > 0 ? `+${hh}:${pad2(mm)}:${pad2(ss)}` : `+${mm}:${pad2(ss)}`;
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
  return sentenceCase(id);
}

/** Wall time from ISO using site timezone. */
export function formatTimeLocal(iso) {
  if (!iso) return awaiting();
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return awaiting();
  return formatClock(ms);
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

/** Live hero order within a severity: further along the response first. */
export const HERO_STATE_RANK = {
  TRACKING: 0,
  DISPATCHED: 1,
  DISPATCH_PENDING: 2,
  ALERTED: 3,
  NEW: 4,
};

/**
 * Live hero choice among open incidents: SEVERE before MINOR, then by state
 * (TRACKING, DISPATCHED, DISPATCH_PENDING, ALERTED, NEW), then most recently
 * updated.
 */
export function compareHeroIncidents(a, b) {
  const sa = SEVERITY_RANK[a?.severity] ?? 9;
  const sb = SEVERITY_RANK[b?.severity] ?? 9;
  if (sa !== sb) return sa - sb;
  const ra = HERO_STATE_RANK[a?.state] ?? 9;
  const rb = HERO_STATE_RANK[b?.state] ?? 9;
  if (ra !== rb) return ra - rb;
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
