/**
 * Validate inbound WebSocket / mock events against contracts/events.py shapes.
 * Unknown types and wrong field types are ignored (never crash the UI).
 */

const KNOWN = new Set([
  "incident.upsert",
  "incident.state_change",
  "overlay.boxes",
  "health.strip",
  "call.transcript_delta",
  "tool.call_live",
  "demo.control",
  "camera.online",
  "usage.tick",
  "usage.total",
  "activity.tick",
]);

const INCIDENT_STATES = new Set([
  "NEW",
  "ALERTED",
  "DISPATCH_PENDING",
  "DISPATCHED",
  "TRACKING",
  "RESOLVED",
  "DISMISSED",
]);

const SEVERITIES = new Set(["NONE", "MINOR", "SEVERE"]);
const SPEAKERS = new Set(["dispatcher", "sentinel"]);
const DEMO_ACTIONS = new Set(["reset", "scenario", "prewarm"]);

function isObj(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function isStr(v) {
  return typeof v === "string";
}

function isBool(v) {
  return typeof v === "boolean";
}

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function isOptStr(v) {
  return v == null || isStr(v);
}

function isOptNum(v) {
  return v == null || isNum(v);
}

function isOptBool(v) {
  return v == null || isBool(v);
}

function sanitizeIncident(raw) {
  if (!isObj(raw) || !isStr(raw.incident_id) || !raw.incident_id) return null;
  const out = { ...raw };
  // Coerce text fields to strings so XSS payloads render as literal text.
  for (const key of [
    "description",
    "location_text",
    "person_description",
    "clip_uri",
    "track_id",
    "camera_id",
    "class_token",
    "severity",
    "state",
    "dismissed_reason",
    "schema_version",
  ]) {
    if (out[key] != null && typeof out[key] !== "string") {
      out[key] = String(out[key]);
    }
  }
  if (out.rules_fired != null && !Array.isArray(out.rules_fired)) {
    out.rules_fired = [];
  }
  if (out.rules_fired) {
    out.rules_fired = out.rules_fired.map((r) => String(r));
  }
  if (out.timeline != null && !Array.isArray(out.timeline)) {
    out.timeline = [];
  }
  return out;
}

function validateBoxes(boxes) {
  if (!Array.isArray(boxes)) return [];
  const out = [];
  for (const b of boxes) {
    if (!isObj(b)) continue;
    if (!isNum(b.x) || !isNum(b.y) || !isNum(b.w) || !isNum(b.h)) continue;
    if (!isStr(b.track_id)) continue;
    out.push({
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      track_id: b.track_id,
      label: isStr(b.label) ? b.label : "",
      score: isOptNum(b.score) ? b.score : null,
    });
  }
  return out;
}

/**
 * @returns {object|null} sanitized event or null to ignore
 */
export function validateEvent(raw) {
  if (!isObj(raw) || !isStr(raw.type)) return null;
  if (!KNOWN.has(raw.type)) return null;

  switch (raw.type) {
    case "incident.upsert": {
      const inc = sanitizeIncident(raw.incident ?? raw.incident_dict);
      if (!inc) return null;
      return { type: "incident.upsert", incident: inc };
    }
    case "incident.state_change": {
      if (!isStr(raw.incident_id) || !raw.incident_id) return null;
      if (!isStr(raw.state) || !INCIDENT_STATES.has(raw.state)) return null;
      if (raw.severity != null && !SEVERITIES.has(raw.severity)) return null;
      return {
        type: "incident.state_change",
        incident_id: raw.incident_id,
        state: raw.state,
        severity: raw.severity ?? null,
        ts: isOptStr(raw.ts) ? raw.ts : null,
        note: isStr(raw.note) ? raw.note : String(raw.note ?? ""),
      };
    }
    case "overlay.boxes": {
      if (!isStr(raw.camera_id)) return null;
      return {
        type: "overlay.boxes",
        camera_id: raw.camera_id,
        ts: isOptStr(raw.ts) ? raw.ts : null,
        boxes: validateBoxes(raw.boxes),
      };
    }
    case "health.strip": {
      return {
        type: "health.strip",
        cameras_online: isNum(raw.cameras_online) ? raw.cameras_online : 0,
        cameras_total: isNum(raw.cameras_total) ? raw.cameras_total : 0,
        models_resident: isBool(raw.models_resident)
          ? raw.models_resident
          : false,
        gpu_util: isOptNum(raw.gpu_util) ? raw.gpu_util : null,
        p95_ms: isOptNum(raw.p95_ms) ? raw.p95_ms : null,
        frames_screened: isNum(raw.frames_screened) ? raw.frames_screened : 0,
        frames_escalated: isNum(raw.frames_escalated)
          ? raw.frames_escalated
          : 0,
        ts: isOptStr(raw.ts) ? raw.ts : null,
      };
    }
    case "call.transcript_delta": {
      if (!isStr(raw.incident_id)) return null;
      if (!isStr(raw.speaker) || !SPEAKERS.has(raw.speaker)) return null;
      const text =
        raw.text == null
          ? ""
          : typeof raw.text === "string"
            ? raw.text
            : String(raw.text);
      return {
        type: "call.transcript_delta",
        incident_id: raw.incident_id,
        speaker: raw.speaker,
        text,
        ts: isOptStr(raw.ts) ? raw.ts : null,
      };
    }
    case "tool.call_live": {
      if (!isStr(raw.incident_id)) return null;
      if (!isStr(raw.tool)) return null;
      return {
        type: "tool.call_live",
        incident_id: raw.incident_id,
        tool: raw.tool,
        args: isObj(raw.args) ? raw.args : {},
        result: isObj(raw.result) ? raw.result : {},
        ts: isOptStr(raw.ts) ? raw.ts : null,
      };
    }
    case "demo.control": {
      if (!isStr(raw.action) || !DEMO_ACTIONS.has(raw.action)) return null;
      return {
        type: "demo.control",
        action: raw.action,
        scenario_id: isOptStr(raw.scenario_id) ? raw.scenario_id : null,
        ts: isOptStr(raw.ts) ? raw.ts : null,
      };
    }
    case "camera.online": {
      if (!isStr(raw.camera_id)) return null;
      if (!isBool(raw.online) && raw.online != null) return null;
      return {
        type: "camera.online",
        camera_id: raw.camera_id,
        online: raw.online !== false,
        ts: isOptStr(raw.ts) ? raw.ts : null,
      };
    }
    case "usage.tick": {
      // Per-window counts keyed by model id; non-numeric fields dropped.
      if (!isObj(raw.by_model)) return null;
      const FIELDS = ["requests", "tokens_in", "tokens_out", "audio_s", "chars", "frames", "live"];
      const by = {};
      for (const [id, row] of Object.entries(raw.by_model)) {
        if (!isStr(id) || !isObj(row)) continue;
        const clean = {};
        for (const f of FIELDS) if (isNum(row[f]) && row[f] >= 0) clean[f] = row[f];
        by[id] = clean;
      }
      return {
        type: "usage.tick",
        ts: isOptStr(raw.ts) ? raw.ts : null,
        window_s: isNum(raw.window_s) && raw.window_s > 0 ? raw.window_s : null,
        by_model: by,
      };
    }
    case "usage.total": {
      // All-time counts from the api history database (never reset).
      if (!isNum(raw.tokens) || raw.tokens < 0) return null;
      const out = { type: "usage.total", ts: isOptStr(raw.ts) ? raw.ts : null };
      for (const f of ["tokens", "tokens_in", "tokens_out", "requests", "frames", "audio_s", "chars"]) {
        out[f] = isNum(raw[f]) && raw[f] >= 0 ? raw[f] : 0;
      }
      return out;
    }
    case "activity.tick": {
      // Pipeline stages in order: what each is doing right now.
      if (!Array.isArray(raw.stages)) return null;
      const stages = [];
      for (const st of raw.stages) {
        if (!isObj(st) || !isStr(st.id) || !isStr(st.name)) continue;
        stages.push({
          id: st.id,
          name: st.name,
          role: isStr(st.role) ? st.role : "",
          unit: isStr(st.unit) ? st.unit : "",
          count: isNum(st.count) && st.count >= 0 ? st.count : 0,
          active: st.active === true,
          last_s: isOptNum(st.last_s) ? st.last_s : null,
        });
      }
      return { type: "activity.tick", ts: isOptStr(raw.ts) ? raw.ts : null, stages };
    }
    default:
      return null;
  }
}
