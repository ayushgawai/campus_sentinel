/**
 * Expanded site map (Live "Expand"): a full-screen overlay with the ONE map
 * instance in the centre, sized to the map's own aspect (no empty band),
 * and the six camera tiles (the same DOM nodes, no stream reload) around it
 * in the ring order. Tracking is drawn only on the map (the red path with
 * arrowheads); one thin leader joins the current camera's pin to its tile.
 * A slim summary strip under the title says what is happening. Everything
 * comes from the store and updates on each handoff without reopening.
 */

import { WALL_CAMERA_IDS, cameraLabel, cameraPlace } from "../site.js?v=pro3";
import { onlineCount } from "../cameraStatus.js?v=pro3";
import {
  classLabel,
  compareHeroIncidents,
  formatElapsedPlus,
  isOpenIncident,
  severityLabel,
  stateLabel,
} from "../format.js?v=pro3";
import { clear, el, setText, svgEl } from "../dom.js?v=pro3";
import { now, subscribeTick } from "../clock.js?v=pro3";
import { followedIncident, pathHops } from "../tracking.js?v=pro3";

/** Ring slot per camera (same constant as the Part 2 ring). */
const SLOT = {
  "cam-01": "left",
  "cam-02": "top-right",
  "cam-03": "top-left",
  "cam-04": "right",
  "cam-05": "bottom-left",
  "cam-06": "bottom-right",
};

const GAP = 12;
/** Pins are 24 px; keep at least this much between pin centres. */
const PIN_SPACING = 28;

/**
 * Map rect (aspect `ar`, about 46% × 58% of the stage, or up to 62% × 72%
 * when `grow` > 1 so pins don't overlap) and the tiles around it: top and
 * bottom pairs in the bands above and below, left/right beside it. One 16:9
 * size for all six, as large as the bands allow.
 */
export function expandGeometry(W, H, ar, grow = 1) {
  let mw = W * 0.46;
  let mh = H * 0.58;
  if (mw / mh > ar) mw = mh * ar;
  else mh = mw / ar;
  if (grow > 1) {
    const k = Math.min(grow, (W * 0.62) / mw, (H * 0.72) / mh);
    mw *= k;
    mh *= k;
  }
  const map = { x: (W - mw) / 2, y: (H - mh) / 2, w: mw, h: mh };
  const band = map.y - GAP * 2;
  const side = map.x - GAP * 2;
  const tw = Math.max(80, Math.min(W * 0.22, (band * 16) / 9, side));
  const th = (tw * 9) / 16;
  const cx = W / 2;
  const cy = H / 2;
  const dx = Math.min(W / 2 - tw / 2 - GAP, Math.max(tw / 2 + GAP / 2, mw / 4 + tw / 4));
  const topY = Math.max(GAP / 2, (map.y - th) / 2);
  const botY = Math.min(H - th - GAP / 2, map.y + mh + (H - (map.y + mh) - th) / 2);
  const sideX = (map.x - tw) / 2;
  const pos = {
    left: { x: sideX, y: cy - th / 2 },
    right: { x: W - sideX - tw, y: cy - th / 2 },
    "top-left": { x: cx - dx - tw / 2, y: topY },
    "top-right": { x: cx + dx - tw / 2, y: topY },
    "bottom-left": { x: cx - dx - tw / 2, y: botY },
    "bottom-right": { x: cx + dx - tw / 2, y: botY },
  };
  const rects = new Map();
  for (const id of WALL_CAMERA_IDS) {
    const p = pos[SLOT[id]] || pos.left;
    rects.set(id, { x: p.x, y: p.y, w: tw, h: th });
  }
  return { map, rects };
}

function nearestOnRect(px, py, r) {
  return {
    x: Math.min(Math.max(px, r.x), r.x + r.w),
    y: Math.min(Math.max(py, r.y), r.y + r.h),
  };
}

/**
 * @param {{ store: object, layoutCtl: object, wall: object, mapCanvas: HTMLElement }} deps
 */
export function createLiveExpand({ store, layoutCtl, wall, mapCanvas }) {
  const host = document.getElementById("map-expand");
  if (!host || !mapCanvas) return { open() {}, close() {}, isOpen: () => false };

  let isOpenNow = false;
  let returnFocus = null;
  let mapHome = null;
  let mapNext = null;
  let geo = null;
  let ro = null;
  let unsub = null;
  let unsubTick = null;
  let drawSig = "";
  let infoSig = "";
  let firstMs = NaN;
  let elapsedEl = null;
  let relayoutRaf = 0;

  function mapApi() {
    return window.__map;
  }

  /** The incident to show: the followed one, else the best open incident. */
  function shownIncident(state) {
    const f = followedIncident(state);
    if (f) return f;
    const open = state.order
      .map((id) => state.incidents[id])
      .filter((inc) => inc && isOpenIncident(inc) && (inc.severity === "SEVERE" || inc.severity === "MINOR"));
    open.sort(compareHeroIncidents);
    return open[0] || null;
  }

  function build() {
    host.hidden = false;
    host.className = "lx is-open";
    host.setAttribute("aria-hidden", "false");
    host.innerHTML = `
      <div class="lx__scrim" data-close></div>
      <div class="lx__panel" role="dialog" aria-modal="true" aria-labelledby="lx-title">
        <header class="lx__head">
          <div class="lx__titles">
            <h2 class="lx__title" id="lx-title">Site plan · live tracking</h2>
            <p class="lx__summary" data-summary aria-live="polite"></p>
          </div>
          <button type="button" class="btn btn--sm lp-headbtn lx__close" data-close-btn aria-label="Close expanded map">Close</button>
        </header>
        <div class="lx__stage" data-stage>
          <div class="lx__map" data-map></div>
          <div class="lx__tiles" data-tiles></div>
        </div>
      </div>
    `;
  }

  const q = (sel) => host.querySelector(sel);

  // ---------- Layout ----------

  /** Smallest distance between two pins on screen (px). */
  function minPinGap() {
    const pts = WALL_CAMERA_IDS.map((id) => mapApi()?.pinClientPoint?.(id)).filter(Boolean);
    let min = Infinity;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        min = Math.min(min, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
      }
    }
    return min;
  }

  function place(W, H, ar, grow) {
    geo = expandGeometry(W, H, ar, grow);
    Object.assign(q("[data-map]").style, {
      left: `${geo.map.x}px`,
      top: `${geo.map.y}px`,
      width: `${geo.map.w}px`,
      height: `${geo.map.h}px`,
    });
    wall.placeBorrowed(geo.rects);
  }

  function layout() {
    relayoutRaf = 0;
    const stage = q("[data-stage]");
    if (!stage) return;
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    // Tight crop around the pins, so they sit far enough apart.
    mapApi()?.setFit?.("pins");
    const vb = mapApi()?.getViewBox?.() || { w: 16, h: 10 };
    const ar = vb.w / vb.h;
    place(W, H, ar, 1);
    mapApi()?.refreshPinScale?.();
    // Grow the map (within limits) if any two pins would overlap.
    const gapPx = minPinGap();
    if (gapPx < PIN_SPACING) {
      place(W, H, ar, PIN_SPACING / Math.max(1, gapPx));
      mapApi()?.refreshPinScale?.();
    }
    drawSig = "";
    requestAnimationFrame(() => {
      mapApi()?.refreshPinScale?.();
      paint(store.getState());
    });
  }

  function scheduleLayout() {
    if (relayoutRaf) return;
    relayoutRaf = requestAnimationFrame(layout);
  }

  // ---------- The one leader line: current camera pin → its tile ----------

  function paintLeader(state) {
    const stage = q("[data-stage]");
    const svgHost = q("[data-tiles]");
    if (!stage || !geo) return;
    const inc = shownIncident(state);
    const current = inc?.camera_id || null;
    const sig = `${stage.clientWidth}x${stage.clientHeight}|${current || ""}|${geo.map.w}`;
    if (sig === drawSig) return;
    drawSig = sig;
    let svg = svgHost.querySelector(".lx__lines");
    if (!svg) {
      svg = svgEl("svg", { class: "lx__lines", "aria-hidden": "true" });
      svgHost.insertBefore(svg, svgHost.firstChild);
    }
    clear(svg);
    if (!current) return;
    const r = geo.rects.get(current);
    const p = mapApi()?.pinClientPoint?.(current);
    if (!r || !p) return;
    const origin = stage.getBoundingClientRect();
    const px = p.x - origin.left;
    const py = p.y - origin.top;
    const end = nearestOnRect(px, py, r);
    const g = svgEl("g", {
      class: `lx__leader lx__leader--${inc.severity === "SEVERE" ? "severe" : "minor"}`,
      "data-camera-id": current,
    });
    g.appendChild(svgEl("line", { x1: px.toFixed(1), y1: py.toFixed(1), x2: end.x.toFixed(1), y2: end.y.toFixed(1) }));
    g.appendChild(svgEl("circle", { cx: end.x.toFixed(1), cy: end.y.toFixed(1), r: "3" }));
    svg.appendChild(g);
  }

  // ---------- Summary strip ----------

  function part(parent, cls, text) {
    parent.appendChild(el("span", { className: cls, text }));
  }

  function paintSummary(state) {
    const box = q("[data-summary]");
    const inc = shownIncident(state);
    const { hops, earlier } = inc ? pathHops(state, inc) : { hops: [], earlier: 0 };
    const online = onlineCount(state, WALL_CAMERA_IDS);
    const sig = inc
      ? [inc.incident_id, inc.state, inc.severity, inc.camera_id, earlier, hops.map((h) => h.cameraId).join(",")].join("|")
      : `none|${online}`;
    if (sig === infoSig) return;
    infoSig = sig;
    clear(box);
    elapsedEl = null;
    if (!inc) {
      part(box, "lx__sum-strong", "No active incident");
      part(box, "lx__sum mono", `${online}/${WALL_CAMERA_IDS.length} online`);
      return;
    }
    const sev = inc.severity === "SEVERE" ? "severe" : "minor";
    part(box, "lx__sum-strong", classLabel(inc.class_token));
    box.appendChild(el("span", { className: `lp-pill lp-pill--${sev}`, text: severityLabel(inc.severity) }));
    box.appendChild(el("span", { className: "lp-pill lp-pill--state", text: stateLabel(inc.state) }));
    const place = cameraPlace(inc.camera_id);
    part(box, "lx__sum", `Now: ${cameraLabel(inc.camera_id)}${place ? ` · ${place}` : ""}`);
    const nums = hops.map((h) => String(cameraLabel(h.cameraId)).replace(/^Camera\s*/, ""));
    if (nums.length > 1) part(box, "lx__sum mono", `Path ${earlier ? "… → " : ""}${nums.join(" → ")}`);
    firstMs = Date.parse(inc.created_at || inc.peak_ts || "");
    if (!Number.isNaN(firstMs)) {
      elapsedEl = el("span", { className: "lx__sum mono" });
      box.appendChild(elapsedEl);
      paintTimes();
    }
  }

  function paintTimes(nowMs = now()) {
    if (!elapsedEl || Number.isNaN(firstMs)) return;
    setText(elapsedEl, formatElapsedPlus((nowMs - firstMs) / 1000));
  }

  function paint(state) {
    if (!isOpenNow) return;
    paintLeader(state);
    paintSummary(state);
  }

  // ---------- Focus trap ----------

  function focusables() {
    return [...host.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])')].filter(
      (n) => !n.disabled && n.offsetParent !== null,
    );
  }

  function onKey(e) {
    if (e.key !== "Tab") return;
    const list = focusables();
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (!host.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    }
  }

  /** A tile click closes the view and makes that camera the hero. */
  function onTileClick(e) {
    const tile = e.target.closest?.(".cam-tile");
    if (!tile) return;
    e.stopPropagation();
    e.preventDefault();
    const id = tile.dataset.cameraId;
    close();
    if (id) layoutCtl?.swapMain?.(id);
  }

  // ---------- Open / close ----------

  function open(opener) {
    if (isOpenNow) return;
    isOpenNow = true;
    returnFocus = opener || document.activeElement;
    build();
    mapHome = mapCanvas.parentElement;
    mapNext = mapCanvas.nextSibling;
    q("[data-map]").appendChild(mapCanvas);
    wall.borrowTiles(q("[data-tiles]"));
    mapApi()?.setPinPx?.(true);
    q("[data-tiles]").addEventListener("click", onTileClick, true);
    host.querySelector("[data-close]").addEventListener("click", close);
    host.querySelector("[data-close-btn]").addEventListener("click", close);
    host.addEventListener("keydown", onKey);
    host._close = close;
    ro = new ResizeObserver(scheduleLayout);
    ro.observe(q("[data-stage]"));
    layout();
    unsub = store.subscribe(paint);
    unsubTick = subscribeTick(paintTimes);
    q("[data-close-btn]").focus({ preventScroll: true });
    document.body.classList.add("lx-open");
  }

  function close() {
    if (!isOpenNow) return;
    isOpenNow = false;
    unsub?.();
    unsubTick?.();
    ro?.disconnect();
    if (relayoutRaf) cancelAnimationFrame(relayoutRaf);
    relayoutRaf = 0;
    // Tiles and map back where they were; the map back to its normal fit.
    wall.returnTiles();
    if (mapHome) mapHome.insertBefore(mapCanvas, mapNext && mapNext.parentNode === mapHome ? mapNext : null);
    mapApi()?.setPinPx?.(false);
    mapApi()?.setFit?.("default");
    host.removeEventListener("keydown", onKey);
    clear(host);
    host.className = "";
    host.hidden = true;
    host.setAttribute("aria-hidden", "true");
    host._close = null;
    drawSig = "";
    infoSig = "";
    document.body.classList.remove("lx-open");
    returnFocus?.focus?.({ preventScroll: true });
  }

  return { open, close, isOpen: () => isOpenNow };
}
