/**
 * Followed incident and its camera path — shared by the Live tracking card,
 * the site map's tracked path, the thumbnail "Seen" chips and the expanded
 * map. Only store data: cameraPath (built from incident.upsert camera
 * changes) and cameraPathAt (the time of each of those upserts).
 */

import { compareHeroIncidents, isOpenIncident } from "./format.js?v=pro3";

/** Hops shown on the card, map and expand view (the rest is "+N earlier"). */
export const RECENT_HOPS = 5;

/**
 * The incident being followed: an open incident that has moved to another
 * camera (or is in TRACKING), best first by the Live hero order. The api
 * reports handoffs as incident.upsert camera changes and does not move the
 * incident to TRACKING, so a path of two or more cameras counts as tracking.
 */
export function followedIncident(state) {
  const list = [];
  for (const id of state.order || []) {
    const inc = state.incidents?.[id];
    if (!inc || !isOpenIncident(inc)) continue;
    if (inc.severity !== "SEVERE" && inc.severity !== "MINOR") continue;
    const path = state.cameraPath?.[id];
    const moved = Array.isArray(path) && path.length >= 2;
    if (moved || inc.state === "TRACKING") list.push(inc);
  }
  list.sort(compareHeroIncidents);
  return list[0] || null;
}

/**
 * The incident's path as hops: { cameraId, at } where `at` is the ISO time
 * the incident reached that camera, or null when the data has none.
 * `earlier` counts hops left out before the recent ones.
 */
export function pathHops(state, inc, max = RECENT_HOPS) {
  if (!inc) return { hops: [], earlier: 0 };
  const path = state.cameraPath?.[inc.incident_id];
  const at = state.cameraPathAt?.[inc.incident_id] || [];
  let hops = Array.isArray(path) && path.length
    ? path.map((cameraId, i) => ({ cameraId, at: at[i] || null }))
    : [];
  if (!hops.length && inc.camera_id) {
    hops = [{ cameraId: inc.camera_id, at: inc.created_at || inc.peak_ts || null }];
  }
  if (inc.camera_id && hops[hops.length - 1]?.cameraId !== inc.camera_id) {
    hops.push({ cameraId: inc.camera_id, at: null });
  }
  const earlier = Math.max(0, hops.length - max);
  return { hops: hops.slice(earlier), earlier };
}

/** Latest time each camera on the path was reached (for "Seen" chips). */
export function seenTimes(state, inc) {
  const out = new Map();
  if (!inc) return out;
  const { hops } = pathHops(state, inc, Infinity);
  for (const h of hops) out.set(h.cameraId, h.at);
  return out;
}

/** Seconds from the incident's first sighting to `iso`, or null. */
export function secondsSinceStart(inc, iso) {
  const start = Date.parse(inc?.created_at || inc?.peak_ts || "");
  const t = Date.parse(iso || "");
  if (Number.isNaN(start) || Number.isNaN(t)) return null;
  return Math.max(0, (t - start) / 1000);
}
