import { cameraLabel, WALL_CAMERA_IDS } from "./site.js?v=pro7";
import { mockIso, setMockEpoch } from "./clock.js?v=pro7";

/**
 * Contract-shaped event helpers + deterministic mock timeline player.
 * Event fields mirror contracts/events.py and contracts/incident.py.
 * Timestamps are ISO-8601 UTC on the runtime mock epoch (clock.js), which
 * is rebased to the current wall time at player start and on every reset.
 */

export function atIso(seconds) {
  return mockIso(seconds);
}

export function mkCameraOnline({ camera_id, online = true, at = 0 }) {
  return {
    type: "camera.online",
    camera_id,
    online,
    ts: atIso(at),
  };
}

export function mkHealth({
  at = 0,
  cameras_online = 0,
  cameras_total = 0,
  models_resident = false,
  gpu_util = null,
  p95_ms = null,
  frames_screened = 0,
  frames_escalated = 0,
} = {}) {
  return {
    type: "health.strip",
    cameras_online,
    cameras_total,
    models_resident,
    gpu_util,
    p95_ms,
    frames_screened,
    frames_escalated,
    ts: atIso(at),
  };
}

/**
 * Mock usage.tick (the contract proposed for the api): per-window counts
 * keyed by the model ids in config.js CLOUD_EQUIV. Mock values only.
 */
export function mkUsageTick({ at = 0, window_s = 10, by_model = {} }) {
  return { type: "usage.tick", ts: atIso(at), window_s, by_model };
}

/**
 * Counts for the window [t0, t0 + 10 s) of the mock timeline: router frames
 * all the time, Qwen calls when incidents are classified (minor @15 s,
 * severe @28 s) and while the call runs, speech during the call.
 */
function mockUsageWindow(t0, { includeMinor, includeSevere }) {
  const w = 10;
  const frames = FRAMES_PER_SEC * w;
  const by = {
    "yolo26s-pose": { frames },
    "clip-vit-b-16": { frames },
  };
  let req = 0;
  let tin = 0;
  let tout = 0;
  const inWin = (x) => x >= t0 && x < t0 + w;
  if (includeMinor && inWin(15)) {
    req += 1; tin += 4400; tout += 8; // classify: 16 frames
  }
  if (includeSevere && inWin(28)) {
    req += 2; tin += 4400 + 320; tout += 8 + 60; // classify + describe
  }
  const callOn = includeSevere && t0 + w > 32 && t0 < 92;
  if (callOn) {
    req += 2; tin += 1300; tout += 110; // dispatcher answers
    by["faster-whisper-base.en"] = { requests: 2, audio_s: 7.5 };
    by["kokoro-82m"] = { requests: 3, chars: 190 };
  }
  if (req) {
    by["hf:Qwen/Qwen3-VL-30B-A3B-Instruct-FP8"] = { requests: req, tokens_in: tin, tokens_out: tout, live: req };
  }
  return by;
}

export function mkBoxes({ camera_id, boxes = [], at = 0 }) {
  return {
    type: "overlay.boxes",
    camera_id,
    ts: atIso(at),
    boxes,
  };
}

export function mkUpsert(incident, at = 0) {
  const peak = incident.peak_ts ?? atIso(at);
  const created = incident.created_at ?? atIso(at);
  const updated = incident.updated_at ?? atIso(at);
  return {
    type: "incident.upsert",
    incident: {
      schema_version: incident.schema_version ?? "1.0",
      incident_id: incident.incident_id,
      track_id: incident.track_id,
      camera_id: incident.camera_id,
      peak_ts: peak,
      class_token: incident.class_token,
      class_logprob_calibrated: incident.class_logprob_calibrated,
      router_score: incident.router_score,
      fused_prob: incident.fused_prob,
      severity: incident.severity,
      description: incident.description,
      location_text: incident.location_text,
      person_description: incident.person_description,
      rules_fired: incident.rules_fired ?? [],
      clip_uri: incident.clip_uri,
      created_at: created,
      updated_at: updated,
      state: incident.state,
      timeline: incident.timeline ?? [],
      dismissed_reason: incident.dismissed_reason ?? null,
    },
  };
}

export function mkStateChange({
  incident_id,
  state,
  severity = null,
  note = "",
  at = 0,
}) {
  return {
    type: "incident.state_change",
    incident_id,
    state,
    severity,
    ts: atIso(at),
    note,
  };
}

export function mkTranscript({
  incident_id,
  speaker = "sentinel",
  text = "",
  at = 0,
}) {
  return {
    type: "call.transcript_delta",
    incident_id,
    speaker,
    text,
    ts: atIso(at),
  };
}

export function mkTool({
  incident_id,
  tool = "",
  args = {},
  result = {},
  at = 0,
}) {
  return {
    type: "tool.call_live",
    incident_id,
    tool,
    args,
    result,
    ts: atIso(at),
  };
}

export function mkDemoControl({ action = "reset", scenario_id = null, at = 0 }) {
  return {
    type: "demo.control",
    action,
    scenario_id,
    ts: atIso(at),
  };
}

const CAMERAS = WALL_CAMERA_IDS;
const HEALTH_EVERY = 1;
const HEALTH_DURATION = 120;
const FRAMES_PER_SEC = 180;
const BOX_HZ = 10;
const BOX_DT = 1 / BOX_HZ;

/** Seeded PRNG — same seed → same quiet-state paths every run. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildQuietTracks(cameraIndex) {
  const rand = mulberry32(0xc5ed ^ (cameraIndex + 1) * 0x9e3779b9);
  const count = 2 + Math.floor(rand() * 3); // 2–4
  const tracks = [];
  for (let i = 0; i < count; i++) {
    const trackNum = 400 + cameraIndex * 20 + i * 3 + Math.floor(rand() * 2);
    tracks.push({
      track_id: `t-${String(trackNum).padStart(4, "0")}`,
      cx: 0.18 + rand() * 0.55,
      cy: 0.22 + rand() * 0.45,
      ampX: 0.04 + rand() * 0.1,
      ampY: 0.03 + rand() * 0.08,
      period: 9 + rand() * 14,
      phase: rand() * Math.PI * 2,
      bw: 0.055 + rand() * 0.035,
      bh: 0.13 + rand() * 0.07,
      score: 0.68 + rand() * 0.25,
    });
  }
  return tracks;
}

function sampleBoxes(tracks, t) {
  return tracks.map((tr) => {
    const ang = (Math.PI * 2 * t) / tr.period + tr.phase;
    let x = tr.cx + tr.ampX * Math.sin(ang) - tr.bw / 2;
    let y = tr.cy + tr.ampY * Math.cos(ang * 0.85) - tr.bh / 2;
    x = Math.min(1 - tr.bw, Math.max(0, x));
    y = Math.min(1 - tr.bh, Math.max(0, y));
    return {
      x,
      y,
      w: tr.bw,
      h: tr.bh,
      track_id: tr.track_id,
      label: "",
      score: Math.round(tr.score * 100) / 100,
    };
  });
}

/** Severe pursuit track — same id across cams so the wall paints it red. */
const SEVERE_TRACK = "t-0501";
const MINOR_ID = "inc-minor-run-001";
const SEVERE_ID = "inc-severe-fall-001";

/** Which camera currently hosts the severe track at demo time t (or null). */
function severeCameraAt(t) {
  if (t < 28) return null;
  if (t < 40) return "cam-03";
  if (t < 52) return "cam-02";
  if (t < 64) return "cam-01";
  if (t < 76) return "cam-04";
  return null;
}

function withSevereBox(boxes, cameraId, t) {
  const host = severeCameraAt(t);
  if (host !== cameraId) return boxes;
  const filtered = boxes.filter((b) => b.track_id !== SEVERE_TRACK);
  const drift = 0.02 * Math.sin(t * 0.7);
  filtered.push({
    x: 0.42 + drift,
    y: 0.28,
    w: 0.09,
    h: 0.2,
    track_id: SEVERE_TRACK,
    label: "",
    score: 0.94,
  });
  return filtered;
}

function pushIncidentScriptFiltered(script, { includeMinor, includeSevere }) {
  // --- MINOR RUN on Camera 6 @ ~15s ---
  if (includeMinor) {
    const minorAt = 15;
    script.push({
      at: minorAt,
      event: mkUpsert(
        {
          incident_id: MINOR_ID,
          track_id: "t-0312",
          camera_id: "cam-06",
          peak_ts: atIso(minorAt),
          class_token: "RUN",
          class_logprob_calibrated: -0.18,
          router_score: 0.66,
          fused_prob: 0.71,
          severity: "MINOR",
          description:
            "Person accelerating to a sustained run across an open walkway.",
          location_text: cameraLabel("cam-06"),
          person_description:
            "Adult in dark jacket and light pants, moving quickly",
          state: "NEW",
          clip_uri: "file://clips/minor_run_cam06.mp4",
          created_at: atIso(minorAt),
          updated_at: atIso(minorAt),
          rules_fired: ["sudden_acceleration", "running"],
          timeline: [
            { ts: atIso(minorAt), state: "NEW", note: "Detected" },
          ],
          dismissed_reason: null,
          schema_version: "1.0",
        },
        minorAt,
      ),
    });
    script.push({
      at: minorAt + 1,
      event: mkStateChange({
        incident_id: MINOR_ID,
        state: "ALERTED",
        severity: "MINOR",
        note: "Classified as minor",
        at: minorAt + 1,
      }),
    });
    script.push({
      at: 55,
      event: mkStateChange({
        incident_id: MINOR_ID,
        state: "RESOLVED",
        severity: "MINOR",
        note: "Reviewed by security: jogger",
        at: 55,
      }),
    });
  }

  if (!includeSevere) return;

  // --- SEVERE MEDICAL (collapse) on Camera 3 @ ~28s ---
  // Pursuit along the walkway graph (site.js EDGES): Camera 3 → Camera 2 →
  // Camera 1 (out the south entrance) → Camera 4 (parking).
  const severeAt = 28;
  const fallBase = {
    incident_id: SEVERE_ID,
    track_id: SEVERE_TRACK,
    class_token: "MEDICAL",
    class_logprob_calibrated: -0.04,
    router_score: 0.91,
    fused_prob: 0.94,
    severity: "SEVERE",
    description:
      "Person collapses suddenly and remains on the ground, not moving.",
    location_text: cameraLabel("cam-03"),
    person_description: "Adult, grey hoodie, dark backpack, short dark hair.",
    clip_uri: "file://clips/severe_fall_cam03.mp4",
    rules_fired: ["fast_descent", "orientation_flip", "stays_low"],
    dismissed_reason: null,
    schema_version: "1.0",
  };

  script.push({
    at: severeAt,
    event: mkUpsert(
      {
        ...fallBase,
        camera_id: "cam-03",
        peak_ts: atIso(severeAt),
        created_at: atIso(severeAt),
        updated_at: atIso(severeAt),
        state: "NEW",
        timeline: [
          { ts: atIso(severeAt), state: "NEW", note: "Detected" },
        ],
      },
      severeAt,
    ),
  });

  const steps = [
    { at: severeAt + 0.5, state: "ALERTED", note: "Classified as severe" },
    { at: severeAt + 1.5, state: "DISPATCH_PENDING", note: "Dispatch queued" },
    { at: severeAt + 3.5, state: "DISPATCHED", note: "Call started" },
    { at: severeAt + 9.5, state: "TRACKING", note: "Tracking across cameras" },
  ];
  for (const s of steps) {
    script.push({
      at: s.at,
      event: mkStateChange({
        incident_id: SEVERE_ID,
        state: s.state,
        severity: "SEVERE",
        note: s.note,
        at: s.at,
      }),
    });
  }

  const handoffs = [
    { at: 40, camera_id: "cam-02", note: "Handoff to Camera 2" },
    { at: 52, camera_id: "cam-01", note: "Handoff to Camera 1" },
    { at: 64, camera_id: "cam-04", note: "Handoff to Camera 4" },
  ];
  for (const h of handoffs) {
    script.push({
      at: h.at,
      event: mkUpsert(
        {
          ...fallBase,
          camera_id: h.camera_id,
          location_text: cameraLabel(h.camera_id),
          peak_ts: atIso(severeAt),
          created_at: atIso(severeAt),
          updated_at: atIso(h.at),
          state: "TRACKING",
          timeline: [
            { ts: atIso(severeAt), state: "NEW", note: "Detected" },
            {
              ts: atIso(severeAt + 0.5),
              state: "ALERTED",
              note: "Classified as severe",
            },
            {
              ts: atIso(severeAt + 1.5),
              state: "DISPATCH_PENDING",
              note: "Dispatch queued",
            },
            {
              ts: atIso(severeAt + 3.5),
              state: "DISPATCHED",
              note: "Call started",
            },
            {
              ts: atIso(severeAt + 9.5),
              state: "TRACKING",
              note: "Tracking across cameras",
            },
            { ts: atIso(h.at), state: "TRACKING", note: h.note },
          ],
        },
        h.at,
      ),
    });
  }

  pushCallExchange(script, severeAt);
}

/** Stream text as transcript_delta chunks (~0.28s) for bubble merge. */
function pushStream(script, { incident_id, speaker, at, text, gap = 0.28 }) {
  const parts = text.match(/\S+\s*/g) || [text];
  let t = at;
  let buf = "";
  for (let i = 0; i < parts.length; i++) {
    buf += parts[i];
    const flush = buf.length >= 16 || i === parts.length - 1;
    if (!flush) continue;
    const chunk = buf;
    buf = "";
    script.push({
      at: Math.round(t * 100) / 100,
      event: mkTranscript({
        incident_id,
        speaker,
        text: chunk,
        at: Math.round(t * 100) / 100,
      }),
    });
    t += gap;
  }
  return t;
}

/**
 * ~30s simulated dispatch exchange after DISPATCHED.
 * Tool cards fire before the Sentinel sentence that uses their results.
 */
function pushCallExchange(script, severeAt) {
  const id = SEVERE_ID;
  const dispatchedAt = severeAt + 3.5; // 31.5

  const locResult = {
    camera_id: "cam-03",
  };
  const personResult = {
    person_description: "Adult, grey hoodie, dark backpack, short dark hair.",
  };
  const statusResult = {
    camera_id: "cam-02",
    in_view: true,
    state: "TRACKING",
  };

  script.push({
    at: dispatchedAt + 0.6,
    event: mkTranscript({
      incident_id: id,
      speaker: "dispatcher",
      text: "Where did it start?",
      at: dispatchedAt + 0.6,
    }),
  });

  script.push({
    at: dispatchedAt + 1.2,
    event: mkTool({
      incident_id: id,
      tool: "lookup_location",
      args: { incident_id: id },
      result: locResult,
      at: dispatchedAt + 1.2,
    }),
  });

  pushStream(script, {
    incident_id: id,
    speaker: "sentinel",
    at: dispatchedAt + 1.6,
    text: "The incident started on Camera 3, 42 seconds ago.",
  });

  script.push({
    at: dispatchedAt + 5.0,
    event: mkTranscript({
      incident_id: id,
      speaker: "dispatcher",
      text: "Describe the person involved.",
      at: dispatchedAt + 5.0,
    }),
  });

  script.push({
    at: dispatchedAt + 5.5,
    event: mkTool({
      incident_id: id,
      tool: "get_person_description",
      args: { incident_id: id },
      result: personResult,
      at: dispatchedAt + 5.5,
    }),
  });

  pushStream(script, {
    incident_id: id,
    speaker: "sentinel",
    at: dispatchedAt + 5.9,
    text: `Appearance only: ${personResult.person_description}`,
  });

  script.push({
    at: dispatchedAt + 9.2,
    event: mkTranscript({
      incident_id: id,
      speaker: "dispatcher",
      text: "How long since the incident started?",
      at: dispatchedAt + 9.2,
    }),
  });

  script.push({
    at: dispatchedAt + 9.6,
    event: mkTool({
      incident_id: id,
      tool: "get_elapsed_time",
      args: { incident_id: id },
      result: { elapsed_seconds: 13, peak_ts: atIso(severeAt) },
      at: dispatchedAt + 9.6,
    }),
  });

  pushStream(script, {
    incident_id: id,
    speaker: "sentinel",
    at: dispatchedAt + 10.0,
    text: "The incident started 13 seconds ago.",
  });

  // After Camera 2 handoff @ 40
  script.push({
    at: 40.6,
    event: mkTranscript({
      incident_id: id,
      speaker: "dispatcher",
      text: "Where is the person now? How long since the incident started?",
      at: 40.6,
    }),
  });

  script.push({
    at: 41.0,
    event: mkTool({
      incident_id: id,
      tool: "get_suspect_status",
      args: { incident_id: id },
      result: statusResult,
      at: 41.0,
    }),
  });

  pushStream(script, {
    incident_id: id,
    speaker: "sentinel",
    at: 41.4,
    text: "The person is now on Camera 2, moving toward Camera 1. The incident started 1 minute 28 seconds ago.",
  });

  script.push({
    at: 52.2,
    event: mkTranscript({
      incident_id: id,
      speaker: "dispatcher",
      text: "Repeat the current camera.",
      at: 52.2,
    }),
  });

  script.push({
    at: 52.5,
    event: mkTool({
      incident_id: id,
      tool: "repeat_last",
      args: { field: "camera_id" },
      result: { camera_id: "cam-01", in_view: true },
      at: 52.5,
    }),
  });

  pushStream(script, {
    incident_id: id,
    speaker: "sentinel",
    at: 52.9,
    text: "Current camera is Camera 1.",
  });
}

function elapsedWords(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m} minute${m === 1 ? "" : "s"} ${r} second${r === 1 ? "" : "s"}`;
}

/**
 * Operator "Call for help" in mock: the same scripted exchange as the
 * severe demo call (location, person, elapsed), rebased to `at` and
 * rewritten for the chosen incident. Starts with its DISPATCHED step.
 * @param {{ id: string, cameraId: string, person: string, peakAt: number, at: number }} opts
 */
export function operatorCallRows({ id, cameraId, person, peakAt, at }) {
  /** @type {{ at: number, event: object }[]} */
  const rows = [];
  const say = (offset, speaker, text) => {
    if (speaker === "dispatcher") {
      rows.push({
        at: at + offset,
        event: mkTranscript({ incident_id: id, speaker, text, at: at + offset }),
      });
    } else {
      pushStream(rows, { incident_id: id, speaker, at: at + offset, text });
    }
  };
  const tool = (offset, name, result) =>
    rows.push({
      at: at + offset,
      event: mkTool({
        incident_id: id,
        tool: name,
        args: { incident_id: id },
        result,
        at: at + offset,
      }),
    });

  rows.push({
    at,
    event: mkStateChange({
      incident_id: id,
      state: "DISPATCHED",
      severity: "SEVERE",
      note: "Call started",
      at,
    }),
  });

  say(0.6, "dispatcher", "Where did it start?");
  tool(1.2, "lookup_location", { camera_id: cameraId });
  say(
    1.6,
    "sentinel",
    `The incident started on ${cameraLabel(cameraId)}, ${elapsedWords(at + 1.6 - peakAt)} ago.`,
  );

  say(5.0, "dispatcher", "Describe the person involved.");
  tool(5.5, "get_person_description", { person_description: person || null });
  say(
    5.9,
    "sentinel",
    person
      ? `Appearance only: ${person}`
      : "No person description is available yet.",
  );

  say(9.2, "dispatcher", "How long since the incident started?");
  tool(9.6, "get_elapsed_time", {
    elapsed_seconds: Math.max(0, Math.round(at + 9.6 - peakAt)),
    peak_ts: atIso(peakAt),
  });
  say(10.0, "sentinel", `The incident started ${elapsedWords(at + 10.0 - peakAt)} ago.`);

  return rows;
}

/**
 * Mock-only predicted next camera schedule (no contract field).
 * highlight from (at - lead) until at, then clear on arrival.
 */
export const MOCK_PREDICTED = [
  { at: 40, camera_id: "cam-02", lead: 3 },
  { at: 52, camera_id: "cam-01", lead: 3 },
  { at: 64, camera_id: "cam-04", lead: 3 },
];

export function predictedCameraAt(t) {
  for (const p of MOCK_PREDICTED) {
    if (t >= p.at - p.lead && t < p.at) return p.camera_id;
  }
  return null;
}

/** Demo scenarios selectable from the control modal. */
export const SCENARIOS = [
  { id: "full", name: "Full scenario" },
  { id: "quiet", name: "Quiet only" },
  { id: "medical_fall", name: "Medical fall only" },
];

/** Build script: quiet boxes + health + optional incidents. */
export function buildScript(scenarioId = "full") {
  const includeMinor = scenarioId === "full";
  const includeSevere = scenarioId === "full" || scenarioId === "medical_fall";
  const injectSevereBoxes = includeSevere;

  /** @type {{ at: number, event: object }[]} */
  const script = [];
  const trackSets = CAMERAS.map((_, i) => buildQuietTracks(i));

  for (let i = 0; i < CAMERAS.length; i++) {
    const at = i * 0.05;
    script.push({
      at,
      event: mkCameraOnline({ camera_id: CAMERAS[i], online: true, at }),
    });
  }

  for (let t = 0; t <= HEALTH_DURATION + 1e-9; t += BOX_DT) {
    const at = Math.round(t * 1000) / 1000;
    for (let i = 0; i < CAMERAS.length; i++) {
      const cam = CAMERAS[i];
      const base = sampleBoxes(trackSets[i], at);
      const boxes = injectSevereBoxes ? withSevereBox(base, cam, at) : base;
      script.push({
        at,
        event: mkBoxes({ camera_id: cam, boxes, at }),
      });
    }
  }

  for (let t = 0; t <= HEALTH_DURATION; t += HEALTH_EVERY) {
    let escalated = 0;
    if (includeMinor && t >= 15) escalated = 1;
    if (includeSevere && t >= 28) escalated = includeMinor ? 2 : 1;
    script.push({
      at: t,
      event: mkHealth({
        at: t,
        cameras_online: 6,
        cameras_total: 6,
        models_resident: true,
        gpu_util: 0.12,
        p95_ms: 42,
        frames_screened: t * FRAMES_PER_SEC,
        frames_escalated: escalated,
      }),
    });
  }

  for (let t0 = 0; t0 + 10 <= HEALTH_DURATION; t0 += 10) {
    script.push({
      at: t0 + 10,
      event: mkUsageTick({ at: t0 + 10, by_model: mockUsageWindow(t0, { includeMinor, includeSevere }) }),
    });
  }

  if (includeMinor || includeSevere) {
    pushIncidentScriptFiltered(script, { includeMinor, includeSevere });
  }

  script.sort((a, b) => a.at - b.at || 0);
  return script;
}

export function scenarioMarkers(scenarioId = "full") {
  return buildScript(scenarioId)
    .filter((row) => row.event?.type === "incident.upsert")
    .map((row) => ({
      at: row.at,
      id: row.event.incident?.incident_id,
      class_token: row.event.incident?.class_token,
      severity: row.event.incident?.severity,
    }));
}

/**
 * Deterministic scripted player. Same SCRIPT → same events every run.
 * @param {{ onEvent: (ev: object) => void, onTick?: (t: number) => void, scenarioId?: string }} opts
 */
export function createMockPlayer({ onEvent, onTick, scenarioId = "full" }) {
  let scenario = scenarioId;
  setMockEpoch(Date.now());
  let SCRIPT = buildScript(scenario);
  let speed = 1;
  let running = false;
  let t = 0;
  let idx = 0;
  let raf = 0;
  let lastWall = 0;

  function emitUpTo(time) {
    while (idx < SCRIPT.length && SCRIPT[idx].at <= time + 1e-9) {
      onEvent(SCRIPT[idx].event);
      idx += 1;
    }
  }

  function frame(now) {
    if (!running) return;
    const wall = now;
    const dt = lastWall ? ((wall - lastWall) / 1000) * speed : 0;
    lastWall = wall;
    t += dt;
    emitUpTo(t); // no-op once the script is exhausted; time keeps running
    if (onTick) onTick(t);
    raf = requestAnimationFrame(frame);
  }

  function play() {
    if (running) return;
    running = true;
    lastWall = 0;
    raf = requestAnimationFrame(frame);
  }

  function pause() {
    running = false;
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    lastWall = 0;
    if (onTick) onTick(t);
  }

  function reset() {
    pause();
    setMockEpoch(Date.now());
    SCRIPT = buildScript(scenario);
    t = 0;
    idx = 0;
    if (onTick) onTick(t);
  }

  function setSpeed(next) {
    if (next === 1 || next === 2 || next === 4) {
      speed = next;
      if (onTick) onTick(t);
    }
  }

  function seek(time) {
    const wasRunning = running;
    pause();
    t = Math.max(0, time);
    idx = 0;
    emitUpTo(t);
    if (onTick) onTick(t);
    if (wasRunning) play();
  }

  function loadScenario(id) {
    scenario = id || "full";
    reset();
  }

  /**
   * Operator took over dispatch for `id`: drop the rest of the scripted
   * dispatch, state changes and call for that incident (so nothing runs
   * twice) and schedule `rows` in their place. Pursuit (TRACKING and camera
   * handoffs) still plays; handoff upserts lose their scripted timeline so
   * the store keeps the operator's.
   */
  function operatorDispatch(id, rows) {
    const rest = [];
    for (const row of SCRIPT.slice(idx)) {
      const ev = row.event;
      const mine = ev.incident_id === id || ev.incident?.incident_id === id;
      if (!mine) rest.push(row);
      else if (ev.type === "incident.upsert") {
        rest.push({ at: row.at, event: { ...ev, incident: { ...ev.incident, timeline: [] } } });
      } else if (ev.type === "incident.state_change" && ev.state === "TRACKING") {
        rest.push(row);
      }
    }
    for (const row of rows) rest.push({ ...row, at: Math.max(row.at, t) });
    rest.sort((a, b) => a.at - b.at);
    SCRIPT = SCRIPT.slice(0, idx).concat(rest);
  }

  return {
    play,
    pause,
    reset,
    setSpeed,
    seek,
    loadScenario,
    operatorDispatch,
    getTime: () => t,
    isRunning: () => running,
    getSpeed: () => speed,
    getScenario: () => scenario,
    getScript: () => SCRIPT,
    getMarkers: () => scenarioMarkers(scenario),
    getDuration: () =>
      SCRIPT.length ? SCRIPT[SCRIPT.length - 1].at : HEALTH_DURATION,
  };
}
