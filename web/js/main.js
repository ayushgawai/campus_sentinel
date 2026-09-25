/** Boot. */

import { createStore } from "./store.js";
import { start } from "./transport.js";
import { createActions } from "./actions.js";
import { startRouter, getRoute, navigate } from "./router.js";
import { mountTopbar } from "./ui/topbar.js";
import { mountBanner } from "./ui/banner.js";
import { mountCameras } from "./ui/cameras.js";
import { createCameraLayout } from "./ui/cameraLayout.js";
import { mountSidebar } from "./ui/sidebar.js";
import { mountAssist } from "./ui/assist.js";
import { mountCallPage } from "./ui/callpage.js";
import { mountDemo } from "./ui/demo.js";
import { mountDismiss } from "./ui/dismiss.js";
import { mountIncidents } from "./ui/incidents.js";
import { mountSystem } from "./ui/system.js";
import { startAutoFollow } from "./ui/autofollow.js";
import {
  playSplash,
  shouldHoldMockForSplash,
  createSplashElement,
} from "./ui/splash.js";
import * as cameraSources from "./cameraSources.js";

const store = createStore();
const layoutCtl = createCameraLayout();
const holdMock = shouldHoldMockForSplash();

await cameraSources.hydrate();

const transport = start(
  (event) => store.handle(event),
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

mountTopbar(document.getElementById("topbar"), store, actions);
mountBanner(document.getElementById("banner"), store, actions, layoutCtl);
mountCameras(document.getElementById("cameras"), store, actions, layoutCtl);

const sidebarApi = mountSidebar(
  document.getElementById("sidebar"),
  store,
  actions,
  layoutCtl,
);
mountAssist(document.getElementById("assist-root"), store, sidebarApi);

mountCallPage(document.getElementById("call-page"), store);

async function replayIntro() {
  document.getElementById("demo")?._demoApi?.close?.();
  if (transport.mode === "MOCK") {
    transport.pause?.();
    transport.seek?.(0);
  }
  const existing = document.getElementById("splash");
  if (existing) existing.remove();
  const splash = createSplashElement();
  document.body.insertBefore(splash, document.body.firstChild);
  await playSplash({
    root: splash,
    appEl: document.getElementById("app"),
    restart: true,
  });
  if (transport.mode === "MOCK") {
    actions.demoReset();
  }
}

mountDemo(document.getElementById("demo"), store, actions, {
  onReplayIntro: replayIntro,
});
mountDismiss(document.getElementById("dismiss"), store, actions);
mountIncidents(
  document.getElementById("incidents-list"),
  document.getElementById("incidents-detail"),
  store,
  actions,
);
mountSystem(document.getElementById("system"), store);
startAutoFollow(store, sidebarApi, layoutCtl);

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
    if (sidebarApi.isOpen()) {
      sidebarApi.close();
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
window.__cameraLayout = layoutCtl;
window.__replayIntro = replayIntro;

(async () => {
  await playSplash({
    root: document.getElementById("splash"),
    appEl: document.getElementById("app"),
  });
  if (transport.mode === "MOCK" && holdMock) {
    actions.demoReset();
  }
  console.info("[main] Sentinel console ready", {
    mode: transport.mode,
    connection: store.getState().connection.status,
  });
})();
