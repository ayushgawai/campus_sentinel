/**
 * Per-model readiness for the header card and the System page.
 * Core rows come from health.strip; voice rows from the api's
 * /voice/status (live only, on connect and every 30 s). A failed or missing
 * voice probe just leaves those rows Pending; nothing is shown as an error.
 */

import { MODELS } from "./models.js?v=live2";

const VOICE_POLL_MS = 30000;
const VOICE_TIMEOUT_MS = 5000;

/** @typedef {"ready"|"warming"|"pending"} ModelStatus */

export const STATUS_LABEL = { ready: "Ready", warming: "Warming", pending: "Pending" };
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
    const next = {
      asr: body.parakeet === true,
      tts: body.kokoro === true,
      phone: body.signalwire?.configured === true,
    };
    if (voice && voice.asr === next.asr && voice.tts === next.tts && voice.phone === next.phone) {
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
 * 30 s. In mock there is no api, so voice rows read Ready.
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
  function statusOf(source) {
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
    return { ...m, status, metric };
  });

  const core = rows.filter((r) => r.core);
  /** @type {ModelStatus} */
  let overall = "ready";
  if (core.some((r) => r.status === "pending")) overall = "pending";
  else if (core.some((r) => r.status !== "ready")) overall = "warming";
  return { rows, overall };
}

/** Stable key so views rebuild only when something visible changed. */
export function modelsSignature({ rows, overall }) {
  return `${overall}|${rows.map((r) => `${r.id}:${r.status}:${r.metric}`).join("|")}`;
}
