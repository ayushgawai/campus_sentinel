/* Self-check for web/ — no browser, no build step, no dependencies.
 *
 *   node web/check.mjs
 *
 * Covers the pure modules: cameras, scenarios, contracts, transitions,
 * normalize and store. The ui/* modules need a DOM and are out of scope here.
 *
 * Two of these assertions guard hand-kept copies, which are the parts most
 * likely to rot:
 *   - js/cameras.js against data/camera_map.json
 *   - the removal of the HIGH severity bucket against bench/thresholds.json
 */

import { readFileSync } from 'node:fs';

import { CAMERAS, cameraById, cameraNo, cameraName, locationText } from './js/cameras.js';
import { SCENARIOS, DEFAULT_SCENARIO_ID } from './js/scenarios.js';
import {
  EventType, IncidentState, IncidentClass, Severity, UiSeverity,
  uiSeverity, STATE_LABEL, CLASS_TITLE, isOpen, isAlerting,
} from './js/contracts.js';
import { ALLOWED, Action, availableActions, actionPath, pathTo } from './js/transitions.js';
import {
  normalizeIncident, normalizeHealth, normalizeOverlay,
  normalizeStateChange, normalizeCameraOnline,
  normalizeTranscriptDelta, normalizeToolCall,
} from './js/normalize.js';
import { createStore } from './js/store.js';

/* ---------------- harness ---------------- */

let passed = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) { passed += 1; return; }
  failures.push(detail ? `${name} — ${detail}` : name);
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, `got ${a}, expected ${e}`);
}

const repoFile = (rel) => JSON.parse(
  readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
);

/* ---------------- cameras.js mirrors data/camera_map.json ---------------- */

const camMap = repoFile('data/camera_map.json');
const mapCams = camMap.cameras;

eq('cameras: same count as data/camera_map.json', CAMERAS.length, mapCams.length);
eq('cameras: same ids, same order',
  CAMERAS.map((c) => c.id), mapCams.map((c) => c.camera_id));

for (const src of mapCams) {
  const cam = cameraById(src.camera_id);
  ok(`cameras: ${src.camera_id} present`, cam !== null);
  if (!cam) continue;
  eq(`cameras: ${src.camera_id} name matches map`, cam.name, src.name);
  eq(`cameras: ${src.camera_id} address matches map`, cam.address, src.address);
  eq(`cameras: ${src.camera_id} building matches map`, cam.building, src.building ?? null);
  eq(`cameras: ${src.camera_id} coordinates match map`, cam.coordinates, src.coordinates);
  ok(`cameras: ${src.camera_id} x in panel range`, cam.x >= 0.08 && cam.x <= 0.92, `x=${cam.x}`);
  ok(`cameras: ${src.camera_id} y in panel range`, cam.y >= 0.08 && cam.y <= 0.92, `y=${cam.y}`);
}

// Positions are derived from lat/lon, so the extremes must actually land on the
// edges of the usable band. A constant fallback would collapse them to 0.5.
ok('cameras: derived x spans the band',
  Math.min(...CAMERAS.map((c) => c.x)) < 0.1 && Math.max(...CAMERAS.map((c) => c.x)) > 0.9);
ok('cameras: derived y spans the band',
  Math.min(...CAMERAS.map((c) => c.y)) < 0.1 && Math.max(...CAMERAS.map((c) => c.y)) > 0.9);

// North must render at the top: the highest latitude gets the smallest y.
const byLat = [...CAMERAS].sort((a, b) => b.coordinates[0] - a.coordinates[0]);
ok('cameras: north is up', byLat[0].y < byLat[byLat.length - 1].y);

eq('cameras: unknown id degrades', locationText('cam-99'), 'cam-99');
eq('cameras: unknown no degrades', cameraNo('cam-99'), '--');
eq('cameras: unknown name degrades', cameraName('cam-99'), 'cam-99');
eq('cameras: locationText format', locationText('cam-01'), 'North Library / Lobby · CAM 01');

/* services/api/server.py only has clips for these six. Every wall pane points
 * at /mjpeg/{id}, so a camera here without a clip would render a dead pane. */
eq('cameras: ids match the /mjpeg clip set',
  CAMERAS.map((c) => c.id),
  ['cam-01', 'cam-02', 'cam-03', 'cam-04', 'cam-05', 'cam-06']);

/* ---------------- scenarios.js ---------------- */

ok('scenarios: non-empty', SCENARIOS.length > 0);
ok('scenarios: every entry has id and label',
  SCENARIOS.every((s) => typeof s.id === 'string' && s.id && typeof s.label === 'string' && s.label));
ok('scenarios: ids unique', new Set(SCENARIOS.map((s) => s.id)).size === SCENARIOS.length);
ok('scenarios: default is in the list', SCENARIOS.some((s) => s.id === DEFAULT_SCENARIO_ID));

/* ---------------- contracts.js ---------------- */

eq('contracts: 8 event types', Object.keys(EventType).length, 8);
eq('contracts: severity buckets', Object.keys(UiSeverity), ['CRITICAL', 'MEDIUM', 'NONE']);
eq('contracts: SEVERE -> CRITICAL', uiSeverity(Severity.SEVERE), UiSeverity.CRITICAL);
eq('contracts: MINOR -> MEDIUM', uiSeverity(Severity.MINOR), UiSeverity.MEDIUM);
eq('contracts: NONE -> NONE', uiSeverity(Severity.NONE), UiSeverity.NONE);
ok('contracts: HIGH bucket is gone', !('HIGH' in UiSeverity));

ok('contracts: every IncidentClass has a title',
  Object.values(IncidentClass).every((c) => typeof CLASS_TITLE[c] === 'string' && CLASS_TITLE[c]));
ok('contracts: every IncidentState has a label',
  Object.values(IncidentState).every((s) => typeof STATE_LABEL[s] === 'string' && STATE_LABEL[s]));

ok('contracts: RESOLVED is closed', !isOpen(IncidentState.RESOLVED));
ok('contracts: DISMISSED is closed', !isOpen(IncidentState.DISMISSED));
ok('contracts: NEW is open', isOpen(IncidentState.NEW));
ok('contracts: NEW is not alerting', !isAlerting(IncidentState.NEW));
ok('contracts: DISPATCHED is alerting', isAlerting(IncidentState.DISPATCHED));

/* The HIGH bucket split MINOR at fused_prob >= 0.8 and was removed because
 * severity_from_fused returns SEVERE at >= severe_at. If severe_at ever drops
 * below 0.8 the split becomes reachable again and needs reconsidering. */
const thresholds = repoFile('bench/thresholds.json');
ok('contracts: HIGH stays unreachable at the current severe_at',
  thresholds.severe_at <= 0.8,
  `severe_at=${thresholds.severe_at} — a value above 0.8 reopens the MINOR/HIGH split`);

/* ---------------- transitions.js ---------------- */

eq('transitions: dispatch from NEW walks three hops',
  actionPath(IncidentState.NEW, Action.DISPATCH),
  [IncidentState.ALERTED, IncidentState.DISPATCH_PENDING, IncidentState.DISPATCHED]);

eq('transitions: resolve from DISPATCHED passes through TRACKING',
  actionPath(IncidentState.DISPATCHED, Action.RESOLVE),
  [IncidentState.TRACKING, IncidentState.RESOLVED]);

eq('transitions: false alarm unavailable once dispatched',
  availableActions(IncidentState.DISPATCHED)[Action.FALSE_ALARM], false);
eq('transitions: acknowledge only at NEW',
  availableActions(IncidentState.ALERTED)[Action.ACKNOWLEDGE], false);
eq('transitions: resolve blocked at NEW',
  availableActions(IncidentState.NEW)[Action.RESOLVE], false);

for (const terminal of [IncidentState.RESOLVED, IncidentState.DISMISSED]) {
  const acts = availableActions(terminal);
  ok(`transitions: ${terminal} locks every action`,
    Object.values(acts).every((v) => v === false));
  eq(`transitions: ${terminal} is a sink`, ALLOWED[terminal], []);
}

eq('transitions: unreachable target yields no path',
  pathTo(IncidentState.RESOLVED, IncidentState.DISPATCHED), []);

/* ---------------- normalize.js ---------------- */

/* Shaped exactly like contracts/incident.py :: incident_to_dict, using the
 * values services/brain actually produces on the forced scenario path:
 * router_score 0.88 + forced classify -> fused 0.952 -> SEVERE, an
 * autogenerated description carrying the [zrt-forced] tag, and an empty
 * clip_uri because vision_bridge never sets one. */
const INCIDENT_DICT = {
  schema_version: '1.1',
  incident_id: 'inc-2f8c1a9b40',
  track_id: 'T-3',
  camera_id: 'cam-01',
  peak_ts: '2026-09-24T02:14:08+00:00',
  class_token: 'WEAPON',
  class_logprob_calibrated: 0.0,
  router_score: 0.88,
  fused_prob: 0.952,
  severity: 'SEVERE',
  description: 'weapon on cam-01 [zrt-forced]',
  location_text: 'demo · cam-01',
  person_description: 'Adult, demo scenario.',
  rules_fired: ['scenario:armed-intruder'],
  clip_uri: '',
  created_at: '2026-09-24T02:14:08+00:00',
  updated_at: '2026-09-24T02:14:08+00:00',
  state: 'ALERTED',
  timeline: [
    { ts: '2026-09-24T02:14:08+00:00', state: 'NEW', note: 'created' },
    { ts: '2026-09-24T02:14:08+00:00', state: 'ALERTED', note: 'ALERTED' },
  ],
  dismissed_reason: null,
};

const inc = normalizeIncident(INCIDENT_DICT);

eq('normalize: id', inc.id, 'inc-2f8c1a9b40');
eq('normalize: title from class token', inc.title, CLASS_TITLE.WEAPON);
eq('normalize: uiSeverity', inc.uiSeverity, UiSeverity.CRITICAL);
eq('normalize: confidencePct rounds fused_prob', inc.confidencePct, 95);
eq('normalize: stateLabel', inc.stateLabel, STATE_LABEL.ALERTED);
eq('normalize: alerting', inc.alerting, true);
eq('normalize: open', inc.open, true);
eq('normalize: timeline length', inc.timeline.length, 2);
ok('normalize: timeline timestamps parse',
  inc.timeline.every((t) => t.ts instanceof Date && !Number.isNaN(t.ts.getTime())));
ok('normalize: createdAt parses', inc.createdAt instanceof Date);
ok('normalize: no undefined values',
  Object.values(inc).every((v) => v !== undefined));

for (const gone of ['clipUri', 'trackPath', 'predictedNext', 'displayTitle']) {
  ok(`normalize: ${gone} is not produced`, !(gone in inc));
}

// A missing class token must still yield a usable headline.
eq('normalize: unknown class falls back',
  normalizeIncident({ ...INCIDENT_DICT, class_token: 'NOPE' }).title, 'Incident');
// Absent numerics must not become NaN.
eq('normalize: missing fused_prob is 0',
  normalizeIncident({ ...INCIDENT_DICT, fused_prob: undefined }).fusedProb, 0);

const HEALTH_DICT = {
  type: 'health.strip',
  cameras_online: 12,
  cameras_total: 12,
  models_resident: true,
  gpu_util: 0.68,
  p95_ms: 182.0,
  frames_screened: 2842232,
  frames_escalated: 17,
  ts: '2026-09-24T02:14:08+00:00',
};

const hs = normalizeHealth(HEALTH_DICT);
eq('normalize: health keys', Object.keys(hs), [
  'camerasOnline', 'camerasTotal', 'modelsResident',
  'framesScreened', 'framesEscalated', 'escalationPct', 'ts',
]);
for (const fake of ['gpuUtil', 'p95Ms', 'modelsCount', 'gpuTempC']) {
  ok(`normalize: ${fake} is not produced`, !(fake in hs));
}
ok('normalize: escalationPct derived', Math.abs(hs.escalationPct - (17 / 2842232) * 100) < 1e-9);
eq('normalize: escalationPct guards divide-by-zero',
  normalizeHealth({ ...HEALTH_DICT, frames_screened: 0 }).escalationPct, 0);

const ov = normalizeOverlay({
  type: 'overlay.boxes',
  camera_id: 'cam-01',
  ts: '2026-09-24T02:14:08+00:00',
  boxes: [
    { x: 0.1, y: 0.35, w: 0.08, h: 0.22, track_id: 'T-1', label: 'person', score: 0.55 },
    { x: 0.4, y: 0.30, w: 0.09, h: 0.24, track_id: 'T-2', label: 'person', score: 0.74 },
  ],
});
eq('normalize: overlay tracked count', ov.tracked, 2);
eq('normalize: overlay routerScore is the max box score', ov.routerScore, 0.74);
eq('normalize: overlay with no boxes', normalizeOverlay({ camera_id: 'cam-02' }).tracked, 0);

eq('normalize: state change', normalizeStateChange({
  incident_id: 'inc-1', state: 'DISPATCHED', ts: '2026-09-24T02:14:08+00:00', note: 'x',
}).state, 'DISPATCHED');

eq('normalize: camera online coerces to boolean',
  normalizeCameraOnline({ camera_id: 'cam-01', online: 1 }).online, true);

eq('normalize: unknown speaker falls back to sentinel',
  normalizeTranscriptDelta({ incident_id: 'i', speaker: 'nope', text: 'x' }).speaker, 'sentinel');
eq('normalize: dispatcher speaker preserved',
  normalizeTranscriptDelta({ incident_id: 'i', speaker: 'dispatcher', text: 'x' }).speaker, 'dispatcher');
eq('normalize: tool call non-object result is replaced',
  normalizeToolCall({ incident_id: 'i', tool: 't', result: 'oops' }).result, {});

/* ---------------- store.js ---------------- */

const store = createStore();
store.setCameras(CAMERAS);
eq('store: wall holds the six cameras', store.getState().wall.length, 6);

store.upsertIncident(normalizeIncident(INCIDENT_DICT));
eq('store: incident recorded', store.getState().incidents.size, 1);
eq('store: notification raised', store.getState().notifications.length, 1);
eq('store: unseen counter', store.getState().unseen, 1);
eq('store: openCount', store.openCount(), 1);

store.select(inc.id);
eq('store: selected', store.selected().id, inc.id);
ok('store: alerting camera tracked', store.alertingCameraIds().has('cam-01'));
eq('store: alerting track ids', [...store.alertingTracks().get('cam-01')], ['T-3']);

// Re-upserting the same id must not raise a second notification.
store.upsertIncident(normalizeIncident(INCIDENT_DICT));
eq('store: upsert is not a duplicate insert', store.getState().incidents.size, 1);
eq('store: upsert raises no second notification', store.getState().notifications.length, 1);

store.applyStateChange(normalizeStateChange({
  incident_id: inc.id, state: 'DISPATCH_PENDING', ts: '2026-09-24T02:14:19+00:00', note: 'arming',
}));
const moved = store.getState().incidents.get(inc.id);
eq('store: state applied', moved.state, IncidentState.DISPATCH_PENDING);
eq('store: derived stateLabel recomputed', moved.stateLabel, STATE_LABEL.DISPATCH_PENDING);
eq('store: timeline appended', moved.timeline.length, 3);
eq('store: still alerting', moved.alerting, true);

store.applyStateChange(normalizeStateChange({
  incident_id: inc.id, state: 'RESOLVED', ts: '2026-09-24T02:15:00+00:00', note: 'done',
}));
eq('store: resolved closes the incident', store.getState().incidents.get(inc.id).open, false);
eq('store: openCount drops', store.openCount(), 0);

ok('store: state change for unknown incident is ignored',
  store.applyStateChange({ incidentId: 'nope', state: 'RESOLVED' }) === null);

// Severity filters
eq('store: CRITICAL filter matches', (() => {
  store.setFilter('CRITICAL');
  return store.visibleIncidents().length;
})(), 1);
eq('store: MEDIUM filter excludes', (() => {
  store.setFilter('MEDIUM');
  return store.visibleIncidents().length;
})(), 0);
store.setFilter('ALL');

/* Call console. No call.started envelope exists, so the first transcript delta
 * both creates the call and reveals the panel. */
const TS = '2026-09-24T02:14:20+00:00';
store.appendTranscript(normalizeTranscriptDelta({
  incident_id: inc.id, speaker: 'sentinel', text: 'This is Campus Sentinel.', ts: TS,
}));
eq('store: delta opens the console', store.getState().callVisible, true);
eq('store: delta sets the active call', store.getState().activeCallId, inc.id);
eq('store: transcript recorded', store.activeCall().transcript.length, 1);
ok('store: call carries no brief', !('brief' in store.activeCall()));
ok('store: call carries no ended flag', !('ended' in store.activeCall()));
ok('store: lastDeltaAt set', store.activeCall().lastDeltaAt instanceof Date);

store.appendToolCall(normalizeToolCall({
  incident_id: inc.id, tool: 'lookup_location', args: {}, result: { spoken: 'Location on file.' }, ts: TS,
}));
eq('store: tool call recorded', store.activeCall().toolCalls.length, 1);
eq('store: ensureCall is idempotent', store.getState().calls.size, 1);

// Operator closes it; later deltas accumulate without reopening the panel.
store.setCallVisible(false);
eq('store: closed', store.getState().callVisible, false);
eq('store: closing marks dismissed', store.activeCall().dismissed, true);
store.appendTranscript(normalizeTranscriptDelta({
  incident_id: inc.id, speaker: 'dispatcher', text: 'Units en route.', ts: TS,
}));
eq('store: stays closed after further deltas', store.getState().callVisible, false);
eq('store: but keeps accumulating', store.activeCall().transcript.length, 2);

// A delta with no incident id must not create a phantom call.
store.appendTranscript(normalizeTranscriptDelta({ incident_id: '', speaker: 'sentinel', text: 'x' }));
eq('store: no phantom call', store.getState().calls.size, 1);

store.setCameraOnline(normalizeCameraOnline({ camera_id: 'cam-02', online: false }));
eq('store: camera marked offline', store.getState().cameras.get('cam-02').online, false);

store.clearIncidents();
const cleared = store.getState();
ok('store: clearIncidents empties the board',
  cleared.incidents.size === 0
  && cleared.overlays.size === 0
  && cleared.calls.size === 0
  && cleared.selectedId === null
  && cleared.activeCallId === null
  && cleared.callVisible === false
  && cleared.notifications.length === 0
  && cleared.unseen === 0
  && cleared.filter === 'ALL');

/* ---------------- report ---------------- */

if (failures.length) {
  console.error(`web self-check FAILED — ${failures.length} of ${passed + failures.length}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

console.log(`web self-check OK — ${passed} assertions`);
