/**
 * Site configuration — single source of truth for cameras and place redaction.
 * Swap this file (or its exports) for a different deployment.
 */

export const SITE = {
  name: "Primary site",
  type: "Facility",
  timezone: "America/Los_Angeles",
};

/**
 * Exactly six cameras in a 3×2 layout (viewBox 1000×620).
 * Ids and coordinates only — no place fields.
 */
export const CAMERAS = [
  { id: "cam-01", n: 1, x: 220, y: 170, heading: 135 },
  { id: "cam-02", n: 2, x: 500, y: 150, heading: 180 },
  { id: "cam-03", n: 3, x: 780, y: 170, heading: 225 },
  { id: "cam-04", n: 4, x: 220, y: 420, heading: 90 },
  { id: "cam-05", n: 5, x: 500, y: 440, heading: 0 },
  { id: "cam-06", n: 6, x: 780, y: 420, heading: 270 },
];

/** Undirected walk links for site-plan paths and mock pursuit. */
export const ADJACENCY = [
  ["cam-01", "cam-02"],
  ["cam-02", "cam-03"],
  ["cam-01", "cam-04"],
  ["cam-02", "cam-05"],
  ["cam-03", "cam-06"],
  ["cam-04", "cam-05"],
  ["cam-05", "cam-06"],
];

export const WALL_CAMERA_IDS = CAMERAS.map((c) => c.id);

/**
 * Old place names from earlier UI versions — redaction safety net only.
 * Grep denylist lives here; nowhere else in web/ should contain these words.
 */
export const DENYLIST = [
  "Library Plaza",
  "Library",
  "North Entrance",
  "Main Quad",
  "West Courtyard",
  "Parking Structure 3",
  "Loading Dock",
  "Residence Lane",
  "Event Hall",
  "Athletics Wing",
  "North Lot",
  "Arts Court",
  "Fountain Circle",
  "Garage 3",
  "Garage",
  "Parking",
  "Courtyard",
  "Residence",
  "Athletics",
  "Arts",
  "Entrance",
  "Quad",
  "Dock",
  "Plaza",
  "Hall",
  "Building",
  "Street",
  "North",
  "South",
  "East",
  "West",
  "Campus",
  "SJSU",
  "Union",
  "Engineering",
  "south entrance plaza",
  "east exit lane",
  "north approach",
  "east walk",
  "main quad walkway",
  "south garage entrance",
];

const byId = new Map(CAMERAS.map((c) => [c.id, c]));
const warnedUnknown = new Set();

const adjMap = (() => {
  const m = new Map();
  for (const id of WALL_CAMERA_IDS) m.set(id, new Set());
  for (const [a, b] of ADJACENCY) {
    m.get(a)?.add(b);
    m.get(b)?.add(a);
  }
  return m;
})();

export function getCamera(id) {
  return byId.get(id) || null;
}

export function isConfiguredCamera(id) {
  return byId.has(id);
}

export function adjacentCameras(id) {
  return [...(adjMap.get(id) || [])];
}

/**
 * ONE formatter used everywhere → "Camera 5" (no leading zero).
 * Unknown ids still render as Camera N and warn once.
 */
export function cameraLabel(cameraId) {
  if (cameraId == null || cameraId === "") return "Camera";
  const id = String(cameraId);
  const known = byId.get(id);
  if (known) return `Camera ${known.n}`;
  const m = id.match(/(\d+)/);
  const n = m ? String(Number(m[1])) : "?";
  if (!warnedUnknown.has(id)) {
    warnedUnknown.add(id);
    console.warn("[site] cameraLabel: unknown camera id", id);
  }
  return `Camera ${n}`;
}

/** @deprecated Use cameraLabel — kept as alias for any residual imports. */
export function cameraName(id) {
  return cameraLabel(id);
}

/**
 * Replace configured camera ids and DENYLIST place strings in free text.
 * Safety net for live WebSocket text; mock must not rely on it.
 */
export function redactPlaces(text) {
  if (text == null) return "";
  let out = String(text);
  // Longer denylist phrases first
  const phrases = [...DENYLIST].sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    if (!phrase) continue;
    const re = new RegExp(escapeRegExp(phrase), "gi");
    out = out.replace(re, (match, offset, full) => {
      // Prefer a nearby camera id if present in the same string.
      const window = full.slice(Math.max(0, offset - 40), offset + match.length + 40);
      const near = window.match(/cam[-_]0?([1-6])\b/i);
      if (near) return cameraLabel(`cam-0${near[1]}`);
      return "the camera area";
    });
  }
  // Raw camera ids → Camera N
  out = out.replace(/\bcam[-_]0*(\d+)\b/gi, (_, digits) => {
    const n = Number(digits);
    const id = `cam-${String(n).padStart(2, "0")}`;
    return cameraLabel(id);
  });
  return out;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Adapter for data/camera_map.json once filled.
 * Keeps id, n, x, y, heading only.
 */
export function fromCameraMap(json) {
  const list = Array.isArray(json?.cameras) ? json.cameras : [];
  return list.slice(0, 6).map((c, i) => {
    const n = Number(c.n ?? i + 1);
    const id =
      c.id ??
      c.camera_id ??
      `cam_${String(n).padStart(2, "0")}`;
    let x = c.x;
    let y = c.y;
    if ((x == null || y == null) && Array.isArray(c.coordinates)) {
      x = c.coordinates[0];
      y = c.coordinates[1];
    }
    if ((x == null || y == null) && Array.isArray(c.map_xy)) {
      x = c.map_xy[0];
      y = c.map_xy[1];
    }
    return {
      id: String(id),
      n,
      x: Number(x) || 0,
      y: Number(y) || 0,
      heading: typeof c.heading === "number" ? c.heading : 180,
    };
  });
}
