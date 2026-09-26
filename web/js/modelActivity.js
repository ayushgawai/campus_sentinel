/**
 * Real-time model status for the System "AI models" table, from real
 * events only (health.strip, usage.tick, incident upserts, transcript
 * deltas, /voice/status). Nothing is estimated.
 *
 * Status per model:
 *   active   did work in the last 10 s
 *   idle     loaded / ready, no work in the last 10 s
 *   offline  not ready / not resident / no health for 15 s
 *   error    an error was reported (TTS last_error)
 *   connecting  no health.strip / voice status has arrived yet
 * When usage.tick is flowing it is preferred for every model it covers.
 */

import { now } from "./clock.js?v=pro4";
import { ttsProvider, voiceReadiness } from "./modelStatus.js?v=pro4";

const ACTIVE_MS = 10000;
const HEALTH_STALE_MS = 15000;

export const QWEN_ID = "hf:Qwen/Qwen3-VL-30B-A3B-Instruct-FP8";
const TTS_IDS = { elevenlabs: "eleven_flash_v2_5", kokoro: "kokoro-82m" };

/** Per model: last evidence time (ms) and the latest per-minute metrics. */
const act = {
  router: { at: null },
  qwen: { at: null, reqPerMin: null, tokPerMin: null },
  stt: { at: null, audioPerMin: null },
  tts: { at: null, charsPerMin: null },
};
let health = { recvMs: null, ts: null, screened: null, escalated: null, framesPerMin: null, p95: null, resident: null };
let tickSeen = false;
let lastSeq = 0;
let incSig = null; // incident_id → "class|description|person"
let lines = { sentinel: null, dispatcher: null };
/** Events replayed on (re)connect are history, not new work. */
const SETTLE_MS = 5000;
let settleUntil = 0;

function mark(key, ms) {
  if (ms < settleUntil) return;
  if (!act[key].at || ms > act[key].at) act[key].at = ms;
}

function onHealth(h, wall) {
  if (!h?.received || h.ts === health.ts) return;
  const prev = health;
  const t = Date.parse(h.ts || "") || wall;
  const next = {
    recvMs: wall,
    ts: h.ts,
    t,
    screened: h.frames_screened,
    escalated: h.frames_escalated,
    p95: Number.isFinite(h.p95_ms) ? h.p95_ms : null,
    resident: Boolean(h.models_resident),
    framesPerMin: prev.framesPerMin,
  };
  if (prev.screened != null && Number.isFinite(h.frames_screened)) {
    const d = h.frames_screened - prev.screened;
    const dt = (t - (prev.t || t)) / 1000;
    if (d > 0) {
      mark("router", wall);
      if (dt > 0) next.framesPerMin = Math.round((d / dt) * 60);
    } else if (d === 0) {
      next.framesPerMin = 0;
    }
  }
  if (!tickSeen && prev.escalated != null && h.frames_escalated > prev.escalated) mark("qwen", wall);
  health = next;
}

function onTick(ev, wall) {
  const by = ev.by_model || {};
  const w = ev.window_s || 10;
  const perMin = (v) => (Number.isFinite(v) ? Math.round((v / w) * 60 * 10) / 10 : null);
  tickSeen = true;
  const q = by[QWEN_ID];
  if (q) {
    if ((q.requests || 0) > 0) mark("qwen", wall);
    act.qwen.reqPerMin = perMin(q.requests || 0);
    act.qwen.tokPerMin = perMin((q.tokens_in || 0) + (q.tokens_out || 0));
  } else {
    act.qwen.reqPerMin = 0;
    act.qwen.tokPerMin = 0;
  }
  const y = by["yolo26s-pose"];
  if (y && (y.frames || 0) > 0) mark("router", wall);
  const s = by["faster-whisper-base.en"];
  if (s && (s.audio_s || 0) > 0) mark("stt", wall);
  act.stt.audioPerMin = perMin(s?.audio_s || 0);
  let chars = 0;
  for (const id of Object.values(TTS_IDS)) chars += by[id]?.chars || 0;
  if (chars > 0) mark("tts", wall);
  act.tts.charsPerMin = perMin(chars);
}

function onIncidents(state, wall) {
  const next = {};
  for (const id of state.order || []) {
    const inc = state.incidents?.[id];
    if (!inc) continue;
    next[id] = `${inc.class_token}|${inc.description || ""}|${inc.person_description || ""}`;
  }
  // First snapshot is a baseline (replayed history is not new work).
  if (incSig && !tickSeen) {
    for (const [id, sig] of Object.entries(next)) {
      if (incSig[id] !== sig) {
        mark("qwen", wall);
        break;
      }
    }
  }
  incSig = next;
}

function onTranscript(state, wall) {
  const t = state.call?.transcript || [];
  let s = 0;
  let d = 0;
  for (const u of t) {
    const len = String(u.text || "").length;
    if (u.speaker === "dispatcher") d += len + 1;
    else s += len + 1;
  }
  if (lines.sentinel != null && !tickSeen) {
    if (d > lines.dispatcher) mark("stt", wall);
    if (s > lines.sentinel) mark("tts", wall);
  }
  lines = { sentinel: s, dispatcher: d };
}

export function startModelActivity(store) {
  let lastInc = null;
  let lastTranscript = null;
  let lastConn = null;
  function onState(state) {
    const wall = now();
    const conn = state.connection?.status || null;
    if (conn !== lastConn) {
      lastConn = conn;
      settleUntil = wall + SETTLE_MS;
    }
    onHealth(state.health, wall);
    const q = state.usageTicks;
    if (q && q.seq !== lastSeq) {
      if (q.seq < lastSeq) lastSeq = 0;
      for (const it of q.items) if (it.seq > lastSeq) onTick(it.event, wall);
      lastSeq = q.seq;
    }
    if (state.incidents !== lastInc) {
      lastInc = state.incidents;
      onIncidents(state, wall);
    }
    const tr = state.call?.transcript;
    if (tr !== lastTranscript) {
      lastTranscript = tr;
      onTranscript(state, wall);
    }
  }
  const unsub = store.subscribe(onState);
  onState(store.getState());
  return unsub;
}

function statusFrom(atMs, ready, nowMs, error = false, connecting = false) {
  if (error) return "error";
  if (connecting) return "connecting";
  if (!ready) return "offline";
  return atMs != null && nowMs - atMs <= ACTIVE_MS ? "active" : "idle";
}

const fmtRate = (v, unit) => (Number.isFinite(v) ? `${v.toLocaleString("en-US")} ${unit}` : "");

/**
 * Rows for the live table. `metric` is only real values ("" otherwise).
 * @returns {{ rows: object[], active: number, ready: number }}
 */
export function liveModelRows(state, nowMs = now()) {
  const healthUp = health.recvMs != null && nowMs - health.recvMs <= HEALTH_STALE_MS;
  const voice = voiceReadiness(state);
  const provider = ttsProvider(state);
  // No health.strip / voice answer yet: "Connecting", never Offline.
  const noHealth = health.recvMs == null;
  const noVoice = voice == null;

  const rows = [];
  const detMetric = [
    healthUp && health.p95 != null ? `p95 ${Math.round(health.p95)} ms` : "",
    healthUp && Number.isFinite(health.framesPerMin) ? fmtRate(health.framesPerMin, "frames/min") : "",
  ]
    .filter(Boolean)
    .join(" · ");
  rows.push({
    id: "vision",
    role: "Vision",
    name: "Qwen3-VL-30B-A3B (FP8)",
    runtime: "HP Z Runtime",
    status: statusFrom(act.qwen.at, health.resident === true, nowMs, false, noHealth),
    at: act.qwen.at,
    metric: tickSeen
      ? [fmtRate(act.qwen.reqPerMin, "req/min"), fmtRate(act.qwen.tokPerMin, "tokens/min")].filter(Boolean).join(" · ")
      : "",
  });
  rows.push({
    id: "detection",
    role: "Detection",
    name: "YOLO26s-pose + ByteTrack",
    runtime: "On device",
    status: statusFrom(act.router.at, healthUp, nowMs, false, noHealth),
    at: act.router.at,
    metric: detMetric,
  });
  rows.push({
    id: "anomaly",
    role: "Anomaly",
    name: "CLIP ViT-B/16",
    runtime: "On device",
    status: statusFrom(act.router.at, healthUp, nowMs, false, noHealth),
    at: act.router.at,
    metric: "",
  });
  rows.push({
    id: "asr",
    role: "Speech to text",
    name: "Whisper base.en",
    runtime: "On device",
    status: statusFrom(act.stt.at, voice?.stt === true, nowMs, false, noVoice),
    at: act.stt.at,
    metric: tickSeen ? fmtRate(act.stt.audioPerMin, "audio s/min") : "",
  });
  rows.push({
    id: "tts",
    role: "Text to speech",
    name: provider === "elevenlabs" ? "ElevenLabs eleven_flash_v2_5" : provider === "kokoro" ? "Kokoro-82M" : "Provider unknown",
    runtime: provider === "elevenlabs" ? "Cloud" : provider === "kokoro" ? "On device" : "",
    status: statusFrom(act.tts.at, provider != null && voice?.tts === true, nowMs, Boolean(voice?.ttsError), noVoice),
    at: act.tts.at,
    metric: tickSeen ? fmtRate(act.tts.charsPerMin, "chars/min") : "",
  });
  const active = rows.filter((r) => r.status === "active").length;
  const ready = rows.filter((r) => r.status === "active" || r.status === "idle").length;
  return { rows, active, ready };
}
