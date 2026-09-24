/* Mock event source.
 *
 * Publishes exactly the envelopes defined in contracts/events.py so the UI
 * never learns it is running on fake data. Also accepts the operator commands
 * the live source will eventually forward to services/api.
 */

import { config } from '../config.js';
import { EventType } from '../contracts.js';
import {
  CAMERAS,
  TRACK_COUNTS,
  starterIncidents,
  incidentFromScenario,
  resetSeq,
  callBriefFor,
  callScriptFor,
  runCallTool,
  fillLine,
} from './fixtures.js';

/** Deterministic PRNG so the demo looks identical run to run. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WALL = CAMERAS.filter((c) => c.onWall).map((c) => c.id);

/** One simulated person walking inside a pane. */
function makeTrack(rand, index) {
  return {
    trackId: `T-${index + 1}`,
    w: 0.07 + rand() * 0.06,
    h: 0.20 + rand() * 0.16,
    x: 0.08 + rand() * 0.74,
    y: 0.30 + rand() * 0.42,
    vx: (rand() - 0.5) * 0.010,
    vy: (rand() - 0.5) * 0.004,
    score: 0.32 + rand() * 0.62,
  };
}

function stepTrack(t, rand) {
  t.x += t.vx;
  t.y += t.vy;

  if (t.x < 0.02 || t.x + t.w > 0.98) {
    t.vx *= -1;
    t.x = Math.min(Math.max(t.x, 0.02), 0.98 - t.w);
  }
  if (t.y < 0.16 || t.y + t.h > 0.97) {
    t.vy *= -1;
    t.y = Math.min(Math.max(t.y, 0.16), 0.97 - t.h);
  }

  // gentle confidence drift, clamped
  t.score = Math.min(0.97, Math.max(0.28, t.score + (rand() - 0.5) * 0.03));
}

export function createMockSource(bus) {
  const rand = mulberry32(20260923);

  /** cameraId -> track list */
  const scenes = new Map(
    WALL.map((id) => [
      id,
      Array.from({ length: TRACK_COUNTS[id] || 2 }, (_, i) => makeTrack(rand, i)),
    ])
  );

  let framesScreened = 2842232;
  let framesEscalated = 17;
  let gpuUtil = 0.68;
  let gpuTemp = 71;
  let p95 = 182;

  let healthTimer = null;
  let overlayTimer = null;
  let paused = false;
  /** pending call-script timers, so reset can cancel a call mid-flight */
  let callTimers = [];

  function nowIso() {
    return new Date().toISOString();
  }

  /* ---------------- publishers ---------------- */

  function publishIncident(dict) {
    bus.publish({ type: EventType.INCIDENT_UPSERT, incident: dict });
  }

  function publishCamerasOnline() {
    for (const cam of CAMERAS) {
      bus.publish({
        type: EventType.CAMERA_ONLINE,
        camera_id: cam.id,
        online: true,
        ts: nowIso(),
      });
    }
  }

  function publishHealth() {
    framesScreened += config.FRAMES_PER_SEC;
    gpuUtil = Math.min(0.94, Math.max(0.41, gpuUtil + (rand() - 0.5) * 0.05));
    gpuTemp = Math.min(79, Math.max(62, gpuTemp + (rand() - 0.5) * 1.1));
    p95 = Math.min(240, Math.max(150, p95 + (rand() - 0.5) * 9));

    bus.publish({
      type: EventType.HEALTH_STRIP,
      cameras_online: CAMERAS.length,
      cameras_total: CAMERAS.length,
      models_resident: true,
      gpu_util: gpuUtil,
      p95_ms: Math.round(p95),
      frames_screened: framesScreened,
      frames_escalated: framesEscalated,
      ts: nowIso(),
      // display-only extras; the real api will not send these
      models_count: 4,
      gpu_temp_c: Math.round(gpuTemp),
    });
  }

  function publishOverlays() {
    for (const [cameraId, tracks] of scenes) {
      for (const t of tracks) stepTrack(t, rand);

      bus.publish({
        type: EventType.OVERLAY_BOXES,
        camera_id: cameraId,
        ts: nowIso(),
        boxes: tracks.map((t) => ({
          x: Number(t.x.toFixed(4)),
          y: Number(t.y.toFixed(4)),
          w: Number(t.w.toFixed(4)),
          h: Number(t.h.toFixed(4)),
          track_id: t.trackId,
          label: 'person',
          score: Number(t.score.toFixed(2)),
        })),
      });
    }
  }

  /* ---------------- timers ---------------- */

  function startTimers() {
    stopTimers();
    healthTimer = setInterval(publishHealth, config.HEALTH_TICK_MS);
    overlayTimer = setInterval(publishOverlays, config.OVERLAY_TICK_MS);
  }

  function stopTimers() {
    if (healthTimer) clearInterval(healthTimer);
    if (overlayTimer) clearInterval(overlayTimer);
    healthTimer = null;
    overlayTimer = null;
  }

  /* ---------------- call playback ---------------- */

  function cancelCall() {
    for (const t of callTimers) clearTimeout(t);
    callTimers = [];
  }

  /**
   * Play a scripted dispatcher/Sentinel exchange, publishing
   * call.transcript_delta and tool.call_live as it goes.
   *
   * In production the voice service drives this from real ASR and the brain's
   * agentic loop. The wire events are identical, so the console does not care.
   * Returns the Call Brief the console should display.
   */
  function startCall(incidentDict) {
    cancelCall();

    const brief = callBriefFor(incidentDict);
    const script = callScriptFor(incidentDict.class_token);

    let at = 0;
    for (const step of script) {
      at += step.after;
      callTimers.push(setTimeout(() => {
        const now = new Date();

        if (step.tool) {
          const { args, result } = runCallTool(step.tool, brief, incidentDict, now);
          bus.publish({
            type: EventType.TOOL_CALL_LIVE,
            incident_id: incidentDict.incident_id,
            tool: step.tool,
            args,
            result,
            ts: now.toISOString(),
          });
          return;
        }

        bus.publish({
          type: EventType.CALL_TRANSCRIPT_DELTA,
          incident_id: incidentDict.incident_id,
          speaker: step.speaker,
          text: step.speaker === 'sentinel'
            ? fillLine(step.text, brief, incidentDict, now)
            : step.text,
          ts: now.toISOString(),
        });
      }, at));
    }

    return { brief, durationMs: at };
  }

  /* ---------------- source interface ---------------- */

  function seed() {
    publishCamerasOnline();
    for (const dict of starterIncidents()) publishIncident(dict);
    publishHealth();
    publishOverlays();
  }

  return {
    kind: 'mock',

    start() {
      seed();
      startTimers();
    },

    stop() {
      stopTimers();
      cancelCall();
    },

    startCall,
    cancelCall,

    /** Freezing the feeds also freezes the frames-screened counter, because
     *  the health tick is what advances it. */
    setPaused(next) {
      paused = next;
      if (paused) stopTimers();
      else startTimers();
      return paused;
    },

    isPaused() {
      return paused;
    },

    /** Stage a fresh incident. Returns the incident_id it created. */
    runScenario(scenarioId) {
      const dict = incidentFromScenario(scenarioId);
      framesEscalated += 1;
      publishIncident(dict);
      bus.publish({
        type: EventType.DEMO_CONTROL,
        action: 'scenario',
        scenario_id: scenarioId,
        ts: nowIso(),
      });
      return dict.incident_id;
    },

    /** Operator action -> one legal state transition. */
    sendStateChange(incidentId, nextState, note) {
      bus.publish({
        type: EventType.INCIDENT_STATE_CHANGE,
        incident_id: incidentId,
        state: nextState,
        severity: null,
        ts: nowIso(),
        note: note || '',
      });
    },

    /** Back to t=0 with the three starter incidents. */
    reset() {
      cancelCall();
      resetSeq();
      framesScreened = 2842232;
      framesEscalated = 17;
      bus.publish({
        type: EventType.DEMO_CONTROL,
        action: 'reset',
        scenario_id: null,
        ts: nowIso(),
      });
      publishCamerasOnline();
      publishHealth();
    },

    /** The starter set, used by the reset path in app.js. */
    starters: starterIncidents,
  };
}
