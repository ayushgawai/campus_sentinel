/** User actions — single place to wire REST / demo control later. */

import { atIso, operatorCallRows } from "./mock.js?v=pro3";
import { navigate } from "./router.js?v=pro3";
import * as cameraSources from "./cameraSources.js?v=pro3";
import { routes, API_TIMEOUT_MS } from "./config.js?v=pro3";
import { now, mockSecondsFromIso } from "./clock.js?v=pro3";
import { cameraLabel } from "./site.js?v=pro3";

export const DISMISS_REASONS = [
  { id: "false_alarm", label: "False alarm" },
  { id: "authorised", label: "Authorized activity" },
  { id: "other", label: "Other" },
];

/** Operator report types — contract class_token values only. */
export const REPORT_TYPES = [
  { token: "WEAPON", label: "Weapon" },
  { token: "FIGHT", label: "Fight" },
  { token: "THEFT", label: "Theft" },
  { token: "MEDICAL", label: "Medical / fall" },
  { token: "RUN", label: "Running" },
];

export const BROADCAST_AUDIENCES = [
  { id: "everyone", label: "Everyone" },
  { id: "students", label: "Students" },
  { id: "faculty_staff", label: "Faculty and staff" },
  { id: "security", label: "Security team" },
];

export const BROADCAST_MAX = 280;

export function broadcastPresets(cameraId) {
  return [
    "Shelter in place until further notice.",
    `Avoid the area near ${cameraLabel(cameraId)}. Security is responding.`,
    "Police are on scene. Follow staff instructions.",
    "All clear. Normal activity may resume.",
  ];
}

export function audienceText(ids) {
  return BROADCAST_AUDIENCES.filter((a) => ids.includes(a.id))
    .map((a) => a.label)
    .join(", ");
}

/** rules_fired marker the backend sets on manual incidents. */
export const OPERATOR_RULE = "operator_report";

export function isOperatorReported(inc) {
  if (!inc) return false;
  if (Array.isArray(inc.rules_fired) && inc.rules_fired.includes(OPERATOR_RULE)) {
    return true;
  }
  return (Array.isArray(inc.timeline) ? inc.timeline : []).some((ev) =>
    String(ev?.note || "").startsWith("Operator reported"),
  );
}

/** Call for help is replaced by a status from DISPATCH_PENDING onwards. */
const DISPATCHED_OR_LATER = new Set([
  "DISPATCH_PENDING",
  "DISPATCHED",
  "TRACKING",
  "RESOLVED",
  "DISMISSED",
]);

export function isDispatchedOrLater(inc) {
  return Boolean(inc && DISPATCHED_OR_LATER.has(inc.state));
}

export const OP_STATUS_EVENT = "sentinel:op-status";

/**
 * POST JSON with a timeout. `fallback` identifies unavailable legacy routes;
 * live actions still surface it as an error instead of claiming local success.
 */
async function postJson(url, body) {
  if (!url) return { ok: false, fallback: true };
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (res.ok) return { ok: true, data };
    // A JSON error on 404 is the api answering (e.g. incident not found).
    if ([404, 405, 501].includes(res.status) && !data?.error) {
      return { ok: false, fallback: true };
    }
    const reason = data?.error || data?.detail || data?.message || `HTTP ${res.status}`;
    return { ok: false, fallback: false, message: String(reason) };
  } catch {
    return { ok: false, fallback: true };
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * @param {{
 *   store: { handle: Function, getState: Function, setSelected: Function },
 *   getMode: () => string,
 *   transport?: object,
 * }} opts
 */
export function createActions({ store, getMode, transport }) {
  function nowIso() {
    const t = store.getState().demo?.t ?? 0;
    return atIso(t);
  }

  async function confirm(id) {
    if (getMode() === "WS") {
      const key = `confirm:${id}`;
      setOpStatus(key, { state: "pending" });
      const res = await postJson(routes.confirm(id), {});
      setOpStatus(
        key,
        res.ok ? null : { state: "declined", message: res.message || "Backend unavailable" },
      );
      return { ok: res.ok, message: res.message };
    }
    store.handle({
      type: "incident.state_change",
      incident_id: id,
      state: "RESOLVED",
      severity: null,
      ts: nowIso(),
      note: "Officer confirmed",
    });
  }

  async function dismiss(id, reason = "Officer dismissed") {
    if (getMode() === "WS") {
      const key = `dismiss:${id}`;
      setOpStatus(key, { state: "pending" });
      const res = await postJson(routes.dismiss(id), { reason });
      setOpStatus(
        key,
        res.ok ? null : { state: "declined", message: res.message || "Backend unavailable" },
      );
      return { ok: res.ok, message: res.message };
    }
    store.handle({
      type: "incident.state_change",
      incident_id: id,
      state: "DISMISSED",
      severity: null,
      ts: nowIso(),
      note: reason,
    });
  }

  function select(id) {
    store.setSelected(id);
  }

  function clearSelection() {
    store.setSelected(null);
  }

  function viewIncident(id) {
    store.setSelected(id);
    navigate("live");
  }

  // ---------- Operator actions (Fix 5) ----------

  /** "kind:id" → { state: "pending"|"unconfirmed"|"declined", message? } */
  const opStatus = new Map();

  function setOpStatus(key, value) {
    if (value) opStatus.set(key, value);
    else opStatus.delete(key);
    document.dispatchEvent(new CustomEvent(OP_STATUS_EVENT, { detail: { key } }));
  }

  /** @param {"report"|"dispatch"|"broadcast"} kind */
  function getOpStatus(kind, id) {
    return opStatus.get(`${kind}:${id}`) || null;
  }

  /** Api guardrail reasons from demo.control "dispatch_blocked:<reason>". */
  const BLOCKED_REASONS = {
    voice_busy: "a voice call is already active",
    already_dispatched: "incident was already dispatched",
    kill_switch: "calling is disabled by the kill switch",
    hourly_cap: "hourly dispatch limit reached",
  };

  // An automatic (vision) dispatch the api refused has no REST response, so
  // show it on that incident's Call for help like a declined operator call.
  let lastBlocked = null;
  store.subscribe?.((state) => {
    const blocked = state.call?.blocked;
    if (!blocked || blocked === lastBlocked) return;
    lastBlocked = blocked;
    const key = `dispatch:${blocked.incidentId}`;
    if (opStatus.get(key)?.state === "pending") return;
    setOpStatus(key, {
      state: "declined",
      message: BLOCKED_REASONS[blocked.reason] || blocked.reason || "dispatch was blocked",
    });
  });

  const isLive = () => getMode() === "WS";
  const stampIso = () => new Date(now()).toISOString();

  /** Through the transport's validator into the normal store handler. */
  function inject(event) {
    if (transport?.inject) transport.inject(event);
    else store.handle(event);
  }

  /** Append a timeline note without changing state (upsert, longer timeline). */
  function appendNote(id, note) {
    const inc = store.getState().incidents[id];
    if (!inc) return;
    const ts = stampIso();
    const timeline = Array.isArray(inc.timeline) ? inc.timeline.slice() : [];
    timeline.push({ ts, state: inc.state, note });
    inject({ type: "incident.upsert", incident: { ...inc, timeline, updated_at: ts } });
  }

  function localReport({ cameraId, classToken, severity, note }, idPrefix, tlNote) {
    const ts = stampIso();
    const id = `${idPrefix}-${Date.now().toString(36)}`;
    inject({
      type: "incident.upsert",
      incident: {
        schema_version: "1.1",
        incident_id: id,
        track_id: "operator",
        camera_id: cameraId,
        peak_ts: ts,
        class_token: classToken,
        class_logprob_calibrated: null,
        router_score: null,
        fused_prob: null,
        severity,
        description: note || "Reported by operator.",
        location_text: cameraLabel(cameraId),
        person_description: "",
        rules_fired: [OPERATOR_RULE],
        clip_uri: "",
        created_at: ts,
        updated_at: ts,
        state: "ALERTED",
        timeline: [{ ts, state: "ALERTED", note: tlNote }],
        dismissed_reason: null,
      },
    });
    return id;
  }

  /**
   * Report an incident the cameras missed.
   * @returns {Promise<{ ok: boolean, id?: string, unconfirmed?: boolean, message?: string }>}
   */
  async function reportIncident({ cameraId, classToken, severity, note = "" }) {
    const key = `report:${cameraId}`;
    if (opStatus.get(key)?.state === "pending") return { ok: false, pending: true };
    const input = { cameraId, classToken, severity, note: note.trim() };

    if (!isLive()) {
      const id = localReport(input, "op", "Operator reported incident");
      store.setSelected(id);
      return { ok: true, id };
    }

    setOpStatus(key, { state: "pending" });
    const res = await postJson(routes.manualIncident(), {
      camera_id: cameraId,
      class_token: classToken,
      severity,
      note: input.note,
    });
    setOpStatus(key, null);
    if (res.ok) {
      const rec = res.data?.incident_id ? res.data : res.data?.incident;
      if (rec?.incident_id) {
        inject({ type: "incident.upsert", incident: rec });
        store.setSelected(rec.incident_id);
      }
      return { ok: true, id: rec?.incident_id };
    }
    return { ok: false, message: res.message || "Backend unavailable" };
  }

  /**
   * Manual dispatch ("Call for help"). The backend escalates Minor to Severe
   * and runs its guardrails. Mock plays the scripted call for this incident.
   */
  async function callForHelp(id) {
    const key = `dispatch:${id}`;
    const inc = store.getState().incidents[id];
    if (!inc || isDispatchedOrLater(inc)) return { ok: false };
    if (opStatus.get(key)?.state === "pending") return { ok: false, pending: true };
    const escalate = inc.severity !== "SEVERE";

    if (!isLive()) {
      inject({
        type: "incident.state_change",
        incident_id: id,
        state: "DISPATCH_PENDING",
        severity: "SEVERE",
        ts: stampIso(),
        note: escalate
          ? "Operator requested dispatch · escalated to severe"
          : "Operator requested dispatch",
      });
      const t = transport?.getTime?.() ?? 0;
      transport?.operatorDispatch?.(
        id,
        operatorCallRows({
          id,
          cameraId: inc.camera_id,
          person: inc.person_description || "",
          peakAt: mockSecondsFromIso(inc.peak_ts || inc.created_at),
          at: t + 2,
        }),
      );
      setOpStatus(key, null);
      return { ok: true };
    }

    setOpStatus(key, { state: "pending" });
    const res = await postJson(routes.dispatch(id), {
      requested_by: "operator",
      reason: "Operator call for help",
    });
    if (res.ok) {
      setOpStatus(key, null);
      return { ok: true };
    }
    const message = res.message || "Backend unavailable";
    setOpStatus(key, { state: "declined", message });
    return { ok: false, message };
  }

  /** Warn people on site. Timeline entry shows audience and message. */
  async function broadcast({ incidentId = null, audience, message }) {
    const key = `broadcast:${incidentId || "site"}`;
    if (opStatus.get(key)?.state === "pending") return { ok: false, pending: true };
    const text = String(message || "").trim();
    if (!text || !audience?.length) return { ok: false };
    const note = `Broadcast to ${audienceText(audience)}: ${text}`;

    if (!isLive()) {
      if (incidentId) appendNote(incidentId, note);
      setOpStatus(key, null);
      return { ok: true };
    }

    setOpStatus(key, { state: "pending" });
    const res = await postJson(routes.broadcast(), {
      ...(incidentId ? { incident_id: incidentId } : {}),
      audience,
      message: text,
    });
    if (res.ok) {
      setOpStatus(key, null);
      return { ok: true };
    }
    const reason = res.message || "Backend unavailable";
    setOpStatus(key, { state: "declined", message: reason });
    return { ok: false, message: reason };
  }

  function demoReset() {
    for (const key of [...opStatus.keys()]) setOpStatus(key, null);
    transport?.resetDemo?.();
    cameraSources.restartAll();
  }

  function demoScenario(id) {
    transport?.setScenario?.(id);
    cameraSources.restartAll();
  }

  function demoPrewarm() {
    transport?.prewarm?.();
  }

  function demoPlay() {
    transport?.play?.();
    cameraSources.playAll();
  }

  function demoPause() {
    transport?.pause?.();
    cameraSources.pauseAll();
  }

  function demoSpeed(s) {
    transport?.setSpeed?.(s);
    cameraSources.setPlaybackRate(s);
  }

  function demoSeek(t) {
    transport?.seek?.(t);
    cameraSources.seekAllToDemoT(t);
  }

  return {
    confirm,
    dismiss,
    select,
    clearSelection,
    viewIncident,
    demoReset,
    demoScenario,
    demoPrewarm,
    demoPlay,
    demoPause,
    demoSpeed,
    demoSeek,
    reportIncident,
    callForHelp,
    broadcast,
    getOpStatus,
  };
}
