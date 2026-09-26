/**
 * Demo control panel (Shift+D; Reset Shift+R). Recording tools only, hidden
 * from the operator view. One rectangular panel with three collapsible
 * sections (Playback, Camera sources); one open at a time. The brand intro
 * is not here: it plays automatically on every load and reload.
 */

import { SCENARIOS } from "../mock.js?v=pro3";
import { clear, setText } from "../dom.js?v=pro3";
import { mountDemoCameraSources } from "./demoSources.js?v=pro3";
import * as cameraSources from "../cameraSources.js?v=pro3";
import { WALL_CAMERA_IDS } from "../site.js?v=pro3";

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const CHEVRON = `<svg class="acc__chev" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 6 8 10 12 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function clockText(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** One accordion section: 48px header button (title, summary, chevron) + body. */
function section(id, title, bodyHtml) {
  return `
    <section class="acc" data-acc="${id}">
      <h3 class="acc__h">
        <button type="button" class="acc__head" id="acc-${id}-head" aria-expanded="false" aria-controls="acc-${id}-body" data-acc-head="${id}">
          <span class="acc__title">${title}</span>
          <span class="acc__summary" data-summary="${id}"></span>
          ${CHEVRON}
        </button>
      </h3>
      <div class="acc__body" id="acc-${id}-body" role="region" aria-labelledby="acc-${id}-head" inert>
        <div class="acc__inner"><div class="acc__content">${bodyHtml}</div></div>
      </div>
    </section>
  `;
}

/**
 * @param {HTMLElement} elRoot
 * @param {object} store
 * @param {object} actions
 */
export function mountDemo(elRoot, store, actions) {
  const playbackHtml = `
    <div class="set-list">
      <div class="set-row">
        <div class="set-row__label"><label for="demo-scenario">Scenario</label></div>
        <div class="set-row__control">
          <select id="demo-scenario" class="set-select" data-scenario></select>
        </div>
      </div>
      <div class="set-row" data-mock-only>
        <div class="set-row__label"><span>Playback</span></div>
        <div class="set-row__control set-row__control--inline">
          <div class="seg" role="group" aria-label="Play or pause">
            <button type="button" class="seg__btn" data-play>Play</button>
            <button type="button" class="seg__btn" data-pause>Pause</button>
          </div>
          <div class="seg" role="group" aria-label="Speed">
            <button type="button" class="seg__btn" data-speed="1">1x</button>
            <button type="button" class="seg__btn" data-speed="2">2x</button>
            <button type="button" class="seg__btn" data-speed="4">4x</button>
          </div>
        </div>
      </div>
      <div class="set-row" data-mock-only>
        <div class="set-row__label"><label for="demo-scrub">Timeline</label></div>
        <div class="set-row__control set-row__control--inline">
          <div class="scrub">
            <input type="range" id="demo-scrub" class="scrub__input" min="0" max="120" step="0.1" value="0" data-scrub />
            <div class="scrub__markers" data-markers></div>
          </div>
          <span class="scrub__readout mono" data-t>0:00 / 2:00</span>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row__label">
          <label for="demo-autofollow">Auto follow</label>
          <p class="set-row__help">Moves between cameras, incidents and call while recording.</p>
        </div>
        <div class="set-row__control">
          <label class="switch">
            <input type="checkbox" role="switch" class="switch__input" id="demo-autofollow" data-autofollow />
            <span class="switch__track" aria-hidden="true"></span>
          </label>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row__label"><span>Models</span></div>
        <div class="set-row__control set-row__control--inline">
          <span class="set-status"><span class="dot" data-warm-dot></span><span data-warm-text>Warming</span></span>
          <button type="button" class="btn btn--secondary" data-prewarm>Pre-warm</button>
        </div>
      </div>
    </div>`;

  elRoot.innerHTML = `
    <article class="demo3 surface-light" role="dialog" aria-modal="true" aria-labelledby="demo-title">
      <header class="demo3__head">
        <h2 class="demo3__title" id="demo-title">Scenario control</h2>
        <span class="demo3__sub">Recording tools</span>
        <button type="button" class="btn btn--secondary btn--icon demo3__close" data-close aria-label="Close scenario control" title="Close">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M4 4 12 12M12 4 4 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </button>
      </header>
      <div class="demo3__body">
        ${section("playback", "Playback", playbackHtml)}
        ${section("sources", "Camera sources", '<div data-camera-sources></div>')}
      </div>
      <footer class="demo3__foot">
        <span class="demo3__source" data-source>Source: Playback</span>
        <button type="button" class="btn btn--primary" data-reset>
          <span>Reset</span><kbd class="demo3__kbd">Shift R</kbd>
        </button>
      </footer>
    </article>
  `;

  const dialog = elRoot.querySelector(".demo3");
  const sourcesApi = mountDemoCameraSources(elRoot.querySelector("[data-camera-sources]"));
  const scenarioEl = elRoot.querySelector("[data-scenario]");
  for (const s of SCENARIOS) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    scenarioEl.appendChild(opt);
  }

  const closeBtn = elRoot.querySelector("[data-close]");
  const warmDot = elRoot.querySelector("[data-warm-dot]");
  const warmText = elRoot.querySelector("[data-warm-text]");
  const mockRows = elRoot.querySelectorAll("[data-mock-only]");
  const scrub = elRoot.querySelector("[data-scrub]");
  const markersEl = elRoot.querySelector("[data-markers]");
  const sourceEl = elRoot.querySelector("[data-source]");
  const tEl = elRoot.querySelector("[data-t]");
  const autoFollowEl = elRoot.querySelector("[data-autofollow]");
  const playBtn = elRoot.querySelector("[data-play]");
  const pauseBtn = elRoot.querySelector("[data-pause]");
  const summaries = {
    playback: elRoot.querySelector('[data-summary="playback"]'),
    sources: elRoot.querySelector('[data-summary="sources"]'),
  };

  let open = false;
  let scrubbing = false;
  let returnFocus = null;

  // ---------- Accordion: one section open at a time ----------
  const sections = [...elRoot.querySelectorAll("[data-acc]")];
  function openSection(name) {
    for (const sec of sections) {
      const on = sec.dataset.acc === name;
      sec.classList.toggle("is-open", on);
      sec.querySelector(".acc__head").setAttribute("aria-expanded", on ? "true" : "false");
      // Collapsed bodies are inert: not focusable, not read out.
      sec.querySelector(".acc__body").inert = !on;
    }
  }
  for (const sec of sections) {
    sec.querySelector(".acc__head").addEventListener("click", () => {
      const isOpen = sec.classList.contains("is-open");
      openSection(isOpen ? null : sec.dataset.acc);
    });
  }
  openSection("playback");

  function setOpen(next) {
    if (next === open) return;
    open = next;
    elRoot.classList.toggle("is-open", open);
    elRoot.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      returnFocus = document.activeElement;
      closeBtn.focus();
    } else {
      sourcesApi.turnOffEditMode();
      cameraSources.setEditMode(false);
      if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
      returnFocus = null;
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
      // CSP-safe positioning: an SVG overlay instead of a style attribute.
      const mark = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      mark.setAttribute("class", `scrub__mark scrub__mark--${sev}`);
      mark.setAttribute("viewBox", "0 0 100 8");
      mark.setAttribute("preserveAspectRatio", "none");
      mark.setAttribute("aria-hidden", "true");
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(pct));
      circle.setAttribute("cy", "4");
      circle.setAttribute("r", "3");
      mark.appendChild(circle);
      markersEl.appendChild(mark);
    }
  }

  function paintReadout(t) {
    setText(tEl, `${clockText(t)} / ${clockText(Number(scrub.max) || 120)}`);
  }

  function paintSourcesSummary() {
    const loaded = WALL_CAMERA_IDS.filter((id) => cameraSources.get(id)?.status === "ready").length;
    setText(summaries.sources, `${loaded} of ${WALL_CAMERA_IDS.length} videos loaded`);
  }

  function render(state) {
    const mode = window.__transport?.mode || "MOCK";
    for (const row of mockRows) row.hidden = mode !== "MOCK";
    setText(sourceEl, mode === "MOCK" ? "Source: Playback" : "Source: Live");

    const warm = Boolean(state.health?.models_resident);
    warmDot.className = warm ? "dot dot--ok" : "dot dot--warn";
    setText(warmText, warm ? "Ready" : "Warming");

    const dur = window.__transport?.player?.getDuration?.() ?? 120;
    if (Number(scrub.max) !== dur) {
      scrub.max = String(dur);
      paintMarkers();
    }

    const t = state.demo?.t ?? 0;
    if (!scrubbing) {
      scrub.value = String(t);
      paintReadout(t);
    }

    const scenario = state.demo?.scenario || "full";
    if (scenarioEl.value !== scenario) scenarioEl.value = scenario;
    const scenarioName = SCENARIOS.find((s) => s.id === scenario)?.name || "Full scenario";
    const follow = Boolean(state.demo?.autoFollow);
    autoFollowEl.checked = follow;
    setText(summaries.playback, `${scenarioName} · Auto follow ${follow ? "on" : "off"}`);

    const running = Boolean(state.demo?.running);
    playBtn.classList.toggle("is-active", running);
    pauseBtn.classList.toggle("is-active", !running);
    playBtn.setAttribute("aria-pressed", running ? "true" : "false");
    pauseBtn.setAttribute("aria-pressed", running ? "false" : "true");

    const speed = state.demo?.speed ?? 1;
    for (const btn of elRoot.querySelectorAll("[data-speed]")) {
      const on = Number(btn.dataset.speed) === speed;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  // Focus stays inside the panel while it is open (collapsed sections are inert).
  dialog.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const items = [...dialog.querySelectorAll(FOCUSABLE)].filter(
      (n) => n.offsetParent !== null && !n.closest("[inert]"),
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      last.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first.focus();
      e.preventDefault();
    }
  });
  // Click on the dimmed backdrop closes.
  elRoot.addEventListener("click", (e) => {
    if (e.target === elRoot) setOpen(false);
  });

  closeBtn.addEventListener("click", () => setOpen(false));
  elRoot.querySelector("[data-reset]").addEventListener("click", () => actions.demoReset());
  elRoot.querySelector("[data-prewarm]").addEventListener("click", () => actions.demoPrewarm());
  playBtn.addEventListener("click", () => actions.demoPlay());
  pauseBtn.addEventListener("click", () => actions.demoPause());
  for (const btn of elRoot.querySelectorAll("[data-speed]")) {
    btn.addEventListener("click", () => actions.demoSpeed(Number(btn.dataset.speed)));
  }
  scenarioEl.addEventListener("change", () => {
    actions.demoScenario(scenarioEl.value);
    paintMarkers();
  });
  autoFollowEl.addEventListener("change", () => {
    store.setDemo({ autoFollow: autoFollowEl.checked });
  });

  scrub.addEventListener("pointerdown", () => {
    scrubbing = true;
  });
  scrub.addEventListener("pointerup", () => {
    scrubbing = false;
    actions.demoSeek(Number(scrub.value));
  });
  scrub.addEventListener("keyup", (e) => {
    if (/^(Arrow|Home|End|Page)/.test(e.key)) actions.demoSeek(Number(scrub.value));
  });
  scrub.addEventListener("input", () => paintReadout(Number(scrub.value)));

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

  elRoot.setAttribute("aria-hidden", "true");
  paintMarkers();
  paintSourcesSummary();
  render(store.getState());
  const unsub = store.subscribe(render);
  const unsubSources = cameraSources.subscribe(paintSourcesSummary);

  elRoot._demoApi = {
    isOpen: () => open,
    close: () => setOpen(false),
    toggle,
  };

  return () => {
    unsub();
    unsubSources();
    sourcesApi.destroy();
    window.removeEventListener("keydown", onKey);
  };
}
