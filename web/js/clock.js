/**
 * Single shared clock for the whole app: one now() and one ticker.
 *
 * Live: now() = Date.now() + a smoothed offset learned from backend event
 * timestamps (outlier jumps over 5 minutes are ignored).
 * Mock: now() = a runtime epoch (set to wall time at mock start and on
 * every reset) plus the player's simulated seconds — so it tracks real
 * time, keeps advancing after the script ends, freezes on pause and runs
 * fast under 2x/4x, exactly like the player itself.
 *
 * The ticker fires once per second, aligned to the real-second boundary,
 * and again immediately whenever the tab becomes visible.
 */

const MAX_OFFSET_JUMP_MS = 5 * 60 * 1000;
const OFFSET_SMOOTHING = 0.2;

let mode = "MOCK";
let serverOffsetMs = 0;
let hasOffsetSample = false;

let mockEpochMs = Date.now();
let mockT = 0;

export function setMode(nextMode) {
  mode = nextMode === "LIVE" ? "LIVE" : "MOCK";
  if (mode === "LIVE") {
    serverOffsetMs = 0;
    hasOffsetSample = false;
  }
}

/** Feed a backend event's ISO timestamp to refine the live offset. */
export function sampleServerTime(tsIso) {
  if (mode !== "LIVE" || !tsIso) return;
  const serverMs = Date.parse(tsIso);
  if (Number.isNaN(serverMs)) return;
  const sample = serverMs - Date.now();
  if (hasOffsetSample && Math.abs(sample - serverOffsetMs) > MAX_OFFSET_JUMP_MS) {
    return; // outlier — ignore rather than snap the clock
  }
  serverOffsetMs = hasOffsetSample
    ? serverOffsetMs + (sample - serverOffsetMs) * OFFSET_SMOOTHING
    : sample;
  hasOffsetSample = true;
}

/** Rebase the mock timeline onto the current wall clock (start / reset). */
export function setMockEpoch(epochMs = Date.now()) {
  mockEpochMs = epochMs;
}

export function getMockEpoch() {
  return mockEpochMs;
}

/** Latest simulated-seconds value reported by the mock player's onTick. */
export function setMockT(seconds) {
  mockT = seconds;
}

/** Current app time, in ms — the only "now" the UI should use. */
export function now() {
  return mode === "LIVE" ? Date.now() + serverOffsetMs : mockEpochMs + mockT * 1000;
}

/** Mock-only: convert simulated seconds to an ISO string on the runtime epoch. */
export function mockIso(seconds) {
  return new Date(mockEpochMs + Math.round(seconds * 1000)).toISOString();
}

/** Mock-only: invert an ISO string produced by mockIso back to seconds. */
export function mockSecondsFromIso(iso) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, (ms - mockEpochMs) / 1000);
}

const tickListeners = new Set();
let tickTimer = null;

function fireTick() {
  const t = now();
  for (const fn of tickListeners) {
    try {
      fn(t);
    } catch (err) {
      console.error("[clock] tick listener error", err);
    }
  }
}

function scheduleAligned() {
  const delay = 1000 - (Date.now() % 1000);
  tickTimer = window.setTimeout(() => {
    fireTick();
    tickTimer = window.setInterval(fireTick, 1000);
  }, delay);
}

if (typeof window !== "undefined") {
  scheduleAligned();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) fireTick();
  });
}

/** Subscribe to the once-per-second tick. Returns an unsubscribe function. */
export function subscribeTick(fn) {
  tickListeners.add(fn);
  return () => tickListeners.delete(fn);
}
