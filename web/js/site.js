/**
 * Site configuration — browser copy of data/camera_map.json.
 * Swap this file (or its exports) for a different deployment.
 */

export const SITE = {
  name: "San Jose State University",
  type: "University campus",
  address: "One Washington Square, San Jose, CA 95192",
  timezone: "America/Los_Angeles",
  /**
   * Site map. "image": the OpenStreetMap export below with cameras at
   * their image pixel positions. "plan": the schematic 3x2 plan.
   * ?map=plan or ?map=image overrides it for one load.
   */
  map: {
    type: "image",
    src: "./assets/site-map.png",
    width: 780,
    height: 553,
    attribution: "© OpenStreetMap contributors",
    note: "Camera placement for illustration",
  },
};

/**
 * Exactly six cameras. Numbers and links follow data/camera_map.json.
 * `x`, `y`, `heading` are pixels / degrees (0 = up) on SITE.map's image;
 * `plan` holds the schematic plan position (viewBox 1000x620).
 * Fine tune with ?mapedit=1.
 */
export const CAMERAS = [
  { id: "cam-01", n: 1, name: "MacQuarrie Hall · Ground-floor lobby", x: 468, y: 393, heading: 150, plan: { x: 220, y: 170, heading: 135 } },
  { id: "cam-02", n: 2, name: "MacQuarrie Hall · East corridor", x: 495, y: 368, heading: 245, plan: { x: 500, y: 150, heading: 180 } },
  { id: "cam-03", n: 3, name: "MacQuarrie Hall · West corridor", x: 420, y: 385, heading: 65, plan: { x: 780, y: 170, heading: 225 } },
  { id: "cam-04", n: 4, name: "Parking East lot", x: 548, y: 482, heading: 135, plan: { x: 220, y: 420, heading: 90 } },
  { id: "cam-05", n: 5, name: "Campus lobby entrance", x: 505, y: 384, heading: 240, plan: { x: 500, y: 440, heading: 0 } },
  { id: "cam-06", n: 6, name: "Lot walkway", x: 312, y: 492, heading: 60, plan: { x: 780, y: 420, heading: 270 } },
];

/**
 * Walkways between cameras (the backend graph in data/camera_map.json).
 * `via` are the bends between the two pins, in image pixels, following
 * the paseos and footpaths; buildings are entered only through doors.
 */
export const EDGES = [
  { a: "cam-01", b: "cam-02", via: [[480, 382]] },
  { a: "cam-02", b: "cam-03", via: [[455, 377]] },
  { a: "cam-01", b: "cam-03", via: [[444, 394]] },
  { a: "cam-01", b: "cam-04", via: [[475, 402], [542, 365], [542, 440]] },
  { a: "cam-05", b: "cam-06", via: [] },
];

/** Undirected walk links for site-plan paths and mock pursuit. */
export const ADJACENCY = EDGES.map((e) => [e.a, e.b]);

/** Map mode for this load: SITE.map.type, or ?map=plan|image. */
export function mapMode() {
  let q = null;
  try {
    q = new URLSearchParams(location.search).get("map");
  } catch {
    q = null;
  }
  if (q === "plan" || q === "image") return q;
  return SITE.map?.type === "image" ? "image" : "plan";
}

/** "Camera 1 · Spartan Complex · South entrance"; "Camera 1" if unnamed. */
export function cameraTitle(cameraId) {
  const known = byId.get(String(cameraId));
  return known?.name ? `${cameraLabel(cameraId)} · ${known.name}` : cameraLabel(cameraId);
}

export const WALL_CAMERA_IDS = CAMERAS.map((c) => c.id);

/**
 * Kept as a compatibility export. Canonical location facts are intentionally
 * shown; only raw camera IDs are normalised by redactPlaces().
 */
export const DENYLIST = [];

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

/** The camera's place ("MacQuarrie Hall · East corridor"), or "". */
export function cameraPlace(cameraId) {
  return byId.get(String(cameraId ?? ""))?.name || "";
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
