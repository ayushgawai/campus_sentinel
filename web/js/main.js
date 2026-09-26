/** Boot. */

import { createStore } from "./store.js?v=pro7";
import { start } from "./transport.js?v=pro7";
import { createActions } from "./actions.js?v=pro7";
import { startRouter, getRoute, navigate } from "./router.js?v=pro7";
import { mountTopbar } from "./ui/topbar.js?v=pro7";
import { mountBanner } from "./ui/banner.js?v=pro7";
import { mountCameras } from "./ui/cameras.js?v=pro7";
import { createCameraLayout } from "./ui/cameraLayout.js?v=pro7";
import { mountSidebar } from "./ui/sidebar.js?v=pro7";
import { mountLive } from "./ui/live.js?v=pro7";
import { mountCallPage } from "./ui/callpage.js?v=pro7";
import { startCallRecorder } from "./callHistory.js?v=pro7";
import { mountCallPanel } from "./ui/call.js?v=pro7";
import { mountDemo } from "./ui/demo.js?v=pro7";
import { mountDismiss } from "./ui/dismiss.js?v=pro7";
import { mountOperator } from "./ui/operator.js?v=pro7";
import { mountIncidents } from "./ui/incidents.js?v=pro7";
import { mountSystem } from "./ui/system.js?v=pro7";
import { startAutoFollow } from "./ui/autofollow.js?v=pro7";
import { playSplash, shouldHoldMockForSplash } from "./ui/splash.js?v=pro8";
import { startModelStatus } from "./modelStatus.js?v=pro7";
import { startUsage } from "./usage.js?v=pro7";
import { startModelActivity } from "./modelActivity.js?v=pro7";
import { noteEvent } from "./cameraStatus.js?v=pro7";
import { subscribeTick } from "./clock.js?v=pro7";
import * as cameraSources from "./cameraSources.js?v=pro7";
import { mountActivity } from "./ui/activity.js?v=pro7";

const store = createStore();
const layoutCtl = createCameraLayout();
const holdMock = shouldHoldMockForSplash();

// Start timing the brand intro now, not after the app mounts: its CSS reveal
// began on first paint, and loading stored camera videos below can take
// seconds. It fades out once both ~5.4 s have passed and the app is mounted.
let markAppReady = () => {};
const appReady = new Promise((resolve) => {
  markAppReady = resolve;
});
const splashDone = playSplash({
  root: document.getElementById("splash"),
  appEl: document.getElementById("app"),
  ready: appReady,
});

const transport = start(
  (event) => {
    noteEvent(event);
    store.handle(event);
  },
  {
    setConnection: (status) => store.setConnection(status),
    setDemo: (partial) => store.setDemo(partial),
    softReset: () => {
      store.softReset();
      layoutCtl.resetMemory();
    },
    flush: () => store.flush(),
    holdMockPlayback: holdMock,
  },
);

const actions = createActions({
  store,
  getMode: () => transport.mode,
  transport,
});

// Local camera videos (IndexedDB) before the camera wall mounts. Live has
// already started connecting above; mock stays held until the intro ends.
await cameraSources.hydrate();

mountTopbar(document.getElementById("topbar"), store, actions, layoutCtl);
mountBanner(document.getElementById("banner"), store, actions, layoutCtl);
const cameraWall = mountCameras(document.getElementById("cameras"), store, actions, layoutCtl);

const opApi = mountOperator(document.getElementById("op-dialog"), store, actions);
const callPanelApi = mountCallPanel(document.getElementById("call-float"), store, actions);

const sidebarApi = mountSidebar(
  document.getElementById("sidebar"),
  store,
  actions,
  layoutCtl,
  { onClose: () => callPanelApi.close() },
);
// Live columns: incidents, the single site map, tracking card and call.
mountLive(document.getElementById("page-live"), store, actions, layoutCtl, cameraWall);
mountActivity(document.querySelector("[data-live-activity]"), store);
// Tab title stays "Sentinel · Security Console" (index.html). All-time
// tokens show in the Live activity strip, not in the title.

document.addEventListener("sentinel:open-call-panel", () => callPanelApi.open());

mountCallPage(document.getElementById("call-page"), store, actions);
// Save calls in this browser as they happen (Call page → Call history).
startCallRecorder(store);

mountDemo(document.getElementById("demo"), store, actions);
mountDismiss(document.getElementById("dismiss"), store, actions);
mountIncidents(
  document.getElementById("incidents-list"),
  document.getElementById("incidents-detail"),
  store,
  actions,
);
mountSystem(document.getElementById("system"), store);
startModelStatus(store);
startUsage(store);
startModelActivity(store);
// Camera status expires with time (10 s without frames or events), so
// views re-evaluate once a second even when no event arrives.
subscribeTick(() => store.touch());
startAutoFollow(store, sidebarApi, callPanelApi, layoutCtl);

function applyRoute(route) {
  store.setRoute(route);
  document.body.dataset.route = route;
  for (const page of document.querySelectorAll("[data-page]")) {
    const on = page.getAttribute("data-page") === route;
    page.hidden = !on;
    page.classList.toggle("is-active", on);
  }
  // Assist only on Live; dark dotted field on Incidents + Call
  document.body.classList.toggle("route-live", route === "live");
  document.body.classList.toggle("route-incidents", route === "incidents");
  document.body.classList.toggle("route-call", route === "call");
}

startRouter(applyRoute);
applyRoute(getRoute());

window.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "Escape") return;
    if (document.getElementById("splash")) return;
    // The header Models card closes itself on Esc.
    if (document.getElementById("models-card")?.hidden === false) return;
    if (opApi.isOpen()) {
      opApi.close();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const expand = document.getElementById("map-expand");
    if (expand && !expand.hidden) {
      expand._close?.();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const dismissEl = document.getElementById("dismiss");
    if (dismissEl && !dismissEl.hidden) {
      dismissEl._dismissApi?.close?.();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const demoEl = document.getElementById("demo");
    if (demoEl?.classList.contains("is-open")) {
      demoEl._demoApi?.close?.();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (callPanelApi.isOpen()) {
      callPanelApi.close();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (sidebarApi.isOpen()) {
      sidebarApi.close();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (store.getState().route === "live" && layoutCtl.plan(store.getState()).mode !== "grid") {
      layoutCtl.showAll();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (store.getState().selectedId) {
      actions.clearSelection();
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true,
);

window.addEventListener("keydown", (e) => {
  if (!["ArrowUp", "ArrowDown", "Enter"].includes(e.key)) return;
  if (document.getElementById("splash")) return;
  // Dialogs own Enter (confirm) and arrow keys.
  if (opApi.isOpen() || e.target?.closest?.('[role="dialog"]')) return;
  const tag = e.target?.tagName;
  if (tag && ["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
  if (store.getState().route !== "live" && store.getState().route !== "incidents")
    return;
  const ids = store.getState().order;
  if (!ids.length) return;
  if (e.key === "Enter") {
    if (!store.getState().selectedId) actions.select(ids[0]);
    e.preventDefault();
    return;
  }
  let idx = store.getState().selectedId
    ? ids.indexOf(store.getState().selectedId)
    : -1;
  idx =
    e.key === "ArrowDown"
      ? Math.min(ids.length - 1, idx + 1)
      : Math.max(0, idx <= 0 ? 0 : idx - 1);
  actions.select(ids[idx]);
  e.preventDefault();
});

window.__store = store;
window.__transport = transport;
window.__actions = actions;
window.__navigate = navigate;
window.__sidebar = sidebarApi;
window.__callPanel = callPanelApi;
window.__cameraLayout = layoutCtl;

markAppReady();

(async () => {
  await splashDone;
  // Mock timeline starts at t=0 only after the intro.
  if (transport.mode === "MOCK" && holdMock) {
    actions.demoReset();
  }
  console.info("[main] Sentinel console ready", {
    mode: transport.mode,
    connection: store.getState().connection.status,
  });
})();
