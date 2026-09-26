/**
 * Live page shell. Two modes, set on #page-live[data-mode] by cameras.js
 * from layoutCtl.plan() (the one place the camera layout is applied):
 *   watch    — no main camera: the framed 3×2 camera grid, Report and
 *              Broadcast in the wall toolbar.
 *   incident — a hero camera (an incident, or a camera click): a full-width
 *              incident banner over three aligned columns — incidents left;
 *              hero, tracking bar and thumbnails centre; site plan and call
 *              right.
 * The site map is ONE instance; "Expand" moves it (and the same camera
 * tiles) into the expanded map view (liveExpand.js) and puts it back.
 */

import { WALL_CAMERA_IDS, cameraLabel, cameraPlace } from "../site.js?v=pro3";
import { onlineCount } from "../cameraStatus.js?v=pro3";
import {
  classLabel,
  formatClock,
  formatElapsedPlus,
  isOpenIncident,
  severityLabel,
  stateLabel,
} from "../format.js?v=pro3";
import { clear, el, setText } from "../dom.js?v=pro3";
import { icon } from "../icons.js?v=pro3";
import { now, subscribeTick } from "../clock.js?v=pro3";
import { mountMap } from "./map.js?v=pro3";
import { mountTrackingCard } from "./sitePlanExtras.js?v=pro3";
import { mountLiveCall } from "./call.js?v=pro3";
import { mountIncidentPanel } from "./sidebar.js?v=pro3";
import { createLiveExpand } from "./liveExpand.js?v=pro3";
import { OP_BROADCAST_EVENT, OP_REPORT_EVENT, opButton } from "./operator.js?v=pro3";
import {
  LIVE_MODE_EVENT,
  MORE_INCIDENTS_EVENT,
  OPEN_SIDEBAR_EVENT,
} from "./cameras.js?v=pro3";

/** Compact one-line legend: small dots, same meanings as the map. */
const LEGEND = [
  ["ok", "Online"],
  ["minor", "Minor"],
  ["severe", "Severe"],
  ["off", "Offline"],
  ["path", "Tracked path"],
  ["pred", "Predicted next"],
];

/** Flash on move: 3 pulses of 0.8 s (CSS), then the class is removed. */
const FLASH_MS = 2400;

export function mountLive(page, store, actions, layoutCtl, wall) {
  if (!page) return () => {};
  if (!page.dataset.mode) page.dataset.mode = "watch";

  const bannerHost = page.querySelector("[data-live-banner]");
  const leftHost = page.querySelector("[data-live-left]");
  const rightHost = page.querySelector("[data-live-right]");
  const trackHost = page.querySelector("[data-live-track]");

  const isLiveRoute = () => document.body.classList.contains("route-live");
  const isIncident = () => page.dataset.mode === "incident";

  /** Broadcast about the selected open incident, if any (as before). */
  function broadcastTarget(state) {
    const inc = state.selectedId ? state.incidents[state.selectedId] : null;
    return inc && isOpenIncident(inc) ? inc.incident_id : null;
  }

  // ---------- Left: incidents ----------
  const incidentsHost = el("div", { className: "live-incidents" });
  leftHost.appendChild(incidentsHost);
  const incidentPanel = mountIncidentPanel(incidentsHost, store, actions, layoutCtl, {
    isVisible: () => isLiveRoute() && isIncident(),
    variant: "live",
    broadcastTarget,
  });

  // ---------- Watch: Report and Broadcast in the camera wall toolbar ----------
  const toolbar = page.querySelector("#cameras .camwall__toolbar");
  const toolbarOps = el("div", { className: "live-toolbar-ops" });
  const reportBtn = opButton({
    className: "btn btn--sm lp-headbtn",
    iconName: "flag",
    text: "Report",
    attrs: { "data-live-op": "report" },
    onClick: () =>
      document.dispatchEvent(new CustomEvent(OP_REPORT_EVENT, { detail: { anchor: reportBtn } })),
  });
  const broadcastBtn = opButton({
    className: "btn btn--sm lp-headbtn",
    iconName: "megaphone",
    text: "Broadcast",
    attrs: { "data-live-op": "broadcast" },
    onClick: () =>
      document.dispatchEvent(
        new CustomEvent(OP_BROADCAST_EVENT, { detail: { incidentId: broadcastTarget(store.getState()) } }),
      ),
  });
  toolbarOps.appendChild(reportBtn);
  toolbarOps.appendChild(broadcastBtn);
  toolbar?.appendChild(toolbarOps);

  // The I key opens Report incident directly (Live only, not while typing
  // or in a dialog).
  function onKey(e) {
    if (e.key !== "i" && e.key !== "I") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!isLiveRoute()) return;
    const tag = e.target?.tagName;
    if (tag && ["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
    if (e.target?.isContentEditable || e.target?.closest?.('[role="dialog"]')) return;
    if (document.getElementById("map-expand")?.hidden === false) return;
    e.preventDefault();
    // Anchor the dialog on whichever Report button is showing.
    const anchor =
      [...page.querySelectorAll('[data-live-op="report"]')].find((b) => b.offsetParent) || reportBtn;
    document.dispatchEvent(new CustomEvent(OP_REPORT_EVENT, { detail: { anchor } }));
  }
  window.addEventListener("keydown", onKey);

  // ---------- Right: site plan card ----------
  const site = el("section", { className: "card ls-site", attrs: { "aria-label": "Site plan" } });
  const siteHead = el("header", { className: "ls-head" });
  siteHead.appendChild(el("h2", { className: "ls-title", text: "Site plan" }));
  const onlinePill = el("span", { className: "lp-pill lp-pill--aqua mono" });
  siteHead.appendChild(onlinePill);
  const expandBtn = el("button", {
    type: "button",
    className: "btn btn--sm ls-expand",
    attrs: { "aria-label": "Expand site map", "aria-haspopup": "dialog" },
  });
  expandBtn.appendChild(icon("expand"));
  expandBtn.appendChild(el("span", { text: "Expand" }));
  siteHead.appendChild(expandBtn);
  site.appendChild(siteHead);

  const mapCanvas = el("div", { className: "map-canvas ls-map" });
  const mapHost = el("div", { className: "sidebar-map" });
  mapCanvas.appendChild(mapHost);
  site.appendChild(mapCanvas);
  const legend = el("ul", { className: "ls-legend", attrs: { "aria-label": "Map legend" } });
  for (const [key, label] of LEGEND) {
    const li = el("li", { className: "ls-legend__item" });
    li.appendChild(el("i", { className: `leg leg--${key}`, attrs: { "aria-hidden": "true" } }));
    li.appendChild(el("span", { text: label }));
    legend.appendChild(li);
  }
  site.appendChild(legend);
  rightHost.appendChild(site);

  const unmountMap = mountMap(mapHost, store, actions, {
    showTip: false,
    fillHeight: true,
    showHeader: false,
  });

  // ---------- Right: call card ----------
  const callHost = el("div", { className: "ls-call" });
  rightHost.appendChild(callHost);
  const unmountCall = mountLiveCall(callHost, store, actions);

  // ---------- Centre: tracking bar between hero and thumbnails ----------
  const camStage = page.querySelector("#cameras [data-stage]");
  if (camStage) camStage.appendChild(trackHost);
  const tracking = mountTrackingCard(trackHost, { store });

  // ---------- Incident banner ----------
  let bannerSig = null;
  let bannerTime = null;

  function iconButton(name, label, onClick) {
    const b = el("button", {
      type: "button",
      className: "btn btn--icon btn--sm live-banner__icon",
      attrs: { "aria-label": label, title: label },
      onClick,
    });
    b.appendChild(icon(name));
    return b;
  }

  function paintBanner(state) {
    if (!isIncident()) return;
    const main = layoutCtl.plan(state).mains[0] || null;
    const inc = main?.incidentId ? state.incidents[main.incidentId] || null : null;
    const others = state.order.filter((id) => {
      const o = state.incidents[id];
      return o && id !== inc?.incident_id && isOpenIncident(o) && (o.severity === "SEVERE" || o.severity === "MINOR");
    }).length;
    const online = onlineCount(state, WALL_CAMERA_IDS);
    const sig = [main?.cameraId, inc, others, online].map((x) => (x && typeof x === "object" ? x : String(x)));
    if (bannerSig && sig.every((x, i) => x === bannerSig[i])) return;
    bannerSig = sig;

    clear(bannerHost);
    bannerTime = null;
    const cameraId = inc?.camera_id || main?.cameraId || null;
    const sev = inc ? (inc.severity === "SEVERE" ? "severe" : "minor") : "none";
    bannerHost.className = `live-banner live-banner--${sev}`;

    const block = el("div", { className: "live-banner__block" });
    block.appendChild(
      el("span", { className: "live-banner__class", text: inc ? classLabel(inc.class_token) : cameraLabel(cameraId) }),
    );
    bannerHost.appendChild(block);

    const info = el("div", { className: "live-banner__info" });
    if (inc) {
      info.appendChild(el("span", { className: `lp-pill lp-pill--${sev}`, text: severityLabel(inc.severity) }));
      info.appendChild(el("span", { className: "lp-pill lp-pill--state", text: stateLabel(inc.state) }));
    }
    const place = cameraPlace(cameraId);
    info.appendChild(
      el("span", {
        className: "live-banner__cam",
        text: inc || !place ? `${cameraLabel(cameraId)}${place ? ` · ${place}` : ""}` : place,
      }),
    );
    if (inc) {
      const firstMs = Date.parse(inc.created_at || inc.peak_ts || "");
      if (!Number.isNaN(firstMs)) {
        info.appendChild(el("span", { className: "live-banner__time mono", text: `first seen ${formatClock(firstMs)}` }));
        const elapsed = el("span", { className: "live-banner__elapsed mono" });
        info.appendChild(elapsed);
        bannerTime = { node: elapsed, firstMs };
      }
    } else {
      info.appendChild(el("span", { className: "live-banner__muted", text: "No open incident on this camera" }));
    }
    if (others > 0) {
      info.appendChild(
        el("button", {
          type: "button",
          className: "lp-pill lp-pill--more live-banner__more",
          text: `+${others} more`,
          attrs: { "aria-label": `${others} more open incidents: show the list` },
          onClick: () => incidentPanel.showList("open"),
        }),
      );
    }
    bannerHost.appendChild(info);

    const right = el("div", { className: "live-banner__right" });
    right.appendChild(
      el("span", { className: "lp-pill lp-pill--aqua mono", text: `${online}/${WALL_CAMERA_IDS.length} online` }),
    );
    const all = el("button", {
      type: "button",
      className: "btn btn--sm lp-headbtn live-banner__all",
      attrs: { "aria-label": "Show all cameras" },
      onClick: () => layoutCtl.showAll(),
    });
    all.appendChild(icon("grid"));
    all.appendChild(el("span", { text: "All cameras" }));
    right.appendChild(all);
    if (inc) {
      right.appendChild(
        iconButton("info", "Incident details", () => {
          actions.select(inc.incident_id);
          incidentPanel.showDetail(inc.incident_id);
        }),
      );
    }
    if (cameraId) {
      const flag = iconButton("flag", `Report incident on ${cameraLabel(cameraId)}`, () =>
        document.dispatchEvent(new CustomEvent(OP_REPORT_EVENT, { detail: { cameraId, anchor: flag } })),
      );
      right.appendChild(flag);
    }
    bannerHost.appendChild(right);
    paintBannerTime();
  }

  function paintBannerTime(nowMs = now()) {
    if (!bannerTime) return;
    setText(bannerTime.node, formatElapsedPlus((nowMs - bannerTime.firstMs) / 1000));
  }

  // ---------- Flash on move ----------
  /** incident id → last camera seen; the first sighting only seeds it. */
  const lastCam = new Map();
  const flashTimers = new Map();

  function flash(cameraId) {
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const nodes = [
      document.querySelector(`.cam-slot[data-camera-id="${cameraId}"]`),
      document.querySelector(`.cmap-pin[data-camera-id="${cameraId}"]`),
    ].filter(Boolean);
    for (const n of nodes) {
      n.classList.remove("is-flash");
      void n.getBoundingClientRect();
      n.classList.add("is-flash");
    }
    window.clearTimeout(flashTimers.get(cameraId));
    flashTimers.set(
      cameraId,
      window.setTimeout(() => {
        for (const n of nodes) n.classList.remove("is-flash");
        flashTimers.delete(cameraId);
      }, FLASH_MS),
    );
  }

  function watchMoves(state) {
    for (const id of state.order) {
      const inc = state.incidents[id];
      if (!inc?.camera_id || !isOpenIncident(inc)) continue;
      const prev = lastCam.get(id);
      lastCam.set(id, inc.camera_id);
      if (prev && prev !== inc.camera_id) flash(inc.camera_id);
    }
  }

  // ---------- Expanded map view ----------
  const expand = createLiveExpand({ store, layoutCtl, wall, mapCanvas });
  expandBtn.addEventListener("click", () => expand.open(expandBtn));

  function render(state) {
    setText(onlinePill, `${onlineCount(state, WALL_CAMERA_IDS)}/${WALL_CAMERA_IDS.length} online`);
    incidentPanel.paint(state);
    paintBanner(state);
    watchMoves(state);
  }

  function onMode() {
    if (!isIncident() && expand.isOpen()) expand.close();
    bannerSig = null;
    render(store.getState());
  }

  // "Details" and "+N more" open the incident column.
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
    incidentPanel.showList("open");
  }

  render(store.getState());
  const unsub = store.subscribe(render);
  const unsubTick = subscribeTick(paintBannerTime);
  document.addEventListener(LIVE_MODE_EVENT, onMode);
  document.addEventListener(OPEN_SIDEBAR_EVENT, onOpenDetail);
  document.addEventListener(MORE_INCIDENTS_EVENT, onMore);

  return () => {
    unsub();
    unsubTick();
    expand.close();
    window.removeEventListener("keydown", onKey);
    document.removeEventListener(LIVE_MODE_EVENT, onMode);
    document.removeEventListener(OPEN_SIDEBAR_EVENT, onOpenDetail);
    document.removeEventListener(MORE_INCIDENTS_EVENT, onMore);
    for (const t of flashTimers.values()) window.clearTimeout(t);
    tracking.destroy?.();
    if (typeof unmountCall === "function") unmountCall();
    if (typeof unmountMap === "function") unmountMap();
  };
}
