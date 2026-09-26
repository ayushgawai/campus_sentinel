/**
 * Camera layout controller — grid / focus / split from store + officer override.
 * Pure placement logic; cameras.js applies geometry with transitions.
 */

import { WALL_CAMERA_IDS } from "../site.js?v=pro7";
import { compareHeroIncidents, isOpenIncident } from "../format.js?v=pro7";
import { now as clockNow } from "../clock.js?v=pro7";

const HOLD_MS = 5000;
const LEFT_VIEW_MS = 5000;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const DURATION_MS = 250;
/** Live shows ONE hero camera (no split view). */
const MAX_MAINS = 1;
/** Live watch ↔ incident move (ring ↔ hero). */
const RING_MOVE_MS = 600;

/**
 * Watch-mode ring: slot angle per camera (0° = right, clockwise, y down).
 * Six tiles in a hexagon around the round site map.
 */
const RING_SLOTS = {
  "cam-01": 180,
  "cam-02": 300,
  "cam-03": 240,
  "cam-04": 0,
  "cam-05": 120,
  "cam-06": 60,
};

/** Distance from (px, py) to the nearest point of a rect (0 inside). */
function distToRect(px, py, r) {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return Math.hypot(dx, dy);
}

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
  /** Hold resolved/dismissed camera as main until deadline (app ms, clock.js now()) */
  /** @type {Map<string, { until: number, kind: string, incidentId: string }>} */
  const holds = new Map();
  /** Subject left view notes: cameraId → untilMs */
  const leftNotes = new Map();
  /** Track last camera per incident for pursuit handoff */
  /** @type {Map<string, string>} */
  const lastCamByInc = new Map();
  let listeners = new Set();
  /** Manual override entered with zero active incidents — stays until explicit exit */
  let manualQuiet = false;
  /** app-ms deadline to auto-release a non-quiet manual override once incidents clear */
  let manualReleaseAt = null;
  let wasManualOverride = false;

  function notify() {
    for (const fn of listeners) fn();
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
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
    // Hero order: SEVERE first, then further along the response, then newest.
    list.sort(compareHeroIncidents);
    return list;
  }

  function trackPursuit(state) {
    const now = clockNow();
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
    const now = clockNow();
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
      if (h.until > now) continue;
      holds.delete(key);
      // Forget the camera too, or the next plan() would start a new hold
      // for the same closed incident and it would never return to grid.
      lastCamByInc.delete(key);
    }
  }

  function forceAuto() {
    mode = "auto";
    manualMains = [];
    manualQuiet = false;
    manualReleaseAt = null;
    notify();
  }

  /** Single header/Esc exit: back to auto grid selection. */
  const showAll = forceAuto;

  function setManualMains(ids) {
    mode = "manual";
    manualMains = ids.slice(0, MAX_MAINS);
    notify();
  }

  /** One hero on Live: the clicked camera becomes it (until Esc). */
  function swapMain(cameraId) {
    mode = "manual";
    if (manualMains.length === 1 && manualMains[0] === cameraId) {
      // already the hero — keep
    } else {
      manualMains = [cameraId];
    }
    notify();
  }

  function soloMain(cameraId) {
    mode = "manual";
    manualMains = [cameraId];
    notify();
  }

  /** Severe incident ids already seen, so only a NEW one takes the hero. */
  const seenSevere = new Set();

  /**
   * A new Severe incident always takes the hero, even over a manual pick;
   * a manual pick survives while no new Severe arrives.
   */
  function maybeSevereOverride(state) {
    const actives = activeIncidents(state);
    let fresh = null;
    for (const inc of actives) {
      if (inc.severity !== "SEVERE" || seenSevere.has(inc.incident_id)) continue;
      seenSevere.add(inc.incident_id);
      if (!fresh && inc.camera_id) fresh = inc;
    }
    if (!fresh || mode !== "manual") return;
    if (manualMains[0] !== fresh.camera_id) {
      manualMains = [fresh.camera_id];
      manualQuiet = false;
      notify();
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
    const now = clockNow();

    const inManualOverride = mode === "manual" && manualMains.length > 0;
    if (inManualOverride && !wasManualOverride) {
      // Just entered a manual override. If nothing was active, this was a
      // quiet-state enlarge — stays until the officer explicitly exits.
      manualQuiet = actives.length === 0;
      manualReleaseAt = null;
    }
    if (inManualOverride && !manualQuiet) {
      if (actives.length === 0) {
        if (manualReleaseAt == null) manualReleaseAt = now + HOLD_MS;
        else if (now >= manualReleaseAt) {
          mode = "auto";
          manualMains = [];
          manualReleaseAt = null;
        }
      } else {
        // A new incident in the release window cancels the return.
        manualReleaseAt = null;
      }
    }
    if (!(mode === "manual" && manualMains.length > 0)) {
      manualQuiet = false;
      manualReleaseAt = null;
    }
    wasManualOverride = mode === "manual" && manualMains.length > 0;

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
      // Auto: the hero from actives, else a hold
      const chosen = [];
      for (const inc of actives) {
        if (chosen.length >= MAX_MAINS) break;
        if (!inc.camera_id) continue;
        if (chosen.some((c) => c.cameraId === inc.camera_id)) continue;
        chosen.push({
          cameraId: inc.camera_id,
          incidentId: inc.incident_id,
          hold: null,
        });
      }
      for (const h of activeHolds) {
        if (chosen.length >= MAX_MAINS) break;
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
  function geometry(planResult, stageW, stageH, viewportW, opts = {}) {
    const gap = 12;
    const headerH = 48; /* matches --inc-bar-h */
    const map = new Map();
    const reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (opts.ring && planResult.mains.length === 0) {
      // Six 16:9 tiles on an ellipse around the stage centre; the site map
      // disc fills the largest circle that clears every tile.
      const W = stageW;
      const H = stageH;
      const w = Math.min(W * 0.22, ((H * 0.3) * 16) / 9);
      const h = (w * 9) / 16;
      const cx = W / 2;
      const cy = H / 2;
      const rx = W / 2 - w / 2 - 8;
      const ry = H / 2 - h / 2 - 8;
      let nearest = Infinity;
      let labelHalf = Infinity;
      WALL_CAMERA_IDS.forEach((id, i) => {
        const deg = RING_SLOTS[id] ?? i * 60;
        const a = (deg * Math.PI) / 180;
        const r = {
          x: cx + rx * Math.cos(a) - w / 2,
          y: cy + ry * Math.sin(a) - h / 2,
          w,
          h,
          role: "grid",
          headerH: 0,
          angle: deg,
        };
        map.set(id, r);
        nearest = Math.min(nearest, distToRect(cx, cy, r));
        // Lower tiles bound the room for the map note under the disc.
        if (r.y + r.h > cy && r.x + r.w > cx && r.x > cx) labelHalf = Math.min(labelHalf, r.x - cx);
        if (r.y + r.h > cy && r.x < cx && r.x + r.w < cx) labelHalf = Math.min(labelHalf, cx - (r.x + r.w));
      });
      const d = Math.max(0, Math.min(nearest * 2 - 16, Math.min(W, H) * 0.5));
      return {
        rects: map,
        reduced,
        duration: reduced ? 0 : DURATION_MS,
        ease: EASE,
        ring: {
          cx,
          cy,
          d,
          labelW: Number.isFinite(labelHalf) ? Math.max(0, labelHalf * 2 - 16) : d,
        },
      };
    }

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

    if (opts.live && planResult.mains.length) {
      // Live incident: the hero takes all the height left after the
      // tracking bar (opts.trackH) and one row of thumbnails at ~15% of
      // the column (min 96 px). The incident banner above the columns
      // replaces the old bar over the hero, so no header space here.
      const W = stageW;
      const H = stageH;
      const trackH = Math.max(0, opts.trackH || 0);
      const n = planResult.thumbs.length || 1;
      const th = Math.max(96, Math.round(H * 0.15));
      const tw = (W - gap * (n - 1)) / n;
      const trackBlock = trackH ? trackH + gap : 0;
      const hh = Math.max(40, H - th - gap - trackBlock);
      const main = planResult.mains[0];
      map.set(main.cameraId, { x: 0, y: 0, w: W, h: hh, role: "main", headerH: 0 });
      const trackY = hh + gap;
      const thumbY = trackY + trackBlock;
      planResult.thumbs.forEach((id, i) => {
        map.set(id, { x: i * (tw + gap), y: thumbY, w: tw, h: th, role: "thumb", headerH: 0 });
      });
      return {
        rects: map,
        reduced,
        duration: reduced ? 0 : DURATION_MS,
        ease: EASE,
        track: { x: 0, y: trackY, w: W, h: trackH },
      };
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
    manualQuiet = false;
    manualReleaseAt = null;
    wasManualOverride = false;
    holds.clear();
    leftNotes.clear();
    lastCamByInc.clear();
    seenSevere.clear();
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
    RING_MOVE_MS,
    EASE,
  };
}
