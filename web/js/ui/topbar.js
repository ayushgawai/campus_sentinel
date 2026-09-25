/** Header: mark + SENTINEL | nav | health | clock · reconnecting only */

import { ROUTES, navigate, getRoute, subscribeRoute } from "../router.js?v=fix9b";
import {
  awaiting,
  formatHeaderClock,
  formatInt,
  formatMs,
  formatPct,
} from "../format.js?v=fix9b";
import { el as h, setText } from "../dom.js?v=fix9b";
import { MODELS_SUBTITLE, MODELS_TITLE } from "../models.js?v=fix9b";
import { STATUS_DOT, STATUS_LABEL, subscribeModelStatus } from "../modelStatus.js?v=fix9b";
import { createModelsTable } from "./modelsTable.js?v=fix9b";
import { LOGO_MARK } from "../logo.js?v=fix9b";
import { now, subscribeTick } from "../clock.js?v=fix9b";
import { WALL_CAMERA_IDS } from "../site.js?v=fix9b";
import { cameraStatus, onlineCount } from "../cameraStatus.js?v=fix9b";

export function mountTopbar(el, store, actions, layoutCtl) {
  el.innerHTML = `
    <div class="topbar">
      <div class="topbar__brand" aria-label="Sentinel">
        ${LOGO_MARK}
        <div class="topbar__wordmark">SENTINEL</div>
      </div>

      <nav class="topbar__nav" aria-label="Primary" data-nav></nav>

      <div class="topbar__health" role="group" aria-label="Health">
        <div class="hm"><span class="hm__label">Cameras</span><span class="hm__value"><span class="dot" data-cam-dot></span><span class="metric mono" data-cams></span></span></div>
        <button type="button" class="hm hm--btn" data-models-btn aria-haspopup="dialog" aria-expanded="false" aria-controls="models-card"><span class="hm__label">Models</span><span class="hm__value"><span class="dot" data-model-dot></span><span class="metric" data-models></span></span></button>
        <div class="hm"><span class="hm__label">GPU</span><span class="hm__value"><span class="metric mono" data-gpu></span></span></div>
        <div class="hm"><span class="hm__label">Latency</span><span class="hm__value"><span class="metric mono" data-p95></span></span></div>
        <div class="hm"><span class="hm__label">Screened</span><span class="hm__value"><span class="metric mono" data-screened>0</span></span></div>
        <div class="hm"><span class="hm__label">Escalated</span><span class="hm__value"><span class="metric mono" data-escalated>0</span></span></div>
      </div>

      <div class="topbar__right">
        <span class="topbar__reconnect" data-reconnect hidden>Reconnecting</span>
        <time class="topbar__clock metric mono" data-clock></time>
      </div>
    </div>
  `;

  const nav = el.querySelector("[data-nav]");
  for (const route of ROUTES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nav__tab";
    btn.dataset.route = route.id;
    btn.textContent = route.label;
    btn.addEventListener("click", () => navigate(route.id));
    nav.appendChild(btn);
  }

  function paintNav(route) {
    for (const btn of nav.querySelectorAll(".nav__tab")) {
      const on = btn.dataset.route === route;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    }
  }
  paintNav(getRoute());
  const unsubRoute = subscribeRoute(paintNav);

  const $ = (sel) => el.querySelector(sel);
  const camsEl = $("[data-cams]");
  const camDot = $("[data-cam-dot]");
  const modelsEl = $("[data-models]");
  const modelsBtn = $("[data-models-btn]");
  const modelDot = $("[data-model-dot]");
  const gpuEl = $("[data-gpu]");
  const p95El = $("[data-p95]");
  const screenedEl = $("[data-screened]");
  const escalatedEl = $("[data-escalated]");
  const reconnectEl = $("[data-reconnect]");
  const clockEl = $("[data-clock]");

  let screenedDisplay = 0;
  let screenedTarget = 0;
  let lastEscalated = 0;
  let tweenRaf = 0;

  function tween() {
    tweenRaf = 0;
    if (screenedDisplay < screenedTarget) {
      const delta = screenedTarget - screenedDisplay;
      screenedDisplay = Math.min(
        screenedTarget,
        screenedDisplay + Math.max(delta * 0.18, Math.min(delta, 12)),
      );
      setText(screenedEl, formatInt(Math.floor(screenedDisplay)));
      if (screenedDisplay < screenedTarget) tweenRaf = requestAnimationFrame(tween);
    }
  }

  function bumpScreened(target) {
    if (target == null || Number.isNaN(target)) return;
    const next = Math.max(0, Math.floor(target));
    if (next < screenedTarget) return;
    screenedTarget = next;
    if (!tweenRaf) tweenRaf = requestAnimationFrame(tween);
  }

  function tickClock(ms = now()) {
    setText(clockEl, formatHeaderClock(ms));
    const iso = new Date(ms).toISOString();
    if (clockEl.dateTime !== iso) clockEl.dateTime = iso;
  }

  const modelsCard = mountModelsCard(modelsBtn);
  const unsubModels = subscribeModelStatus(() => render(store.getState()));

  function render(state) {
    paintNav(state.route || getRoute());

    const h = state.health || {};
    // Values that have not arrived yet read a muted "Pending".
    const pending = (node, missing) => node.classList.toggle("is-pending", missing);
    pending(gpuEl, h.gpu_util == null);
    pending(p95El, h.p95_ms == null);
    pending(escalatedEl, h.frames_escalated == null);
    // Same rule as the tiles, pins and site list (cameraStatus.js).
    const camsOnline = onlineCount(state, WALL_CAMERA_IDS);
    const allConnecting = WALL_CAMERA_IDS.every(
      (id) => cameraStatus(state, id).key === "connecting",
    );
    setText(camsEl, allConnecting ? "Connecting" : `${camsOnline}/${WALL_CAMERA_IDS.length}`);
    camsEl.classList.toggle("is-pending", allConnecting);
    camDot.className =
      camsOnline >= WALL_CAMERA_IDS.length
        ? "dot dot--ok"
        : camsOnline > 0
          ? "dot dot--warn"
          : "dot dot--off";

    // Core pipeline only (vision + detection/anomaly); voice never ambers it.
    const { overall } = modelsCard.update(state);
    setText(modelsEl, STATUS_LABEL[overall]);
    modelDot.className = `dot ${STATUS_DOT[overall]}`;
    modelsEl.classList.toggle("is-pending", overall === "pending");

    setText(gpuEl, formatPct(h.gpu_util));
    setText(p95El, formatMs(h.p95_ms));
    bumpScreened(h.frames_screened);

    const esc = h.frames_escalated;
    if (esc == null || Number.isNaN(esc)) setText(escalatedEl, awaiting());
    else {
      setText(escalatedEl, formatInt(esc));
      lastEscalated = esc;
    }

    const status = state.connection?.status ?? "MOCK";
    const showReconnect = status === "RECONNECTING";
    reconnectEl.hidden = !showReconnect;
  }

  tickClock();
  const unsubTick = subscribeTick(tickClock);
  render(store.getState());
  const unsub = store.subscribe(render);

  return () => {
    unsub();
    unsubRoute();
    unsubTick();
    unsubModels();
    modelsCard.destroy();
    if (tweenRaf) cancelAnimationFrame(tweenRaf);
  };
}

/** Nav is embedded in topbar; keep stub for compatibility. */
export function mountNav() {
  return () => {};
}

/**
 * Anchored "On-device AI" card under the Models button. Esc, a click
 * outside or the button again closes it; focus returns to the button.
 */
function mountModelsCard(btn) {
  const card = h("div", {
    className: "mcard surface-light",
    id: "models-card",
    attrs: { role: "dialog", "aria-labelledby": "models-card-title" },
  });
  card.hidden = true;
  card.tabIndex = -1;
  const head = h("div", { className: "mcard__head" });
  head.appendChild(h("h2", { className: "mcard__title", id: "models-card-title", text: MODELS_TITLE }));
  head.appendChild(h("p", { className: "mcard__sub", text: MODELS_SUBTITLE }));
  card.appendChild(head);
  const table = createModelsTable({ className: "mtable--card" });
  card.appendChild(table.el);
  document.body.appendChild(card);

  const GAP = 8;
  const PAD = 12;

  function place() {
    const r = btn.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const w = card.offsetWidth;
    const left = Math.min(Math.max(PAD, r.right - w), vw - w - PAD);
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(r.bottom + GAP)}px`;
  }

  function isOpen() {
    return !card.hidden;
  }

  function open() {
    card.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    btn.classList.add("is-open");
    place();
    card.focus({ preventScroll: true });
    document.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", place);
  }

  function close(returnFocus = true) {
    if (!isOpen()) return;
    card.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    btn.classList.remove("is-open");
    document.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", place);
    if (returnFocus) btn.focus({ preventScroll: true });
  }

  function onOutside(e) {
    if (card.contains(e.target) || btn.contains(e.target)) return;
    // Focus follows the click elsewhere; do not pull it back.
    close(false);
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    // Nothing inside is focusable: Tab closes the card and continues from
    // the button, so keyboard order is unchanged.
    if (e.key === "Tab") close();
  }

  btn.addEventListener("click", () => (isOpen() ? close() : open()));

  return {
    update: (state) => table.update(state),
    destroy() {
      close(false);
      card.remove();
    },
  };
}
