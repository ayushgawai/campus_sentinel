/**
 * Per-model readiness for the header card and the System page.
 * Core rows come from health.strip; voice rows from the api's
 * /voice/status (live only, on connect and every 5 s). A failed or missing
 * voice probe just leaves those rows Pending; nothing is shown as an error.
 */

import { MODELS } from "./models.js?v=pro7";

const VOICE_POLL_MS = 5000;
const VOICE_TIMEOUT_MS = 5000;

/** @typedef {"ready"|"warming"|"pending"} ModelStatus */

export const STATUS_LABEL = { ready: "Ready", warming: "Warming", pending: "Connecting" };
export const STATUS_DOT = { ready: "dot--ok", warming: "dot--warn", pending: "dot--off" };

/** null until the first /voice/status answer. */
let voice = null;
const listeners = new Set();

function voiceStatusUrl() {
  const raw = new URLSearchParams(location.search).get("ws");
  if (!raw) return null;
  try {
    const u = new URL(raw);
    u.protocol = u.protocol === "wss:" ? "https:" : "http:";
    return `${u.origin}/voice/status`;
  } catch {
    return null;
  }
}

async function probeVoice(url) {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), VOICE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: "no-store", signal: ctl.signal });
    if (!res.ok) return;
    const body = await res.json();
    if (!body || typeof body !== "object") return;
    const tts = body.tts && typeof body.tts === "object" ? body.tts : {};
    const provider = typeof tts.provider === "string" ? tts.provider.trim().toLowerCase() : "";
    const next = {
      asr: body.parakeet === true,
      tts: body.kokoro === true,
      phone: body.signalwire?.configured === true,
      // Active phone TTS as the api reports it ("elevenlabs" | "kokoro").
      provider: provider === "elevenlabs" || provider === "kokoro" ? provider : null,
      cloudTts: provider === "elevenlabs" && tts.elevenlabs_key === true,
      lastProvider: typeof tts.last_provider === "string" ? tts.last_provider : "",
      ttsError: typeof tts.last_error === "string" ? tts.last_error.trim() : "",
    };
    if (voice && ["asr", "tts", "phone", "provider", "cloudTts", "lastProvider", "ttsError"].every((k) => voice[k] === next[k])) {
      return;
    }
    voice = next;
    for (const fn of listeners) fn();
  } catch {
    // Unreachable or not JSON: keep the last answer (or Pending).
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * True when index.html's CSP connect-src lets fetch() reach `url`. A blocked
 * fetch logs a console error, so the probe is skipped instead.
 */
function cspAllows(url) {
  const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  if (!meta) return true;
  const directive = (meta.getAttribute("content") || "")
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .find((parts) => parts[0] === "connect-src");
  if (!directive) return true;
  const u = new URL(url);
  return directive.slice(1).some((src) => src === "*" || src === u.protocol || src === u.origin);
}

/**
 * Live only: probe /voice/status whenever the socket (re)connects and every
 * 5 s. In mock there is no api, so voice rows read Ready.
 */
export function startModelStatus(store) {
  const url = voiceStatusUrl();
  if (!url || !cspAllows(url)) return () => {};
  let lastConn = null;
  const unsub = store.subscribe((state) => {
    const conn = state.connection?.status ?? null;
    if (conn === lastConn) return;
    lastConn = conn;
    if (conn === "LIVE") probeVoice(url);
  });
  const timer = window.setInterval(() => probeVoice(url), VOICE_POLL_MS);
  probeVoice(url);
  return () => {
    unsub();
    window.clearInterval(timer);
  };
}

/** True when /voice/status says SignalWire will place a real phone call. */
export function phoneCallsLive() {
  return voice?.phone === true;
}

/** Test-only override of the TTS provider (null = use /voice/status). */
let providerOverride = null;
// Guarded: web/check.mjs imports this module under Node (no window).
if (typeof window !== "undefined") {
  window.__voiceTest = {
    setProvider(p) {
      providerOverride = p === "elevenlabs" || p === "kokoro" || p === "unknown" ? p : null;
      for (const fn of listeners) fn();
    },
  };
}

/**
 * Active phone TTS: "elevenlabs" | "kokoro" | null (unknown). Live reads
 * /voice/status tts.provider; mock has no api and uses on-device Kokoro.
 */
export function ttsProvider(state) {
  if (providerOverride) return providerOverride === "unknown" ? null : providerOverride;
  if (state?.connection?.status === "MOCK") return "kokoro";
  return voice?.provider ?? null;
}

/** One line on where the AI ran, by provider (models footer, usage card). */
export function whereItRanText(provider) {
  if (provider === "kokoro") return "Everything below ran on this device.";
  if (provider === "elevenlabs") {
    return "Vision and reasoning ran on this device. Phone voice uses ElevenLabs (cloud).";
  }
  return "Voice provider unknown";
}

/** Re-render hook for voice probe results (store notifies the rest). */
export function subscribeModelStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * @param {object} state store state
 * @returns {{ rows: Array<object>, overall: ModelStatus }}
 */
export function modelRows(state) {
  const h = state.health || {};
  const received = Boolean(h.received);
  const mock = state.connection?.status === "MOCK";

  /** @returns {ModelStatus} */
  const provider = ttsProvider(state);

  function statusOf(source) {
    if (source === "tts" && provider === "elevenlabs") {
      return voice?.cloudTts ? "ready" : "pending";
    }
    if (source === "asr" || source === "tts") {
      if (mock) return "ready";
      if (!voice) return "pending";
      return voice[source] ? "ready" : "pending";
    }
    if (!received) return "pending";
    if (source === "vision") return h.models_resident ? "ready" : "warming";
    if (source === "router") return h.p95_ms != null ? "ready" : "warming";
    return "pending";
  }

  const rows = MODELS.map((m) => {
    const status = statusOf(m.status);
    let metric = "";
    if (m.metric === "p95" && received && Number.isFinite(h.p95_ms)) {
      metric = `Step p95 ${Math.round(h.p95_ms)} ms`;
    }
    let row = { ...m, status, metric };
    // Phone TTS row follows the active provider (/voice/status).
    if (m.id === "tts" && provider === "elevenlabs") {
      row = { ...row, name: "ElevenLabs eleven_flash_v2_5", runtime: "Cloud" };
    }
    return row;
  });

  const core = rows.filter((r) => r.core);
  /** @type {ModelStatus} */
  let overall = "ready";
  if (core.some((r) => r.status === "pending")) overall = "pending";
  else if (core.some((r) => r.status !== "ready")) overall = "warming";
  return { rows, overall, provider };
}

/** Stable key so views rebuild only when something visible changed. */
export function modelsSignature({ rows, overall, provider }) {
  return `${overall}|${provider}|${rows.map((r) => `${r.id}:${r.status}:${r.metric}:${r.name}`).join("|")}`;
}

/**
 * Voice readiness for the live status table: { stt, tts, ttsError } from
 * /voice/status, or null before the first answer. Mock: both ready.
 * `tts` is the ACTIVE provider's readiness (ElevenLabs: key present).
 */
export function voiceReadiness(state) {
  if (state?.connection?.status === "MOCK") return { stt: true, tts: true, ttsError: "" };
  if (!voice) return null;
  const provider = ttsProvider(state);
  return {
    stt: voice.asr === true,
    tts: provider === "elevenlabs" ? voice.cloudTts === true : voice.tts === true,
    ttsError: voice.ttsError || "",
  };
}
