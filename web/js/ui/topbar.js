/** Header: mark + SENTINEL | nav | health | clock · reconnecting only */

import { ROUTES, navigate, getRoute, subscribeRoute } from "../router.js";
import {
  awaiting,
  formatHeaderClock,
  formatInt,
  formatMs,
  formatPct,
} from "../format.js";
import { setText } from "../dom.js";
import { LOGO_MARK } from "../logo.js";
import { now, subscribeTick } from "../clock.js";

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
        <div class="hm"><span class="hm__label">Models</span><span class="hm__value"><span class="dot" data-model-dot></span><span class="metric" data-models></span></span></div>
        <div class="hm"><span class="hm__label">GPU</span><span class="hm__value"><span class="metric mono" data-gpu></span></span></div>
        <div class="hm"><span class="hm__label">p95</span><span class="hm__value"><span class="metric mono" data-p95></span></span></div>
        <div class="hm"><span class="hm__label">Screened</span><span class="hm__value"><span class="metric mono" data-screened>0</span></span></div>
        <div class="hm"><span class="hm__label">Escalated</span><span class="hm__value"><span class="metric mono" data-escalated>0</span></span></div>
      </div>

      <div class="topbar__right">
        <button type="button" class="topbar__all-cams" data-all-cams hidden aria-label="Show all cameras" title="All cameras">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <rect x="1" y="1" width="5" height="5" rx="1" fill="currentColor"/>
            <rect x="8" y="1" width="5" height="5" rx="1" fill="currentColor"/>
            <rect x="1" y="8" width="5" height="5" rx="1" fill="currentColor"/>
            <rect x="8" y="8" width="5" height="5" rx="1" fill="currentColor"/>
          </svg>
          <span>All cameras</span>
        </button>
        <button type="button" class="topbar__reset" data-reset>Reset demo</button>
        <span class="topbar__reconnect" data-reconnect hidden>Reconnecting</span>
        <time class="topbar__clock metric mono" data-clock></time>
      </div>
    </div>
  `;

  const nav = el.querySelector("[data-nav]");
  el
    .querySelector("[data-reset]")
    .addEventListener("click", () => actions.demoReset());
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
  const modelDot = $("[data-model-dot]");
  const gpuEl = $("[data-gpu]");
  const p95El = $("[data-p95]");
  const screenedEl = $("[data-screened]");
  const escalatedEl = $("[data-escalated]");
  const reconnectEl = $("[data-reconnect]");
  const clockEl = $("[data-clock]");
  const allCamsBtn = $("[data-all-cams]");

  allCamsBtn?.addEventListener("click", () => layoutCtl?.showAll?.());

  function paintAllCams(state) {
    if (!allCamsBtn || !layoutCtl) return;
    const live = (state.route || getRoute()) === "live";
    allCamsBtn.hidden = !live;
    if (!live) return;
    const mode = layoutCtl.plan(state).mode;
    allCamsBtn.classList.toggle("is-invisible", mode === "grid");
  }

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
    // The wall can return to grid on a timer with no event; keep the
    // All cameras button in step with it.
    paintAllCams(store.getState());
  }

  function render(state) {
    paintNav(state.route || getRoute());
    paintAllCams(state);

    const h = state.health || {};
    if (h.cameras_online == null) {
      setText(camsEl, awaiting());
      camDot.className = "dot dot--off";
    } else {
      setText(camsEl, `${h.cameras_online}/${h.cameras_total}`);
      camDot.className =
        h.cameras_total > 0 && h.cameras_online >= h.cameras_total
          ? "dot dot--ok"
          : "dot dot--warn";
    }

    if (h.models_resident) {
      setText(modelsEl, "Resident");
      modelDot.className = "dot dot--ok";
    } else {
      setText(modelsEl, "Loading");
      modelDot.className = "dot dot--warn";
    }

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
  const unsubLayout = layoutCtl?.subscribe?.(() => paintAllCams(store.getState()));

  return () => {
    unsub();
    unsubRoute();
    unsubLayout?.();
    unsubTick();
    if (tweenRaf) cancelAnimationFrame(tweenRaf);
  };
}

/** Nav is embedded in topbar; keep stub for compatibility. */
export function mountNav() {
  return () => {};
}
