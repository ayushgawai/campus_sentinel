/**
 * Call history for security review — saved ONLY in this browser
 * (IndexedDB). The api keeps no past calls: it only replays its last
 * events to a new connection. Each call is saved continuously while it
 * runs (a reload loses nothing) and the text is masked before it is stored
 * (camera places redacted, phone-like digit runs hidden). Last 50 calls.
 */

import { redactPlaces, cameraLabel, cameraPlace } from "./site.js?v=pro4";
import { now } from "./clock.js?v=pro4";
import {
  buildThread,
  callDescription,
  callElapsedMs,
  callNoteText,
  dispatchedTs,
  ENDED_CALL_STATES,
  findCallIncident,
  maskPhones,
} from "./ui/call.js?v=pro4";

const DB_NAME = "sentinel-call-history";
const DB_VERSION = 1;
const STORE = "calls";
export const KEEP_CALLS = 50;
const SAVE_DELAY_MS = 700;

const listeners = new Set();
let dbPromise = null;
let unavailable = false;

function notify() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

/** Re-render hook: called after each save or clear. */
export function subscribeHistory(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function historyUnavailable() {
  return unavailable;
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  }).catch((err) => {
    unavailable = true;
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        const out = fn(store);
        t.oncomplete = () => resolve(out?.result ?? out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

/** All saved calls, newest first. */
export async function listCalls() {
  try {
    const all = await tx("readonly", (s) => s.getAll());
    return (Array.isArray(all) ? all : []).sort((a, b) => (b.startedMs || 0) - (a.startedMs || 0));
  } catch {
    return [];
  }
}

export async function clearCalls() {
  try {
    await tx("readwrite", (s) => s.clear());
  } catch {
    /* ignore */
  }
  notify();
}

async function putCall(rec) {
  await tx("readwrite", (s) => s.put(rec));
  // Keep the newest KEEP_CALLS.
  const all = await listCalls();
  const extra = all.slice(KEEP_CALLS);
  if (extra.length) await tx("readwrite", (s) => extra.forEach((r) => s.delete(r.id)));
}

const clean = (text) => maskPhones(redactPlaces(text == null ? "" : String(text)));

/** The call label shown on every call surface. */
function labelFor(state) {
  return callNoteText(state);
}

/** The record for the current call, from store data only. */
function recordFor(state, inc) {
  const startIso = dispatchedTs(inc, state) || inc.created_at || inc.peak_ts || null;
  const startedMs = Date.parse(startIso || "") || 0;
  const lines = (state.call?.transcript || []).filter(
    (t) => !state.call.incidentId || t.incident_id === inc.incident_id,
  );
  const tools = (state.call?.tools || []).filter(
    (t) => !state.call.incidentId || t.incident_id === inc.incident_id,
  );
  const ended = ENDED_CALL_STATES.has(inc.state);
  let endedIso = null;
  if (ended) {
    for (const ev of inc.timeline || []) if (ENDED_CALL_STATES.has(ev.state) && ev.ts) endedIso = ev.ts;
    endedIso = endedIso || inc.updated_at || null;
  }
  return {
    id: `${inc.incident_id}@${startIso || "?"}`,
    incidentId: inc.incident_id,
    classToken: inc.class_token || null,
    severity: inc.severity || null,
    cameraId: inc.camera_id || null,
    camera: cameraLabel(inc.camera_id),
    description: callDescription(inc, state),
    place: cameraPlace(inc.camera_id),
    startedAt: startIso,
    startedMs,
    endedAt: endedIso,
    durationMs: callElapsedMs(inc, state, now()) ?? 0,
    label: labelFor(state),
    lines: buildThread(lines).map((u) => ({ speaker: u.speaker, ts: u.ts, text: clean(u.text) })),
    tools: tools.map((t) => ({ tool: String(t.tool || ""), ts: t.ts || null })),
    savedAt: new Date(now()).toISOString(),
  };
}

/**
 * Save the active call as it changes (debounced), and once more when it
 * ends. Runs on every route.
 */
export function startCallRecorder(store) {
  let lastSig = "";
  let timer = 0;
  let pending = null;

  function flush() {
    timer = 0;
    const rec = pending;
    pending = null;
    if (!rec) return;
    putCall(rec).then(notify, () => {
      unavailable = true;
      notify();
    });
  }

  function onState(state) {
    const inc = findCallIncident(state);
    if (!inc) return;
    const lines = state.call?.transcript || [];
    const last = lines[lines.length - 1];
    const sig = [
      inc.incident_id,
      inc.state,
      inc.camera_id,
      lines.length,
      last ? String(last.text || "").length : 0,
      (state.call?.tools || []).length,
    ].join("|");
    if (sig === lastSig) return;
    lastSig = sig;
    pending = recordFor(state, inc);
    // An ended call is written at once; a running one after a short pause.
    if (ENDED_CALL_STATES.has(inc.state)) {
      window.clearTimeout(timer);
      flush();
    } else if (!timer) {
      timer = window.setTimeout(flush, SAVE_DELAY_MS);
    }
  }

  const unsub = store.subscribe(onState);
  onState(store.getState());
  window.addEventListener("pagehide", flush);
  return () => {
    unsub();
    window.removeEventListener("pagehide", flush);
  };
}
