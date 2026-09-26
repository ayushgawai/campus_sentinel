/**
 * One camera status for every view: camera wall tiles, map pins, the site
 * plan list, the header count and the System page cards.
 *
 * Online when any of these holds:
 *   - the latest camera.online for it says online
 *   - an event carrying its camera_id arrived in the last 10 s
 *   - its video element presented a frame in the last 10 s
 *   - its MJPEG image has loaded a frame and has not errored or changed src
 *     since (an MJPEG stream fires load once, so it never times out)
 * Offline when camera.online says offline (and nothing arrived after it),
 * the MJPEG stream errored or was cleared, or none of the above for 10 s.
 * Before any data at all: Connecting.
 * An offline or connecting camera shows no incident level.
 */

import { isOpenIncident } from "./format.js?v=pro7";

const FRESH_MS = 10000;

/** Wall-clock ms of the latest activity per camera (events or frames). */
const seenAt = new Map();
/** Latest camera.online per camera: { online, at }. */
const reported = new Map();
/** MJPEG stream state per camera: { up, at }. */
const streamState = new Map();
const startedAt = Date.now();

function touch(cameraId, at) {
  if (!cameraId) return;
  if ((seenAt.get(cameraId) ?? 0) < at) seenAt.set(cameraId, at);
}

/**
 * Feed every transport event through here before the store. Incident
 * upserts are skipped: a reconnect replays old incidents, which says
 * nothing about the camera being up now.
 */
export function noteEvent(event) {
  const id = event?.camera_id;
  if (!id || typeof id !== "string") return;
  if (event.type === "incident.upsert") return;
  const at = Date.now();
  if (event.type === "camera.online") {
    reported.set(id, { online: Boolean(event.online), at });
    if (!event.online) return;
  }
  touch(id, at);
}

/** A tile's MJPEG image loaded, or its video advanced a frame. */
export function noteFrame(cameraId) {
  touch(cameraId, Date.now());
}

/**
 * MJPEG image state: up after a load with a real frame; down on error or
 * when its src is cleared or replaced.
 */
export function noteStream(cameraId, up) {
  if (!cameraId) return;
  const at = Date.now();
  streamState.set(cameraId, { up: Boolean(up), at });
  if (up) touch(cameraId, at);
}

/** First open MINOR/SEVERE incident on this camera, in queue order. */
export function activeIncidentForCamera(state, cameraId) {
  for (const id of state.order || []) {
    const inc = state.incidents?.[id];
    if (!inc || inc.camera_id !== cameraId) continue;
    if (!isOpenIncident(inc)) continue;
    if (inc.severity === "SEVERE" || inc.severity === "MINOR") return inc;
  }
  return null;
}

/** "online" | "offline" | "connecting", from the rules above. */
function linkState(cameraId, nowMs) {
  const rep = reported.get(cameraId);
  const seen = seenAt.get(cameraId);
  const fresh = seen != null && nowMs - seen <= FRESH_MS;
  const stream = streamState.get(cameraId);
  const streamUp = Boolean(stream?.up);
  if (rep && !rep.online) {
    const laterFrame = seen != null && seen > rep.at;
    const laterStream = streamUp && stream.at > rep.at;
    if (!laterFrame && !laterStream) return "offline";
  }
  if (streamUp || rep?.online || fresh) return "online";
  if (!rep && seen == null && nowMs - startedAt < FRESH_MS) return "connecting";
  return "offline";
}

/**
 * @returns {{ key: "online"|"offline"|"connecting"|"minor"|"severe",
 *   label: string, online: boolean, inc: object|null }}
 */
export function cameraStatus(state, cameraId, nowMs = Date.now()) {
  const link = linkState(cameraId, nowMs);
  if (link === "connecting") return { key: "connecting", label: "Connecting", online: false, inc: null };
  if (link === "offline") return { key: "offline", label: "Offline", online: false, inc: null };
  const inc = activeIncidentForCamera(state, cameraId);
  if (inc?.severity === "SEVERE") return { key: "severe", label: "Severe incident", online: true, inc };
  if (inc?.severity === "MINOR") return { key: "minor", label: "Minor incident", online: true, inc };
  return { key: "online", label: "Online", online: true, inc: null };
}

/** How many of `ids` are online, with the same rules. */
export function onlineCount(state, ids, nowMs = Date.now()) {
  let n = 0;
  for (const id of ids) if (cameraStatus(state, id, nowMs).online) n += 1;
  return n;
}
