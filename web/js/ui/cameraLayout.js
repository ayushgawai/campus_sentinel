/**
 * Camera layout controller — grid / focus / split from store + officer override.
 * Pure placement logic; cameras.js applies geometry with transitions.
 */

import { WALL_CAMERA_IDS } from "../site.js";
import { isOpenIncident } from "../format.js";

const HOLD_MS = 4000;
const LEFT_VIEW_MS = 5000;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const DURATION_MS = 250;

/**
 * @typedef {{
 *   mode: 'grid'|'focus'|'split',
 *   mains: { cameraId: string, incidentId: string|null, hold?: 'RESOLVED'|'DISMISSED'|null }[],
 *   thumbs: string[],
 *   moreCount: number,
 *   leftNotes: Map<string, number>,
 *   auto: boolean,
 * }} LayoutPlan
 */

export function createCameraLayout() {
  /** @type {'auto'|'manual'} */
  let mode = "auto";
  /** @type {string[]} manual main camera ids (1 or 2) */
  let manualMains = [];
  /** Hold resolved/dismissed camera as main until deadline (demo ms) */
  /** @type {Map<string, { until: number, kind: string, incidentId: string }>} */
  const holds = new Map();
  /** Subject left view notes: cameraId → untilMs */
  const leftNotes = new Map();
  /** Track last camera per incident for pursuit handoff */
  /** @type {Map<string, string>} */
  const lastCamByInc = new Map();
  let listeners = new Set();

  function notify() {
    for (const fn of listeners) fn();
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function demoNowMs(state) {
    // wall clock for holds when not in demo — use performance
    const t = state.demo?.t;
    if (t != null) return t * 1000;
    return performance.now();
  }

  function activeIncidents(state) {
    const list = [];
    for (const id of state.order) {
      const inc = state.incidents[id];
      if (!inc) continue;
      if (!isOpenIncident(inc)) continue;
      if (inc.severity !== "SEVERE" && inc.severity !== "MINOR") continue;
      list.push(inc);
    }
    list.sort((a, b) => {
      const sa = a.severity === "SEVERE" ? 0 : 1;
      const sb = b.severity === "SEVERE" ? 0 : 1;
      if (sa !== sb) return sa - sb;
      const ta = Date.parse(a.updated_at || a.created_at || a.peak_ts || 0) || 0;
      const tb = Date.parse(b.updated_at || b.created_at || b.peak_ts || 0) || 0;
      return tb - ta;
    });
    return list;
  }

  function trackPursuit(state) {
    const now = demoNowMs(state);
    for (const inc of activeIncidents(state)) {
      const cam = inc.camera_id;
      if (!cam) continue;
      const prev = lastCamByInc.get(inc.incident_id);
      if (prev && prev !== cam && inc.state === "TRACKING") {
        leftNotes.set(prev, now + LEFT_VIEW_MS);
      }
      lastCamByInc.set(inc.incident_id, cam);
    }
    // prune left notes
    for (const [cam, until] of leftNotes) {
      if (until <= now) leftNotes.delete(cam);
    }
  }

  function updateHolds(state) {
    const now = demoNowMs(state);
    for (const [id, inc] of Object.entries(state.incidents)) {
      if (!inc?.camera_id) continue;
      if (inc.state !== "RESOLVED" && inc.state !== "DISMISSED") {
        holds.delete(id);
        continue;
      }
      if (!holds.has(id) && lastCamByInc.has(id)) {
        holds.set(id, {
          until: now + HOLD_MS,
          kind: inc.state,
          incidentId: id,
          cameraId: inc.camera_id,
        });
      }
    }
    for (const [key, h] of [...holds.entries()]) {
      if (h.until <= now) holds.delete(key);
    }
  }

  function forceAuto() {
    mode = "auto";
    manualMains = [];
    notify();
  }

  function showAll() {
    mode = "manual";
    manualMains = [];
    notify();
  }

  function setManualMains(ids) {
    mode = "manual";
    manualMains = ids.slice(0, 2);
    notify();
  }

  function swapMain(cameraId) {
    mode = "manual";
    if (manualMains.length === 0) {
      manualMains = [cameraId];
    } else if (manualMains.includes(cameraId)) {
      // already main — keep
    } else if (manualMains.length === 1) {
      manualMains = [cameraId];
    } else {
      // replace secondary
      manualMains = [manualMains[0], cameraId];
    }
    notify();
  }

  function soloMain(cameraId) {
    mode = "manual";
    manualMains = [cameraId];
    notify();
  }

  /**
   * On new Severe while manual — always take main.
   */
  function maybeSevereOverride(state) {
    const actives = activeIncidents(state);
    const severe = actives.find((i) => i.severity === "SEVERE");
    if (!severe?.camera_id) return;
    if (mode === "manual") {
      // New severe always takes main
      if (!manualMains.includes(severe.camera_id)) {
        manualMains = [severe.camera_id, ...manualMains.filter((c) => c !== severe.camera_id)].slice(0, 2);
        notify();
      }
    }
  }

  /**
   * @returns {LayoutPlan}
   */
  function plan(state) {
    trackPursuit(state);
    updateHolds(state);
    maybeSevereOverride(state);

    const actives = activeIncidents(state);
    const now = demoNowMs(state);

    /** Active hold entries still valid */
    const activeHolds = [...holds.values()].filter((h) => h.until > now);

    let mains = [];
    let auto = mode === "auto";

    if (mode === "manual" && manualMains.length === 0) {
      // Show all = grid
      return {
        mode: "grid",
        mains: [],
        thumbs: WALL_CAMERA_IDS.slice(),
        moreCount: 0,
        leftNotes: new Map(leftNotes),
        auto: false,
      };
    }

    if (mode === "manual" && manualMains.length) {
      mains = manualMains.map((cameraId) => {
        const inc = actives.find((i) => i.camera_id === cameraId) || null;
        return {
          cameraId,
          incidentId: inc?.incident_id ?? null,
          hold: null,
        };
      });
    } else {
      // Auto: up to 2 from actives + holds
      const chosen = [];
      for (const inc of actives) {
        if (chosen.length >= 2) break;
        if (!inc.camera_id) continue;
        if (chosen.some((c) => c.cameraId === inc.camera_id)) continue;
        chosen.push({
          cameraId: inc.camera_id,
          incidentId: inc.incident_id,
          hold: null,
        });
      }
      for (const h of activeHolds) {
        if (chosen.length >= 2) break;
        if (chosen.some((c) => c.cameraId === h.cameraId)) continue;
        chosen.push({
          cameraId: h.cameraId,
          incidentId: h.incidentId,
          hold: h.kind,
        });
      }
      mains = chosen;
    }

    const mainCams = new Set(mains.map((m) => m.cameraId));
    const thumbs = WALL_CAMERA_IDS.filter((id) => !mainCams.has(id));

    // Incidents not represented in mains
    const coveredInc = new Set(mains.map((m) => m.incidentId).filter(Boolean));
    const moreCount = actives.filter((i) => !coveredInc.has(i.incident_id)).length;

    let layoutMode = "grid";
    if (mains.length === 1) layoutMode = "focus";
    else if (mains.length >= 2) layoutMode = "split";

    return {
      mode: layoutMode,
      mains,
      thumbs,
      moreCount,
      leftNotes: new Map(leftNotes),
      auto,
    };
  }

  /**
   * Compute pixel rects for a stage size.
   * @returns {Map<string, {x:number,y:number,w:number,h:number,role:string,headerH:number}>}
   */
  function geometry(planResult, stageW, stageH, viewportW) {
    const gap = 12;
    const headerH = 48; /* matches --inc-bar-h */
    const map = new Map();
    const reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (planResult.mode === "grid" || planResult.mains.length === 0) {
      // 3×2 filling the stage (tiles fill cells; ~16:9 on typical consoles)
      const cols = 3;
      const rows = 2;
      const tw = (stageW - gap * (cols - 1)) / cols;
      const th = (stageH - gap * (rows - 1)) / rows;
      WALL_CAMERA_IDS.forEach((id, i) => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        map.set(id, {
          x: c * (tw + gap),
          y: r * (th + gap),
          w: tw,
          h: th,
          role: "grid",
          headerH: 0,
        });
      });
      return { rects: map, reduced, duration: reduced ? 0 : DURATION_MS, ease: EASE };
    }

    const stripBottom = viewportW <= 1280 && planResult.mode === "focus";
    const stripSize = stripBottom
      ? Math.min(110, Math.floor(stageH * 0.22))
      : Math.min(200, Math.floor(stageW * 0.22));

    if (planResult.mode === "focus") {
      const main = planResult.mains[0];
      if (stripBottom) {
        const mainH = stageH - stripSize - gap - headerH;
        map.set(main.cameraId, {
          x: 0,
          y: headerH,
          w: stageW,
          h: mainH,
          role: "main",
          headerH,
        });
        const n = planResult.thumbs.length || 1;
        const tw = (stageW - gap * (n - 1)) / n;
        planResult.thumbs.forEach((id, i) => {
          map.set(id, {
            x: i * (tw + gap),
            y: headerH + mainH + gap,
            w: tw,
            h: stripSize,
            role: "thumb",
            headerH: 0,
          });
        });
      } else {
        // Side strip: main keeps room for its incident bar; thumbs fill the
        // full column height (no dead band matching the main header).
        const mainW = stageW - stripSize - gap;
        map.set(main.cameraId, {
          x: 0,
          y: headerH,
          w: mainW,
          h: stageH - headerH,
          role: "main",
          headerH,
        });
        const n = planResult.thumbs.length || 1;
        const th = (stageH - gap * (n - 1)) / n;
        planResult.thumbs.forEach((id, i) => {
          map.set(id, {
            x: mainW + gap,
            y: i * (th + gap),
            w: stripSize,
            h: th,
            role: "thumb",
            headerH: 0,
          });
        });
      }
      return { rects: map, reduced, duration: reduced ? 0 : DURATION_MS, ease: EASE };
    }

    // split: two mains on top, thumbs below
    const thumbH = Math.min(120, Math.floor(stageH * 0.22));
    const mainAreaH = stageH - thumbH - gap;
    const mainW = (stageW - gap) / 2;
    planResult.mains.forEach((m, i) => {
      map.set(m.cameraId, {
        x: i * (mainW + gap),
        y: headerH,
        w: mainW,
        h: mainAreaH - headerH,
        role: "main",
        headerH,
      });
    });
    const n = planResult.thumbs.length || 1;
    const tw = (stageW - gap * (n - 1)) / n;
    planResult.thumbs.forEach((id, i) => {
      map.set(id, {
        x: i * (tw + gap),
        y: mainAreaH + gap,
        w: tw,
        h: thumbH,
        role: "thumb",
        headerH: 0,
      });
    });
    return { rects: map, reduced, duration: reduced ? 0 : DURATION_MS, ease: EASE };
  }

  function resetMemory() {
    mode = "auto";
    manualMains = [];
    holds.clear();
    leftNotes.clear();
    lastCamByInc.clear();
    notify();
  }

  return {
    subscribe,
    plan,
    geometry,
    forceAuto,
    showAll,
    setManualMains,
    swapMain,
    soloMain,
    resetMemory,
    isAuto: () => mode === "auto",
    getManualMains: () => manualMains.slice(),
    DURATION_MS,
    EASE,
  };
}
