/* Camera roster — hand-kept mirror of data/camera_map.json.
 *
 * services/api serves no camera map: server.py exposes only /health, /ws and
 * /mjpeg/{camera_id}. The browser therefore cannot fetch this, and the Python
 * file cannot be imported, so it is mirrored here the same way js/contracts.js
 * mirrors the frozen schemas. If data/camera_map.json changes, update this by
 * hand.
 *
 * Six cameras, matching CLIP_BY_CAM in services/api/server.py exactly — those
 * are the only ids /mjpeg can stream. The hub reports twelve cameras online
 * (ALL_CAMS in services/api/hub.py) but has video for six.
 *
 * `name`      heading text, map tooltips, locationText()
 * `location`  short tag shown on a wall pane
 * `x`, `y`    normalised 0..1 map position, DERIVED from `coordinates` below —
 *             not invented. See toMapPositions().
 */

/** Mirrored from data/camera_map.json. Order matches the file. */
const ENTRIES = [
  {
    id: 'cam-01',
    no: '01',
    name: 'North Library / Lobby',
    location: 'Lobby entrance',
    building: 'North Library',
    address: 'North Library entrance, campus core',
    coordinates: [37.3352, -121.8811],
    onWall: true,
    placeholder: false,
  },
  {
    id: 'cam-02',
    no: '02',
    name: 'Academic Walk East',
    location: 'Yellow hallway east',
    building: 'Academic Walk',
    address: 'Academic Walk east corridor',
    coordinates: [37.3355, -121.8805],
    onWall: true,
    placeholder: false,
  },
  {
    id: 'cam-03',
    no: '03',
    name: 'Academic Walk West',
    location: 'Yellow hallway west',
    building: 'Academic Walk',
    address: 'Academic Walk west corridor',
    coordinates: [37.3356, -121.8815],
    onWall: true,
    placeholder: false,
  },
  {
    id: 'cam-04',
    no: '04',
    name: 'Parking East',
    location: 'Parking East',
    building: 'Parking East',
    address: 'East parking deck level 1',
    coordinates: [37.3348, -121.8798],
    onWall: true,
    placeholder: true,
  },
  {
    id: 'cam-05',
    no: '05',
    name: 'Basement corridor',
    location: 'Basement corridor',
    building: 'Student Union',
    address: 'Student Union basement service corridor',
    coordinates: [37.3350, -121.8808],
    onWall: true,
    placeholder: true,
  },
  {
    id: 'cam-06',
    no: '06',
    name: 'Campus road',
    location: 'Campus road',
    building: null,
    address: 'South campus road near residence',
    coordinates: [37.3345, -121.8818],
    onWall: true,
    placeholder: true,
  },
];

/** Keep pins clear of the panel edges. */
const INSET = 0.08;
const SPAN = 1 - INSET * 2;

/**
 * Project lat/lon onto the map panel's normalised 0..1 space.
 *
 * The camera map carries real coordinates but no screen positions, so the
 * bounding box of the roster is stretched to fill the panel. That preserves
 * true relative geography — which camera is north of which, and roughly how
 * far — without inventing a layout. The absolute scale is meaningless; these
 * six cameras span about 100m by 180m.
 *
 * Latitude is flipped so north renders at the top.
 */
function toMapPositions(entries) {
  const lats = entries.map((c) => c.coordinates[0]);
  const lons = entries.map((c) => c.coordinates[1]);

  const latMin = Math.min(...lats);
  const latMax = Math.max(...lats);
  const lonMin = Math.min(...lons);
  const lonMax = Math.max(...lons);

  const latSpan = latMax - latMin;
  const lonSpan = lonMax - lonMin;

  // A degenerate box (one camera, or all co-located) collapses to the centre
  // rather than dividing by zero.
  const frac = (value, min, span) => (span > 0 ? (value - min) / span : 0.5);

  return entries.map((cam) => ({
    ...cam,
    x: INSET + SPAN * frac(cam.coordinates[1], lonMin, lonSpan),
    y: INSET + SPAN * (1 - frac(cam.coordinates[0], latMin, latSpan)),
  }));
}

export const CAMERAS = toMapPositions(ENTRIES);

export function cameraById(cameraId) {
  return CAMERAS.find((c) => c.id === cameraId) || null;
}

export function cameraNo(cameraId) {
  const cam = cameraById(cameraId);
  return cam ? cam.no : '--';
}

export function cameraName(cameraId) {
  const cam = cameraById(cameraId);
  return cam ? cam.name : cameraId;
}

/** "North Library / Lobby · CAM 01"
 *
 *  Used for display only. The wire field is `location_text` on the incident,
 *  which services/brain currently leaves as the bare camera id — see
 *  escalate_request_from_vision() in services/brain/from_vision.py.
 */
export function locationText(cameraId) {
  const cam = cameraById(cameraId);
  if (!cam) return cameraId;
  return `${cam.name} · CAM ${cam.no}`;
}
