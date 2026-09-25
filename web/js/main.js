/** Boot. */

import { createStore } from "./store.js?v=fix10h";
import { start } from "./transport.js?v=fix10h";
import { createActions } from "./actions.js?v=fix10h";
import { startRouter, getRoute, navigate } from "./router.js?v=fix10h";
import { mountTopbar } from "./ui/topbar.js?v=fix10h";
import { mountBanner } from "./ui/banner.js?v=fix10h";
import { mountCameras } from "./ui/cameras.js?v=fix10h";
import { createCameraLayout } from "./ui/cameraLayout.js?v=fix10h";
import { mountSidebar } from "./ui/sidebar.js?v=fix10h";
import { mountAssist } from "./ui/assist.js?v=fix10h";
import { mountCallPage } from "./ui/callpage.js?v=fix10h";
import { mountCallPanel } from "./ui/call.js?v=fix10h";
import { mountDemo } from "./ui/demo.js?v=fix10h";
import { mountDismiss } from "./ui/dismiss.js?v=fix10h";
import { mountOperator } from "./ui/operator.js?v=fix10h";
import { mountIncidents } from "./ui/incidents.js?v=fix10h";
import { mountSystem } from "./ui/system.js?v=fix10h";
import { startAutoFollow } from "./ui/autofollow.js?v=fix10h";
import { playSplash, shouldHoldMockForSplash } from "./ui/splash.js?v=fix10h";
import { startModelStatus } from "./modelStatus.js?v=fix10h";
import { noteEvent } from "./cameraStatus.js?v=fix10h";
import { subscribeTick } from "./clock.js?v=fix10h";
import * as cameraSources from "./cameraSources.js?v=fix10h";

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
mountCameras(document.getElementById("cameras"), store, actions, layoutCtl);

const opApi = mountOperator(document.getElementById("op-dialog"), store, actions);
const callPanelApi = mountCallPanel(document.getElementById("call-float"), store, actions);

const sidebarApi = mountSidebar(
  document.getElementById("sidebar"),
  store,
  actions,
  layoutCtl,
  { onClose: () => callPanelApi.close() },
);
mountAssist(document.getElementById("assist-root"), store, sidebarApi);

document.addEventListener("sentinel:open-call-panel", () => callPanelApi.open());

mountCallPage(document.getElementById("call-page"), store, actions);

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
