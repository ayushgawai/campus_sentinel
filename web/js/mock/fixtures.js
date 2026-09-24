/* Deterministic mock data.
 *
 * UI-ONLY. Nothing here is written to data/camera_map.json or data/scenarios/
 * — those files belong to the data owner. When services/api serves the real
 * camera map, js/normalize.js consumes it and these fixtures fall away.
 *
 * Camera positions are normalised 0..1 in the map's own coordinate space.
 * Incident payloads mirror contracts/incident.py :: incident_to_dict exactly,
 * plus the optional display-only extras documented in js/normalize.js.
 */

import { IncidentClass, IncidentState, Severity } from '../contracts.js';

/** Today at a fixed UTC time — keeps the demo identical on every run. */
function isoAt(h, m, s) {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, s
  )).toISOString();
}

/* ---------------- campus geography ---------------- */

export const BUILDINGS = [
  { label: 'LIBRARY',     x: 0.04, y: 0.09, w: 0.25, h: 0.21 },
  { label: 'UNION',       x: 0.31, y: 0.33, w: 0.23, h: 0.20 },
  { label: 'RESIDENCE',   x: 0.07, y: 0.62, w: 0.25, h: 0.22 },
  { label: 'GARAGE',      x: 0.56, y: 0.61, w: 0.33, h: 0.23 },
  { label: 'ENGINEERING', x: 0.62, y: 0.07, w: 0.27, h: 0.18 },
];

/* Twelve cameras per playbook §04-F. Six are assigned to the wall.
 *
 * address / building / entrances / coords stand in for the real
 * data/camera_map.json. The Call Brief reads them as LOOKUPS ONLY — on a call
 * the system states these or says it cannot confirm. It never infers them.
 */
export const CAMERAS = [
  {
    id: 'cam-01', no: '01', name: 'North Library', x: 0.11, y: 0.23, onWall: true,
    building: 'Dr. Martin Luther King Jr. Library',
    address: '150 E San Fernando St, San Jose, CA 95112',
    coordinates: [37.335430, -121.885050],
    entrances: ['North entrance on E San Fernando St', 'Service door, west loading bay'],
  },
  {
    id: 'cam-02', no: '02', name: 'Academic Walk', x: 0.31, y: 0.15, onWall: true,
    building: 'Clark Hall',
    address: '128 S 7th St, San Jose, CA 95112',
    coordinates: [37.335760, -121.881420],
    entrances: ['Paseo entrance, south side'],
  },
  {
    id: 'cam-03', no: '03', name: 'Union Plaza', x: 0.41, y: 0.29, onWall: true,
    building: 'Student Union Plaza',
    address: '211 S 9th St, San Jose, CA 95112',
    coordinates: [37.336120, -121.880540],
    entrances: ['Plaza steps, north face', 'Ramp access, east face'],
  },
  {
    id: 'cam-04', no: '04', name: 'Parking East', x: 0.73, y: 0.27, onWall: true,
    building: 'South Garage, Level 3',
    address: '377 S 7th St, San Jose, CA 95112',
    coordinates: [37.332890, -121.881070],
    entrances: ['Vehicle ramp on S 7th St', 'Stairwell C, northeast corner'],
  },
  {
    id: 'cam-05', no: '05', name: 'Student Union', x: 0.46, y: 0.50, onWall: true,
    building: 'Diaz Compean Student Union',
    address: '211 S 9th St, San Jose, CA 95112',
    coordinates: [37.336480, -121.880900],
    entrances: ['Main doors, west face', 'Loading dock, south face'],
  },
  {
    id: 'cam-06', no: '06', name: 'Residence Quad', x: 0.19, y: 0.70, onWall: true,
    building: 'Campus Village Building B',
    address: '325 S 9th St, San Jose, CA 95112',
    coordinates: [37.333610, -121.879880],
    entrances: ['Courtyard gate, north side', 'Lobby doors, S 9th St'],
  },
  {
    id: 'cam-07', no: '07', name: 'Engineering Court', x: 0.81, y: 0.14, onWall: false,
    building: 'Charles W. Davidson Engineering',
    address: '455 E San Fernando St, San Jose, CA 95112',
    coordinates: [37.337200, -121.881600],
    entrances: ['Courtyard entrance, west face'],
  },
  {
    id: 'cam-08', no: '08', name: 'South Gate', x: 0.50, y: 0.87, onWall: false,
    building: 'South campus pedestrian gate',
    address: '400 S 8th St, San Jose, CA 95112',
    coordinates: [37.332100, -121.880300],
    entrances: ['Pedestrian gate, S 8th St'],
  },
  {
    id: 'cam-09', no: '09', name: 'Rec Center', x: 0.88, y: 0.48, onWall: false,
    building: 'Provident Credit Union Event Center',
    address: '290 S 7th St, San Jose, CA 95112',
    coordinates: [37.334100, -121.880100],
    entrances: ['Box office doors, north face'],
  },
  {
    id: 'cam-10', no: '10', name: 'Dining Hall', x: 0.33, y: 0.58, onWall: false,
    building: 'Campus Village Dining Commons',
    address: '150 S 10th St, San Jose, CA 95112',
    coordinates: [37.335000, -121.879200],
    entrances: ['Main doors, west face'],
  },
  {
    id: 'cam-11', no: '11', name: 'Transit Plaza', x: 0.67, y: 0.73, onWall: false,
    building: 'South campus transit stop',
    address: '350 S 7th St, San Jose, CA 95112',
    coordinates: [37.332500, -121.881300],
    entrances: ['Open plaza, no controlled access'],
  },
  {
    id: 'cam-12', no: '12', name: 'Athletics Field', x: 0.12, y: 0.45, onWall: false,
    building: 'South Campus Field',
    address: '1393 S 7th St, San Jose, CA 95112',
    coordinates: [37.320900, -121.877400],
    entrances: ['Field gate, north side'],
  },
];

export function cameraById(cameraId) {
  return CAMERAS.find((c) => c.id === cameraId) || null;
}

export function cameraNo(cameraId) {
  const cam = CAMERAS.find((c) => c.id === cameraId);
  return cam ? cam.no : '--';
}

export function cameraName(cameraId) {
  const cam = CAMERAS.find((c) => c.id === cameraId);
  return cam ? cam.name : cameraId;
}

/** "North Library · CAM 01" */
export function locationText(cameraId) {
  return `${cameraName(cameraId)} · CAM ${cameraNo(cameraId)}`;
}

/** How many people each pane is showing — matches the mockup's counts. */
export const TRACK_COUNTS = {
  'cam-01': 3,
  'cam-02': 4,
  'cam-03': 1,
  'cam-04': 2,
  'cam-05': 2,
  'cam-06': 2,
};

/* ---------------- starter incidents ---------------- */

export function starterIncidents() {
  return [
    {
      schema_version: '1.0',
      incident_id: 'INC-0417',
      track_id: 'T-2',
      camera_id: 'cam-01',
      peak_ts: isoAt(2, 14, 8),
      class_token: IncidentClass.WEAPON,
      class_logprob_calibrated: 0.97,
      router_score: 0.94,
      fused_prob: 0.96,
      severity: Severity.SEVERE,
      description:
        'Armed individual entered the north lobby with a visible long firearm and moved '
        + 'toward the east hallway.',
      location_text: locationText('cam-01'),
      person_description: 'Adult, dark jacket, light backpack, no hat.',
      rules_fired: ['Rapid descent', 'Orientation flip', 'Remained low'],
      clip_uri: 'file://data/clips/mock/inc-0417.mp4',
      created_at: isoAt(2, 14, 8),
      updated_at: isoAt(2, 14, 26),
      state: IncidentState.DISPATCHED,
      timeline: [
        { ts: isoAt(2, 14, 8),  state: IncidentState.NEW,              note: 'Detected · CAM 01' },
        { ts: isoAt(2, 14, 11), state: IncidentState.ALERTED,          note: 'Adjudicated · 96% confidence' },
        { ts: isoAt(2, 14, 19), state: IncidentState.DISPATCH_PENDING, note: 'Threshold crossed · arming dispatch' },
        { ts: isoAt(2, 14, 26), state: IncidentState.DISPATCHED,       note: 'SIMULATED · campus security' },
      ],
      dismissed_reason: null,
      // display-only extras
      track_path: ['cam-01', 'cam-03'],
      predicted_next: 'cam-04',
    },
    {
      schema_version: '1.0',
      incident_id: 'INC-0416',
      track_id: 'T-1',
      camera_id: 'cam-04',
      peak_ts: isoAt(2, 8, 41),
      class_token: IncidentClass.THEFT,
      class_logprob_calibrated: 0.90,
      router_score: 0.81,
      fused_prob: 0.88,
      severity: Severity.MINOR,
      description:
        'Repeated force applied to a vehicle door on the east parking deck, '
        + 'following four minutes of stationary dwell.',
      location_text: locationText('cam-04'),
      person_description: 'Adult, grey hooded top, dark trousers.',
      rules_fired: ['Extended dwell', 'Forced motion'],
      clip_uri: 'file://data/clips/mock/inc-0416.mp4',
      created_at: isoAt(2, 8, 41),
      updated_at: isoAt(2, 8, 47),
      state: IncidentState.ALERTED,
      timeline: [
        { ts: isoAt(2, 8, 41), state: IncidentState.NEW,     note: 'Detected · CAM 04' },
        { ts: isoAt(2, 8, 47), state: IncidentState.ALERTED, note: 'Adjudicated · 88% confidence' },
      ],
      dismissed_reason: null,
      track_path: ['cam-04'],
      predicted_next: 'cam-11',
    },
    {
      schema_version: '1.0',
      incident_id: 'INC-0415',
      track_id: 'T-4',
      camera_id: 'cam-06',
      peak_ts: isoAt(1, 52, 20),
      class_token: IncidentClass.RUN,
      display_title: 'Extended dwell',
      class_logprob_calibrated: 0.74,
      router_score: 0.63,
      fused_prob: 0.71,
      severity: Severity.MINOR,
      description:
        'Single figure stationary outside the residence entrance for eleven minutes '
        + 'with intermittent approach to the door.',
      location_text: locationText('cam-06'),
      person_description: 'Adult, light jacket, shoulder bag.',
      rules_fired: ['Extended dwell'],
      clip_uri: 'file://data/clips/mock/inc-0415.mp4',
      created_at: isoAt(1, 52, 20),
      updated_at: isoAt(1, 52, 20),
      state: IncidentState.NEW,
      timeline: [
        { ts: isoAt(1, 52, 20), state: IncidentState.NEW, note: 'Detected · CAM 06' },
      ],
      dismissed_reason: null,
      track_path: ['cam-06'],
      predicted_next: null,
    },
  ];
}

/* ---------------- scenarios ---------------- */

/** Deterministic scenario definitions for the demo bar. */
export const SCENARIOS = [
  {
    id: 'armed-intruder',
    label: 'Armed intruder',
    camera_id: 'cam-01',
    track_id: 'T-3',
    class_token: IncidentClass.WEAPON,
    severity: Severity.SEVERE,
    router_score: 0.92,
    class_logprob_calibrated: 0.96,
    fused_prob: 0.94,
    rules_fired: ['Rapid descent', 'Orientation flip', 'Remained low'],
    description:
      'Subject carrying a visible firearm crossed the lobby toward the academic walk.',
    person_description: 'Adult, red jacket, jeans, no bag.',
    predicted_next: 'cam-10',
  },
  {
    id: 'forced-entry',
    label: 'Break-in',
    camera_id: 'cam-02',
    track_id: 'T-6',
    class_token: IncidentClass.THEFT,
    severity: Severity.MINOR,
    router_score: 0.84,
    class_logprob_calibrated: 0.89,
    fused_prob: 0.86,
    rules_fired: ['Extended dwell', 'Forced motion'],
    description:
      'Sustained force applied to a side door on the academic walk after hours.',
    person_description: 'Adult, black coat, hood up, gloves.',
    predicted_next: 'cam-03',
  },
  {
    id: 'loitering',
    label: 'Loitering',
    camera_id: 'cam-03',
    track_id: 'T-7',
    class_token: IncidentClass.RUN,
    display_title: 'Extended dwell',
    severity: Severity.MINOR,
    router_score: 0.58,
    class_logprob_calibrated: 0.71,
    fused_prob: 0.68,
    rules_fired: ['Extended dwell'],
    description:
      'Figure circling the union plaza benches for nine minutes with no '
      + 'destination pattern.',
    person_description: 'Adult, olive jacket, backpack.',
    predicted_next: null,
  },
];

let seq = 417;

/** Build a fresh NEW incident payload from a scenario definition. */
export function incidentFromScenario(scenarioId, now = new Date()) {
  const s = SCENARIOS.find((x) => x.id === scenarioId) || SCENARIOS[0];
  seq += 1;
  const iso = now.toISOString();

  return {
    schema_version: '1.0',
    incident_id: `INC-0${seq}`,
    track_id: s.track_id,
    camera_id: s.camera_id,
    peak_ts: iso,
    class_token: s.class_token,
    display_title: s.display_title,
    class_logprob_calibrated: s.class_logprob_calibrated,
    router_score: s.router_score,
    fused_prob: s.fused_prob,
    severity: s.severity,
    description: s.description,
    location_text: locationText(s.camera_id),
    person_description: s.person_description,
    rules_fired: [...s.rules_fired],
    clip_uri: `file://data/clips/mock/${s.id}.mp4`,
    created_at: iso,
    updated_at: iso,
    state: IncidentState.NEW,
    timeline: [
      { ts: iso, state: IncidentState.NEW, note: `Detected · CAM ${cameraNo(s.camera_id)}` },
    ],
    dismissed_reason: null,
    track_path: [s.camera_id],
    predicted_next: s.predicted_next,
  };
}

export function resetSeq() {
  seq = 417;
}

/* ---------------- call brief ---------------- */

/**
 * Assemble a Call Brief payload matching contracts/call_brief.py.
 *
 * LOOKUPS ONLY. Every value here comes from the incident record or the camera
 * map. There is deliberately no summary, assessment or recommendation field —
 * the contract forbids them, because on a call the system may only state facts
 * it holds and must otherwise say it cannot confirm.
 *
 * In production this is assembled by services/brain, not the browser. This mock
 * exists so the call console can be built and demoed before brain ships it.
 */
export function callBriefFor(incidentDict, now = new Date()) {
  const cam = cameraById(incidentDict.camera_id);
  const iso = now.toISOString();

  return {
    schema_version: '1.0',
    incident_id: incidentDict.incident_id,
    camera_id: incidentDict.camera_id,
    address: cam ? cam.address : '',
    building: cam ? cam.building : null,
    coordinates: cam ? [...cam.coordinates] : null,
    entrances: cam ? [...cam.entrances] : [],
    person_description: incidentDict.person_description || '',
    incident_started_at: incidentDict.created_at,
    brief_generated_at: iso,
    peak_ts: incidentDict.peak_ts,
    dispatched_ts: iso,
    map_lookup_refs: cam ? [`camera_map:${cam.id}`, `building:${cam.building}`] : [],
  };
}

/* ---------------- call scripts ---------------- */

/*
 * Dispatcher turns are pre-scripted; Sentinel's turns are the lines the voice
 * agent would speak, built only from Call Brief facts. `tool` steps are the
 * agentic lookups that appear live in the console — the visible proof that the
 * model is reading facts rather than inventing them.
 *
 * The final exchange is deliberate: when asked something the system cannot
 * verify, it says so. That is the "never infer a fact on a call" rule made
 * visible on screen.
 */

const OPENING = [
  { after: 600,  speaker: 'dispatcher', text: '9-1-1, what is the address of your emergency?' },
  { after: 1500, tool: 'lookup_location' },
  {
    after: 900, speaker: 'sentinel',
    text: 'This is Campus Sentinel, an automated campus security system. '
      + 'I am reporting from {address}. This is a simulated call.',
  },
];

const CLOSING = [
  { after: 2000, speaker: 'dispatcher', text: 'Is the person conscious and breathing?' },
  {
    after: 1100, speaker: 'sentinel',
    text: 'I cannot confirm consciousness or breathing. I can only confirm what the camera '
      + 'observed: no recovery motion since the incident began.',
  },
  { after: 1900, speaker: 'dispatcher', text: 'Understood. Units are on the way. Stay on the line.' },
  {
    after: 1000, speaker: 'sentinel',
    text: 'Acknowledged. Campus security has also been broadcast. '
      + 'I will hold this line and report any change.',
  },
];

export const CALL_SCRIPTS = {
  WEAPON: [
    ...OPENING,
    { after: 1800, speaker: 'dispatcher', text: 'What is happening there?' },
    { after: 1400, tool: 'get_person_description' },
    {
      after: 900, speaker: 'sentinel',
      text: 'A person collapsed and has remained on the ground. '
        + 'Person description: {person_description}.',
    },
    { after: 1900, speaker: 'dispatcher', text: 'How long have they been down?' },
    { after: 1300, tool: 'get_elapsed_time' },
    { after: 900, speaker: 'sentinel', text: 'Approximately {elapsed} since the incident began.' },
    { after: 1800, speaker: 'dispatcher', text: 'Where exactly should responders go?' },
    {
      after: 1000, speaker: 'sentinel',
      text: 'Nearest access: {entrance}. Location on site: {location}.',
    },
    ...CLOSING,
  ],

  THEFT: [
    ...OPENING,
    { after: 1800, speaker: 'dispatcher', text: 'What are you reporting?' },
    { after: 1400, tool: 'get_suspect_status' },
    {
      after: 900, speaker: 'sentinel',
      text: 'A break-in attempt in progress. The subject is still on camera at {location}.',
    },
    { after: 1900, speaker: 'dispatcher', text: 'Can you describe the subject?' },
    { after: 1300, tool: 'get_person_description' },
    { after: 900, speaker: 'sentinel', text: 'Person description: {person_description}.' },
    { after: 1800, speaker: 'dispatcher', text: 'How long has this been going on?' },
    { after: 1200, tool: 'get_elapsed_time' },
    { after: 900, speaker: 'sentinel', text: 'Approximately {elapsed} since detection.' },
    { after: 1900, speaker: 'dispatcher', text: 'Is anyone injured?' },
    {
      after: 1000, speaker: 'sentinel',
      text: 'I cannot confirm any injury. No person-down event has been detected at this location.',
    },
    { after: 1700, speaker: 'dispatcher', text: 'Officers are en route.' },
    { after: 900, speaker: 'sentinel', text: 'Acknowledged. Nearest access: {entrance}.' },
  ],
};

/** Fallback for classes without a bespoke script. */
export const DEFAULT_CALL_SCRIPT = [
  ...OPENING,
  { after: 1800, speaker: 'dispatcher', text: 'What are you reporting?' },
  { after: 1300, tool: 'get_person_description' },
  {
    after: 900, speaker: 'sentinel',
    text: 'An active incident at {location}. Person description: {person_description}.',
  },
  { after: 1800, speaker: 'dispatcher', text: 'How long has it been going on?' },
  { after: 1200, tool: 'get_elapsed_time' },
  { after: 900, speaker: 'sentinel', text: 'Approximately {elapsed} since detection.' },
  ...CLOSING,
];

export function callScriptFor(classToken) {
  return CALL_SCRIPTS[classToken] || DEFAULT_CALL_SCRIPT;
}

/** Human elapsed string, used by the get_elapsed_time tool. */
export function elapsedSince(startIso, now = new Date()) {
  const start = new Date(startIso).getTime();
  const secs = Math.max(0, Math.round((now.getTime() - start) / 1000));
  if (secs < 90) return `${secs} seconds`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hour${hrs === 1 ? '' : 's'} ${mins % 60} minutes`;
}

/**
 * The five agentic call tools from playbook §04-E. Each returns facts read from
 * the Call Brief — never a generated narrative.
 */
export function runCallTool(tool, brief, incidentDict, now = new Date()) {
  switch (tool) {
    case 'lookup_location':
      return {
        args: { camera_id: brief.camera_id },
        result: {
          address: brief.address,
          building: brief.building,
          coordinates: brief.coordinates,
          source: 'camera_map',
        },
      };

    case 'get_person_description':
      return {
        args: { incident_id: brief.incident_id },
        result: {
          person_description: brief.person_description || 'not recorded',
          source: 'incident_record',
        },
      };

    case 'get_elapsed_time':
      return {
        args: { since: brief.incident_started_at },
        result: {
          elapsed: elapsedSince(brief.incident_started_at, now),
          source: 'incident_record',
        },
      };

    case 'get_suspect_status':
      return {
        args: { track_id: incidentDict.track_id },
        result: {
          still_tracked: true,
          camera_id: brief.camera_id,
          source: 'tracking_state',
        },
      };

    case 'repeat_last':
      return { args: {}, result: { repeated: true, source: 'call_state' } };

    default:
      return { args: {}, result: { error: 'unknown tool' } };
  }
}

/** Fill {placeholders} in a scripted Sentinel line from Call Brief facts only. */
export function fillLine(text, brief, incidentDict, now = new Date()) {
  const map = {
    address: brief.address || 'an address I cannot confirm',
    location: incidentDict.location_text || brief.camera_id,
    person_description: brief.person_description || 'not recorded',
    entrance: brief.entrances && brief.entrances.length
      ? brief.entrances[0]
      : 'no recorded entrance',
    elapsed: elapsedSince(brief.incident_started_at, now),
  };
  return text.replace(/\{(\w+)\}/g, (m, key) => (key in map ? map[key] : m));
}
