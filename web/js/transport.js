/** Event source: mock timeline by default, or WebSocket via ?ws=<url>. */

import { createMockPlayer, atIso, predictedCameraAt } from "./mock.js";
import { validateEvent } from "./validate.js";
import { setMode, setMockT, sampleServerTime } from "./clock.js";

const BACKOFFS = [1000, 2000, 5000];
// Reconnect replays old incidents/transcript with their original ts; only
// sample the clock offset from events that are always stamped "now".
const LIVE_TS_TYPES = new Set(["health.strip", "overlay.boxes", "camera.online"]);

function wsUrlFromSearch() {
  if (typeof location === "undefined") return null;
  const raw = new URLSearchParams(location.search).get("ws");
  if (!raw) return null;
  return raw;
}

export function cameraStream(cameraId, wsUrl = wsUrlFromSearch()) {
  if (!wsUrl) return null;
  try {
    const base = new URL(wsUrl);
    base.protocol = base.protocol === "wss:" ? "https:" : "http:";
    const video = ["cam-04", "cam-05", "cam-06"].includes(cameraId);
    return {
      kind: video ? "video" : "mjpeg",
      url: `${base.origin}/${video ? "media" : "mjpeg"}/${encodeURIComponent(cameraId)}`,
    };
  } catch {
    return null;
  }
}

function safeHandle(handler, raw) {
  const ev = validateEvent(raw);
  if (!ev) {
    if (raw && typeof raw === "object" && raw.type) {
      console.warn("[transport] ignored invalid event", raw.type);
    } else {
      console.warn("[transport] ignored non-event payload");
    }
    return;
  }
  handler(ev);
}

/**
 * @param {(event: object) => void} handler
 * @param {{
 *   setConnection?: (status: 'MOCK'|'LIVE'|'RECONNECTING') => void,
 *   setDemo?: (partial: object) => void,
 *   softReset?: () => void,
 *   holdMockPlayback?: boolean,
 * }} [hooks]
 */
export function start(handler, hooks = {}) {
  const { setConnection, setDemo, softReset, flush, holdMockPlayback } = hooks;
  const wsUrl = wsUrlFromSearch();

  function emitControl(action, scenario_id = null) {
    safeHandle(handler, {
      type: "demo.control",
      action,
      scenario_id,
      ts: atIso(0),
    });
  }

  if (!wsUrl) {
    setMode("MOCK");
    if (setConnection) setConnection("MOCK");
    /** @type {ReturnType<typeof createMockPlayer> | null} */
    let player = null;
    player = createMockPlayer({
      onEvent: (ev) => safeHandle(handler, ev),
      onTick: (t) => {
        setMockT(t);
        if (setDemo && player) {
          setDemo({
            t,
            running: player.isRunning(),
            speed: player.getSpeed(),
            scenario: player.getScenario(),
          });
        }
        // Mock-only: dashed ring on predicted next camera a few seconds early
        const pred = predictedCameraAt(t);
        if (window.__map?.highlightPredicted) {
          window.__map.highlightPredicted(pred);
        }
      },
      scenarioId: "full",
    });
    if (setDemo) {
      setDemo({
        t: 0,
        running: !holdMockPlayback,
        speed: 1,
        scenario: "full",
      });
    }
    if (!holdMockPlayback) {
      player.play();
      console.info("[transport] mock source started", {
        events: player.getScript().length,
      });
    } else {
      console.info("[transport] mock source held for splash", {
        events: player.getScript().length,
      });
    }

    function clearExtras() {
      if (typeof softReset === "function") softReset();
      if (window.__map?.clearPredicted) window.__map.clearPredicted();
      if (window.__map?.clearPursuit) window.__map.clearPursuit();
      if (typeof flush === "function") flush();
    }

    return {
      mode: "MOCK",
      player,
      resetDemo() {
        clearExtras();
        player.reset();
        emitControl("reset");
        player.play();
        if (setDemo) {
          setDemo({
            t: 0,
            running: true,
            speed: player.getSpeed(),
            scenario: player.getScenario(),
          });
        }
      },
      setScenario(id) {
        clearExtras();
        player.loadScenario(id);
        emitControl("scenario", id);
        player.play();
        if (setDemo) {
          setDemo({
            t: 0,
            running: true,
            speed: player.getSpeed(),
            scenario: id,
          });
        }
      },
      prewarm() {
        emitControl("prewarm");
        safeHandle(handler, {
          type: "health.strip",
          cameras_online: 6,
          cameras_total: 6,
          models_resident: true,
          gpu_util: 0.12,
          p95_ms: 42,
          frames_screened: 0,
          frames_escalated: 0,
          ts: atIso(player.getTime()),
        });
      },
      play: () => player.play(),
      pause: () => player.pause(),
      setSpeed: (s) => player.setSpeed(s),
      seek(t) {
        clearExtras();
        player.seek(t);
        if (typeof flush === "function") flush();
      },
      stop() {
        player.pause();
        if (setDemo) setDemo({ running: false });
      },
      /** Test hook: inject raw payloads through the same validator. */
      inject(raw) {
        safeHandle(handler, raw);
      },
      /** Operator dispatch: replace the scripted call for `id` with `rows`. */
      operatorDispatch(id, rows) {
        player.operatorDispatch(id, rows);
      },
      getTime: () => player.getTime(),
    };
  }

  setMode("LIVE");
  let socket = null;
  let closed = false;
  let attempt = 0;
  let timer = 0;

  function sendControl(action, scenario_id = null) {
    const msg = {
      type: "demo.control",
      action,
      scenario_id,
      ts: new Date().toISOString(),
    };
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    } else {
      console.warn("[transport] ws not open; demo.control not sent", msg);
    }
    safeHandle(handler, msg);
  }

  function connect() {
    if (closed) return;
    if (setConnection) setConnection(attempt === 0 ? "LIVE" : "RECONNECTING");
    console.info("[transport] websocket connecting", wsUrl, "attempt", attempt);
    socket = new WebSocket(wsUrl);

    socket.addEventListener("open", () => {
      attempt = 0;
      if (setConnection) setConnection("LIVE");
      console.info("[transport] websocket open");
    });

    socket.addEventListener("message", (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (LIVE_TS_TYPES.has(data?.type)) sampleServerTime(data.ts);
        safeHandle(handler, data);
      } catch (err) {
        console.warn("[transport] bad JSON message", err);
      }
    });

    socket.addEventListener("close", () => {
      if (closed) return;
      if (setConnection) setConnection("RECONNECTING");
      const delay = BACKOFFS[Math.min(attempt, BACKOFFS.length - 1)];
      attempt += 1;
      console.warn("[transport] websocket closed; reconnect in", delay, "ms");
      timer = window.setTimeout(connect, delay);
    });

    socket.addEventListener("error", () => {});
  }

  connect();

  return {
    mode: "WS",
    player: null,
    resetDemo() {
      if (typeof softReset === "function") softReset();
      if (window.__map?.clearPredicted) window.__map.clearPredicted();
      if (window.__map?.clearPursuit) window.__map.clearPursuit();
      sendControl("reset");
    },
    setScenario(id) {
      sendControl("scenario", id);
    },
    prewarm() {
      sendControl("prewarm");
    },
    play() {},
    pause() {},
    setSpeed() {},
    seek() {},
    inject(raw) {
      safeHandle(handler, raw);
    },
    stop() {
      closed = true;
      if (timer) window.clearTimeout(timer);
      if (socket) {
        socket.close();
        socket = null;
      }
    },
  };
}
