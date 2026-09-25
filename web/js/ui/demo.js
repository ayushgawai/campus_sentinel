/** Demo control modal — Shift+D; Reset Shift+R. */

import { SCENARIOS } from "../mock.js";
import { clear, setText } from "../dom.js";
import { mountDemoCameraSources } from "./demoSources.js";
import * as cameraSources from "../cameraSources.js";

/**
 * @param {HTMLElement} elRoot
 * @param {object} store
 * @param {object} actions
 * @param {{ onReplayIntro?: () => void|Promise<void> }} [opts]
 */
export function mountDemo(elRoot, store, actions, opts = {}) {
  elRoot.innerHTML = `
    <article class="panel demo" role="dialog" aria-modal="true" aria-label="Demo control">
      <header class="panel__header">
        <h2 class="panel__title">Demo control</h2>
        <div class="panel__slot">
          <button type="button" class="btn btn--secondary" data-close>Close</button>
        </div>
      </header>
      <div class="panel__body demo__body">
        <section class="demo__section demo__row">
          <div>
            <div class="demo__label">Source</div>
            <div class="demo__source mono" data-source>Mock</div>
          </div>
        </section>

        <section class="demo__section">
          <button type="button" class="btn btn--primary demo__reset" data-reset>
            Reset · Shift+R
          </button>
          <p class="demo__hint">Back to t=0 · quiet state · identical run</p>
        </section>

        <section class="demo__section">
          <button type="button" class="btn btn--secondary" data-replay-intro>
            Replay intro
          </button>
          <p class="demo__hint">Play splash again, then restart the demo</p>
        </section>

        <section class="demo__section">
          <label class="demo__label" for="demo-scenario">Scenario</label>
          <select id="demo-scenario" class="demo__select" data-scenario></select>
        </section>

        <section class="demo__section demo__row">
          <div>
            <div class="demo__label">Pre-warm</div>
            <div class="demo__warm" data-warm>
              <span class="dot" data-warm-dot></span>
              <span data-warm-text>Warming</span>
            </div>
          </div>
          <button type="button" class="btn btn--secondary" data-prewarm>Pre-warm</button>
        </section>

        <section class="demo__section demo__playback" data-playback>
          <div class="demo__label">Playback <span class="demo__muted">(mock)</span></div>
          <div class="demo__row">
            <button type="button" class="btn btn--secondary" data-play>Play</button>
            <button type="button" class="btn btn--secondary" data-pause>Pause</button>
            <div class="demo__speeds">
              <button type="button" class="btn btn--secondary" data-speed="1">1×</button>
              <button type="button" class="btn btn--secondary" data-speed="2">2×</button>
              <button type="button" class="btn btn--secondary" data-speed="4">4×</button>
            </div>
          </div>
          <div class="demo__scrub">
            <input type="range" min="0" max="120" step="0.1" value="0" data-scrub />
            <div class="demo__markers" data-markers></div>
          </div>
          <div class="demo__t mono metric">t = <span data-t>0.0</span>s</div>
        </section>

        <section class="demo__section demo__row">
          <div>
            <div class="demo__label">Auto follow</div>
            <p class="demo__hint">Live → Call on dispatch → Live on tracking</p>
          </div>
          <label class="demo__toggle">
            <input type="checkbox" data-autofollow />
            <span>On</span>
          </label>
        </section>

        <section data-camera-sources></section>

        <section class="demo__section">
          <div class="demo__label">Ready to record</div>
          <ul class="demo__check" data-check>
            <li data-ck="cams"><span class="dot"></span> Cameras 6/6</li>
            <li data-ck="warm"><span class="dot"></span> Models warm</li>
            <li data-ck="queue"><span class="dot"></span> Queue empty</li>
            <li data-ck="t0"><span class="dot"></span> t = 0</li>
          </ul>
        </section>
      </div>
    </article>
  `;

  const sourcesHost = elRoot.querySelector("[data-camera-sources]");
  const sourcesApi = mountDemoCameraSources(sourcesHost);
  const scenarioEl = elRoot.querySelector("[data-scenario]");
  for (const s of SCENARIOS) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    scenarioEl.appendChild(opt);
  }

  const closeBtn = elRoot.querySelector("[data-close]");
  const resetBtn = elRoot.querySelector("[data-reset]");
  const warmDot = elRoot.querySelector("[data-warm-dot]");
  const warmText = elRoot.querySelector("[data-warm-text]");
  const playback = elRoot.querySelector("[data-playback]");
  const scrub = elRoot.querySelector("[data-scrub]");
  const markersEl = elRoot.querySelector("[data-markers]");
  const sourceEl = elRoot.querySelector("[data-source]");
  const tEl = elRoot.querySelector("[data-t]");
  const autoFollowEl = elRoot.querySelector("[data-autofollow]");
  const check = {
    cams: elRoot.querySelector('[data-ck="cams"]'),
    warm: elRoot.querySelector('[data-ck="warm"]'),
    queue: elRoot.querySelector('[data-ck="queue"]'),
    t0: elRoot.querySelector('[data-ck="t0"]'),
  };

  let open = false;
  let scrubbing = false;

  function setOpen(next) {
    open = next;
    elRoot.classList.toggle("is-open", open);
    elRoot.setAttribute("aria-hidden", open ? "false" : "true");
    if (!open) {
      sourcesApi.turnOffEditMode();
      cameraSources.setEditMode(false);
    }
  }

  function toggle() {
    setOpen(!open);
  }

  function paintMarkers() {
    const transport = window.__transport;
    const marks = transport?.player?.getMarkers?.() || [];
    const dur = Number(scrub.max) || 120;
    clear(markersEl);
    for (const m of marks) {
      const pct = Math.min(100, Math.max(0, (m.at / dur) * 100));
      const sev = m.severity === "SEVERE" ? "severe" : "minor";
      // Position via flex spacer technique: left margin percentage on a track child
      // CSP-safe: use SVG overlay instead of style attribute
      const mark = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      mark.setAttribute("class", `demo__mark-svg demo__mark--${sev}`);
      mark.setAttribute("viewBox", "0 0 100 8");
      mark.setAttribute("preserveAspectRatio", "none");
      mark.setAttribute("aria-hidden", "true");
      const circle = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle",
      );
      circle.setAttribute("cx", String(pct));
      circle.setAttribute("cy", "4");
      circle.setAttribute("r", "3");
      mark.appendChild(circle);
      mark.setAttribute("title", `${m.class_token} at ${m.at}s`);
      markersEl.appendChild(mark);
    }
  }

  function render(state) {
    const mode = window.__transport?.mode || "MOCK";
    playback.hidden = mode !== "MOCK";
    if (sourceEl) {
      const status = state.connection?.status ?? mode;
      setText(sourceEl, status === "MOCK" ? "Mock" : "Live");
    }

    const warm = Boolean(state.health?.models_resident);
    warmDot.className = warm ? "dot dot--ok" : "dot dot--warn";
    setText(warmText, warm ? "Models warm" : "Warming");

    const t = state.demo?.t ?? 0;
    if (!scrubbing) {
      scrub.value = String(t);
      setText(tEl, t.toFixed(1));
    }

    const scenario = state.demo?.scenario || "full";
    if (scenarioEl.value !== scenario) scenarioEl.value = scenario;

    if (autoFollowEl) {
      autoFollowEl.checked = Boolean(state.demo?.autoFollow);
    }

    const speed = state.demo?.speed ?? 1;
    for (const btn of elRoot.querySelectorAll("[data-speed]")) {
      btn.classList.toggle("is-active", Number(btn.dataset.speed) === speed);
    }

    const camsOk =
      (state.health?.cameras_online ?? 0) >= 6 &&
      (state.health?.cameras_total ?? 0) >= 6;
    const queueOk = (state.order?.length ?? 0) === 0;
    const t0 = t < 0.05;

    setCheck(check.cams, camsOk);
    setCheck(check.warm, warm);
    setCheck(check.queue, queueOk);
    setCheck(check.t0, t0);

    const dur = window.__transport?.player?.getDuration?.() ?? 120;
    if (Number(scrub.max) !== dur) {
      scrub.max = String(dur);
      paintMarkers();
    }
  }

  function setCheck(li, ok) {
    li.classList.toggle("is-ok", ok);
    const dot = li.querySelector(".dot");
    if (dot) dot.className = ok ? "dot dot--ok" : "dot dot--off";
  }

  closeBtn.addEventListener("click", () => setOpen(false));
  resetBtn.addEventListener("click", () => actions.demoReset());
  elRoot.querySelector("[data-replay-intro]")?.addEventListener("click", () => {
    const fn = opts.onReplayIntro;
    if (typeof fn === "function") fn();
  });
  elRoot.querySelector("[data-prewarm]").addEventListener("click", () =>
    actions.demoPrewarm(),
  );
  elRoot.querySelector("[data-play]").addEventListener("click", () =>
    actions.demoPlay(),
  );
  elRoot.querySelector("[data-pause]").addEventListener("click", () =>
    actions.demoPause(),
  );
  for (const btn of elRoot.querySelectorAll("[data-speed]")) {
    btn.addEventListener("click", () =>
      actions.demoSpeed(Number(btn.dataset.speed)),
    );
  }
  scenarioEl.addEventListener("change", () => {
    actions.demoScenario(scenarioEl.value);
    paintMarkers();
  });

  autoFollowEl?.addEventListener("change", () => {
    store.setDemo({ autoFollow: autoFollowEl.checked });
  });

  scrub.addEventListener("pointerdown", () => {
    scrubbing = true;
  });
  scrub.addEventListener("pointerup", () => {
    scrubbing = false;
    actions.demoSeek(Number(scrub.value));
  });
  scrub.addEventListener("input", () => {
    setText(tEl, Number(scrub.value).toFixed(1));
  });

  function onKey(e) {
    if (e.target && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) {
      return;
    }
    if (e.shiftKey && (e.key === "D" || e.key === "d")) {
      e.preventDefault();
      toggle();
    }
    if (e.shiftKey && (e.key === "R" || e.key === "r")) {
      e.preventDefault();
      actions.demoReset();
    }
  }
  window.addEventListener("keydown", onKey);

  setOpen(false);
  paintMarkers();
  render(store.getState());
  const unsub = store.subscribe(render);

  elRoot._demoApi = {
    isOpen: () => open,
    close: () => setOpen(false),
    toggle,
  };

  return () => {
    unsub();
    sourcesApi.destroy();
    window.removeEventListener("keydown", onKey);
  };
}
