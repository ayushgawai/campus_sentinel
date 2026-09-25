/**
 * Live page shell. Two modes, set on #page-live[data-mode] by cameras.js
 * from layoutCtl.plan() (the one place the camera layout is applied):
 *   watch    — no main camera: the camera stage fills the page.
 *   incident — one or more main cameras (auto or manual): incident column
 *              left, cameras + tracking card centre, site map + call right.
 * Mounts the existing components into those columns. The site map is ONE
 * instance whose card node moves between the ring centre (watch) and the
 * top of the right column (incident), so window.__map stays correct.
 * In watch mode the six tiles sit in a hexagon ring (cameraLayout ring
 * geometry) around the map, shown as a disc, with a dashed leader line from
 * each pin to its tile.
 */

import { WALL_CAMERA_IDS } from "../site.js?v=live2";
import { cameraStatus, onlineCount } from "../cameraStatus.js?v=live2";
import { clear, el, setText, svgEl } from "../dom.js?v=live2";
import { mountMap } from "./map.js?v=live2";
import { legendMarkup, mountTrackingCard } from "./sitePlanExtras.js?v=live2";
import { mountCallHost } from "./call.js?v=live2";
import { mountIncidentPanel } from "./sidebar.js?v=live2";
import {
  LIVE_MODE_EVENT,
  LIVE_RING_EVENT,
  MORE_INCIDENTS_EVENT,
  OPEN_SIDEBAR_EVENT,
} from "./cameras.js?v=live2";

export function mountLive(page, store, actions, layoutCtl) {
  if (!page) return () => {};
  if (!page.dataset.mode) page.dataset.mode = "watch";

  const leftHost = page.querySelector("[data-live-left]");
  const trackHost = page.querySelector("[data-live-track]");
  const ringCentre = page.querySelector("[data-live-ring-centre]");
  const mapSlot = page.querySelector("[data-live-map-slot]");
  const callHost = page.querySelector("[data-live-call]");

  const isLiveRoute = () => document.body.classList.contains("route-live");
  const isIncident = () => page.dataset.mode === "incident";

  // Left: incident list and detail (same component as the sidebar panel).
  const incidentsHost = el("div", { className: "live-incidents" });
  leftHost.appendChild(incidentsHost);
  const incidentPanel = mountIncidentPanel(incidentsHost, store, actions, layoutCtl, {
    isVisible: () => isLiveRoute() && isIncident(),
  });

  // Site map: the sidebar's Site plan card, mounted once.
  const mapCard = el("div", { className: "card card--compact site-map-card live-map-card" });
  const mapHead = el("div", { className: "site-card__head" });
  const mapTitles = el("div", { className: "site-card__titles" });
  mapTitles.appendChild(el("h3", { className: "site-card__title", text: "Site plan" }));
  const mapSub = el("span", { className: "site-card__meta" });
  mapTitles.appendChild(mapSub);
  mapHead.appendChild(mapTitles);
  mapCard.appendChild(mapHead);
  const mapCanvas = el("div", { className: "map-canvas" });
  const mapHost = el("div", { className: "sidebar-map" });
  mapCanvas.appendChild(mapHost);
  mapCard.appendChild(mapCanvas);
  const legend = el("div", { className: "site-legend" });
  legend.innerHTML = legendMarkup();
  mapCard.appendChild(legend);
  const unmountMap = mountMap(mapHost, store, actions, {
    showTip: false,
    fillHeight: true,
    showHeader: false,
  });

  // Ring centre dock and leader lines live inside the camera stage, under
  // the tiles (DOM order: leaders, dock, then the camera slots).
  const camStage = page.querySelector("#cameras [data-stage]");
  const leaders = svgEl("svg", { class: "live-leaders", "aria-hidden": "true" });
  if (camStage) {
    camStage.insertBefore(ringCentre, camStage.firstChild);
    camStage.insertBefore(leaders, ringCentre);
  }

  const reducedMotion = () =>
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  const LEAVE_MS = 250;

  /** Latest watch geometry from cameras.js (target rects, not animated). */
  let ring = null;
  let rects = null;
  let leaderTimer = 0;
  let leaveTimer = 0;
  let leaderSig = "";
  /** End of the current ring ↔ incident move (performance.now ms). */
  let moveUntil = 0;

  function mapApi() {
    return window.__map;
  }

  function placeMap() {
    window.clearTimeout(leaveTimer);
    leaveTimer = 0;
    if (isIncident()) {
      if (mapCard.parentElement === mapSlot) return;
      // Watch → incident: the disc fades out, then the map moves right.
      const move = () => {
        leaveTimer = 0;
        mapApi()?.setFit?.("default");
        mapSlot.appendChild(mapCard);
        ringCentre.classList.remove("is-leaving");
        ringCentre.hidden = true;
        if (!reducedMotion()) {
          mapCard.classList.remove("is-arriving");
          void mapCard.offsetWidth;
          mapCard.classList.add("is-arriving");
        }
      };
      if (mapCard.parentElement === ringCentre && !reducedMotion()) {
        ringCentre.classList.add("is-leaving");
        leaveTimer = window.setTimeout(move, LEAVE_MS);
      } else {
        move();
      }
      return;
    }
    // Incident → watch: back into the disc, which fades in with the tiles.
    ringCentre.classList.remove("is-leaving");
    mapCard.classList.remove("is-arriving");
    if (mapCard.parentElement !== ringCentre) {
      ringCentre.appendChild(mapCard);
      if (!reducedMotion()) {
        ringCentre.classList.remove("is-entering");
        void ringCentre.offsetWidth;
        ringCentre.classList.add("is-entering");
      }
    }
    mapApi()?.setFit?.("circle");
  }

  function sizeDisc() {
    if (!ring || isIncident()) return;
    ringCentre.hidden = false;
    ringCentre.style.left = `${ring.cx - ring.d / 2}px`;
    ringCentre.style.top = `${ring.cy - ring.d / 2}px`;
    ringCentre.style.width = `${ring.d}px`;
    ringCentre.style.height = `${ring.d}px`;
    ringCentre.style.setProperty("--ring-label-w", `${Math.round(ring.labelW)}px`);
  }

  /** Nearest point of rect r to (px, py): on its edge when outside. */
  function nearestOnRect(px, py, r) {
    return {
      x: Math.min(Math.max(px, r.x), r.x + r.w),
      y: Math.min(Math.max(py, r.y), r.y + r.h),
    };
  }

  function leaderLevel(state, id) {
    const key = cameraStatus(state, id).key;
    return key === "severe" || key === "minor" ? key : "";
  }

  function drawLeaders() {
    leaderTimer = 0;
    clear(leaders);
    leaderSig = "";
    if (!ring || !rects || !camStage || isIncident()) return;
    const api = mapApi();
    if (!api?.pinClientPoint) return;
    const origin = camStage.getBoundingClientRect();
    const state = store.getState();
    const sig = [];
    for (const id of WALL_CAMERA_IDS) {
      const r = rects.get(id);
      const p = api.pinClientPoint(id);
      if (!r || !p) continue;
      const px = p.x - origin.left;
      const py = p.y - origin.top;
      const end = nearestOnRect(px, py, r);
      const level = leaderLevel(state, id);
      sig.push(level);
      const cls = `live-leader${level ? ` is-${level}` : ""}`;
      const g = svgEl("g", { class: cls, "data-camera-id": id });
      g.appendChild(
        svgEl("line", {
          x1: px.toFixed(1),
          y1: py.toFixed(1),
          x2: end.x.toFixed(1),
          y2: end.y.toFixed(1),
        }),
      );
      g.appendChild(svgEl("circle", { cx: end.x.toFixed(1), cy: end.y.toFixed(1), r: "3" }));
      leaders.appendChild(g);
    }
    leaderSig = sig.join(",");
  }

  /** Redraw after the tiles (and disc) reach their place. */
  function scheduleLeaders(delay) {
    window.clearTimeout(leaderTimer);
    leaders.classList.toggle("is-hidden", delay > 0);
    leaderTimer = window.setTimeout(() => {
      requestAnimationFrame(() => {
        drawLeaders();
        leaders.classList.remove("is-hidden");
      });
    }, delay);
  }

  function onRing(e) {
    const d = e.detail || {};
    ring = d.ring;
    rects = d.rects;
    if (d.mode === "incident" || !ring) {
      window.clearTimeout(leaderTimer);
      leaders.classList.add("is-hidden");
      clear(leaders);
      leaderSig = "";
      return;
    }
    sizeDisc();
    const wait = Math.max(d.duration || 0, moveUntil - performance.now());
    scheduleLeaders(reducedMotion() ? 0 : Math.max(0, wait));
  }

  // Centre: tracking card under the hero; right: the call console.
  const tracking = mountTrackingCard(trackHost, { store, vertical: false });
  const unmountCall = mountCallHost(callHost, store, actions);

  function render(state) {
    setText(
      mapSub,
      `${WALL_CAMERA_IDS.length} cameras · ${onlineCount(state, WALL_CAMERA_IDS)} online`,
    );
    incidentPanel.paint(state);
    // Leader colour follows each camera's open incident severity.
    if (leaderSig && !isIncident()) {
      const sig = WALL_CAMERA_IDS.map((id) => leaderLevel(state, id)).join(",");
      if (sig !== leaderSig) {
        for (const g of leaders.querySelectorAll(".live-leader")) {
          const level = leaderLevel(state, g.dataset.cameraId);
          g.setAttribute("class", `live-leader${level ? ` is-${level}` : ""}`);
        }
        leaderSig = sig;
      }
    }
  }

  function onMode() {
    moveUntil = performance.now() + (reducedMotion() ? 0 : layoutCtl.RING_MOVE_MS || 0);
    if (isIncident()) {
      window.clearTimeout(leaderTimer);
      leaders.classList.add("is-hidden");
    }
    placeMap();
    // Columns just appeared or went away: repaint what they show.
    render(store.getState());
  }

  // Camera wall "details" and "+N more" used to open the sidebar.
  function onOpenDetail(e) {
    const id = e.detail?.incidentId;
    if (id) {
      actions.select(id);
      incidentPanel.showDetail(id);
    } else {
      incidentPanel.showList();
    }
  }
  function onMore() {
    incidentPanel.showList();
  }

  placeMap();
  render(store.getState());
  const unsub = store.subscribe(render);
  document.addEventListener(LIVE_MODE_EVENT, onMode);
  document.addEventListener(LIVE_RING_EVENT, onRing);
  document.addEventListener(OPEN_SIDEBAR_EVENT, onOpenDetail);
  document.addEventListener(MORE_INCIDENTS_EVENT, onMore);

  return () => {
    unsub();
    document.removeEventListener(LIVE_MODE_EVENT, onMode);
    document.removeEventListener(LIVE_RING_EVENT, onRing);
    window.clearTimeout(leaderTimer);
    window.clearTimeout(leaveTimer);
    document.removeEventListener(OPEN_SIDEBAR_EVENT, onOpenDetail);
    document.removeEventListener(MORE_INCIDENTS_EVENT, onMore);
    tracking.destroy?.();
    if (typeof unmountCall === "function") unmountCall();
    if (typeof unmountMap === "function") unmountMap();
  };
}
