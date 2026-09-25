/**
 * Site plan extras — cameras list, tracking card, overview, legend.
 * Shared by sidebar Site plan tab and the expand modal.
 */

import { WALL_CAMERA_IDS, cameraLabel, cameraTitle } from "../site.js?v=live2";
import { predictedCameraAt } from "../mock.js?v=live2";
import {
  classLabel,
  severityLabel,
  formatRel,
  formatElapsedPlus,
  isOpenIncident,
} from "../format.js?v=live2";
import { clear, el, setText } from "../dom.js?v=live2";
import { FOCUS_CAMERA_EVENT } from "./cameras.js?v=live2";
import { now, subscribeTick } from "../clock.js?v=live2";
import { activeIncidentForCamera, cameraStatus, onlineCount } from "../cameraStatus.js?v=live2";

function activeHit(state, cameraId) {
  const inc = activeIncidentForCamera(state, cameraId);
  return inc ? { sev: inc.severity, inc } : null;
}

function peopleCount(state, cameraId) {
  const boxes = state.cameras?.[cameraId]?.boxes;
  return Array.isArray(boxes) ? boxes.length : 0;
}

function trackingIncident(state) {
  for (const id of state.order) {
    const inc = state.incidents[id];
    if (inc && inc.state === "TRACKING") return inc;
  }
  return null;
}

function pursuitRoute(state, inc) {
  if (!inc) return { steps: [], predicted: null };
  const path = state.cameraPath?.[inc.incident_id];
  let steps = Array.isArray(path) && path.length ? path.slice() : [];
  if (!steps.length && inc.camera_id) steps = [inc.camera_id];
  if (steps[steps.length - 1] !== inc.camera_id && inc.camera_id) {
    steps = [...steps, inc.camera_id];
  }
  const t = state.demo?.t ?? 0;
  const predicted =
    (window.__transport?.mode || "MOCK") === "MOCK"
      ? predictedCameraAt(t)
      : null;
  return { steps, predicted };
}

function stepTimes(steps, inc, nowMs) {
  const startMs = Date.parse(inc?.created_at || inc?.peak_ts || "");
  const span = Number.isNaN(startMs) ? 0 : Math.max(0, (nowMs - startMs) / 1000);
  return steps.map((_, i) => {
    if (steps.length === 1) return formatElapsedPlus(span);
    return formatElapsedPlus(span * (i / (steps.length - 1)));
  });
}

export function legendMarkup() {
  return `
    <span class="leg-item"><i class="leg leg--ok"></i> Online</span>
    <span class="leg-item"><i class="leg leg--minor"></i> Minor</span>
    <span class="leg-item"><i class="leg leg--severe"></i> Severe</span>
    <span class="leg-item"><i class="leg leg--off"></i> Offline</span>
    <span class="leg-item"><i class="leg leg--path"></i> Tracked path</span>
    <span class="leg-item"><i class="leg leg--pred"></i> Predicted next</span>
  `;
}

/**
 * @param {HTMLElement} host
 * @param {{ store: object, actions: object, layoutCtl?: object, columns?: 1|2, dense?: boolean }} opts
 */
export function mountSiteCamerasList(host, opts) {
  const { store, actions, layoutCtl, columns = 2 } = opts;
  host.classList.add(
    "site-cams",
    columns === 2 ? "site-cams--grid" : "site-cams--col",
  );
  host.replaceChildren();
  host.classList.add("card", "card--compact");
  const head = el("div", { className: "site-card__head" });
  head.appendChild(el("h3", { className: "site-card__title", text: "Cameras" }));
  const onlineEl = el("span", {
    className: "site-card__meta",
    text: "0 of 0 online",
  });
  head.appendChild(onlineEl);
  host.appendChild(head);
  const list = el("div", {
    className: columns === 2 ? "site-cams__grid" : "site-cams__list",
  });
  host.appendChild(list);

  /** @type {Map<string, HTMLElement>} */
  const rows = new Map();

  for (const id of WALL_CAMERA_IDS) {
    const row = el("button", {
      type: "button",
      className: "site-cam-row",
    });
    row.dataset.cameraId = id;
    row.setAttribute("aria-label", cameraTitle(id));

    const mark = el("span", { className: "site-cam-row__mark mono" });
    const n = Number(String(id).replace(/\D/g, "")) || "?";
    setText(mark, String(n));

    const body = el("div", { className: "site-cam-row__body" });
    body.appendChild(
      el("div", { className: "site-cam-row__name", text: cameraTitle(id) }),
    );
    const status = el("div", { className: "site-cam-row__status" });
    status.appendChild(el("span", { className: "dot site-cam-row__dot" }));
    status.appendChild(el("span", { className: "site-cam-row__status-text" }));
    body.appendChild(status);

    const people = el("div", {
      className: "site-cam-row__people mono",
      text: "0",
    });

    row.appendChild(mark);
    row.appendChild(body);
    row.appendChild(people);
    list.appendChild(row);
    rows.set(id, row);

    row.addEventListener("pointerenter", () => {
      window.__map?.setHover?.(id);
    });
    row.addEventListener("pointerleave", () => {
      window.__map?.setHover?.(null);
    });
    row.addEventListener("click", () => {
      layoutCtl?.swapMain?.(id);
      document.dispatchEvent(
        new CustomEvent(FOCUS_CAMERA_EVENT, { detail: { cameraId: id } }),
      );
      window.__map?.setFocus?.(id);
      const hit = activeHit(store.getState(), id);
      if (hit?.inc) actions.select(hit.inc.incident_id);
    });
  }

  function paint(state) {
    const focusId = window.__map?.getFocus?.() || null;
    const hoverId = window.__map?.getHover?.() || null;
    let onlineN = 0;
    for (const id of WALL_CAMERA_IDS) {
      if (cameraStatus(state, id).online) onlineN += 1;
    }
    setText(
      onlineEl,
      `${onlineN} of ${WALL_CAMERA_IDS.length} online`,
    );
    for (const id of WALL_CAMERA_IDS) {
      const row = rows.get(id);
      const st = cameraStatus(state, id);
      const people = peopleCount(state, id);
      const dot = row.querySelector(".site-cam-row__dot");
      const text = row.querySelector(".site-cam-row__status-text");
      const peopleEl = row.querySelector(".site-cam-row__people");
      dot.className = `dot site-cam-row__dot site-cam-row__dot--${st.key}`;
      setText(text, st.label);
      const peopleLabel =
        people === 1 ? "1 person" : `${people} people`;
      setText(peopleEl, peopleLabel);
      peopleEl.title = peopleLabel;
      row.classList.toggle("is-online", st.key === "online");
      row.classList.toggle("is-focus", focusId === id);
      row.classList.toggle("is-hover", hoverId === id);
      row.classList.toggle("is-severe", st.key === "severe");
      row.classList.toggle("is-minor", st.key === "minor");
      // Connecting reads muted, like offline.
      row.classList.toggle("is-offline", !st.online);
    }
  }

  paint(store.getState());
  const unsub = store.subscribe(paint);
  const onMapHover = () => paint(store.getState());
  document.addEventListener("sentinel:map-hover", onMapHover);
  document.addEventListener("sentinel:map-focus", onMapHover);

  return {
    paint,
    destroy() {
      unsub();
      document.removeEventListener("sentinel:map-hover", onMapHover);
      document.removeEventListener("sentinel:map-focus", onMapHover);
    },
  };
}

/**
 * @param {HTMLElement} host
 * @param {{ store: object, vertical?: boolean }} opts
 */
export function mountTrackingCard(host, opts) {
  const { store, vertical = false } = opts;
  /** Live time nodes of the current card, refreshed by the ticker. */
  let live = null;

  function paintTimes(nowMs = now()) {
    if (!live) return;
    setText(live.agoEl, formatRel(live.inc.created_at || live.inc.peak_ts, nowMs));
    const times = stepTimes(live.steps, live.inc, nowMs);
    live.timeEls.forEach((node, i) => setText(node, times[i]));
  }

  function paint(state) {
    clear(host);
    live = null;
    host.classList.add(
      "site-track",
      ...(vertical ? ["site-track--vertical"] : []),
    );
    if (!vertical) host.classList.remove("site-track--vertical");
    const inc = trackingIncident(state);
    if (!inc) {
      host.classList.add("card", "card--compact");
      const empty = el("p", { className: "site-track__empty" });
      empty.appendChild(
        el("span", {
          className: "site-track__empty-dot",
          attrs: { "aria-hidden": "true" },
        }),
      );
      empty.appendChild(
        el("span", { text: "No active tracking" }),
      );
      host.appendChild(empty);
      return;
    }

    host.classList.add("card", "card--compact", "site-track--active");
    const head = el("div", { className: "site-track__head" });
    const titles = el("div", { className: "site-track__titles" });
    const typeRow = el("div", { className: "site-track__type-row" });
    typeRow.appendChild(
      el("span", {
        className: "site-track__type",
        text: classLabel(inc.class_token),
      }),
    );
    typeRow.appendChild(
      el("span", {
        className: `card-chip card-chip--${inc.severity === "SEVERE" ? "severe" : "minor"}`,
        text: severityLabel(inc.severity),
      }),
    );
    titles.appendChild(typeRow);
    head.appendChild(titles);
    const agoEl = el("div", { className: "site-track__ago mono" });
    head.appendChild(agoEl);
    host.appendChild(head);

    const { steps, predicted } = pursuitRoute(state, inc);
    const timeEls = [];
    const route = el("div", {
      className: vertical ? "site-track__route site-track__route--v" : "site-track__route",
    });

    steps.forEach((camId, i) => {
      if (i > 0) {
        const arrow = el("span", {
          className: "site-track__arrow",
          attrs: { "aria-hidden": "true" },
        });
        arrow.appendChild(el("span", { className: "site-track__arrow-line" }));
        arrow.appendChild(
          el("span", { className: "site-track__arrow-chev", text: "›" }),
        );
        route.appendChild(arrow);
      }
      const step = el("div", {
        className:
          "site-track__step" +
          (camId === inc.camera_id ? " is-current" : ""),
      });
      const mark = el("span", { className: "site-track__cam" });
      setText(mark, cameraLabel(camId));
      step.appendChild(mark);
      const timeEl = el("span", { className: "site-track__time mono" });
      timeEls.push(timeEl);
      step.appendChild(timeEl);
      route.appendChild(step);
    });

    if (predicted && !steps.includes(predicted)) {
      {
        const arrow = el("span", {
          className: "site-track__arrow",
          attrs: { "aria-hidden": "true" },
        });
        arrow.appendChild(el("span", { className: "site-track__arrow-line" }));
        arrow.appendChild(
          el("span", { className: "site-track__arrow-chev", text: "›" }),
        );
        route.appendChild(arrow);
      }
      const pred = el("div", {
        className: "site-track__step is-predicted",
      });
      const mark = el("span", { className: "site-track__cam" });
      setText(mark, cameraLabel(predicted));
      pred.appendChild(mark);
      pred.appendChild(
        el("span", { className: "site-track__time", text: "Next" }),
      );
      route.appendChild(pred);
    }

    host.appendChild(route);
    live = { inc, steps, agoEl, timeEls };
    paintTimes();
  }

  paint(store.getState());
  const unsub = store.subscribe(paint);
  const unsubTick = subscribeTick(paintTimes);
  return {
    paint,
    destroy() {
      unsub();
      unsubTick();
    },
  };
}

/**
 * @param {HTMLElement} host
 * @param {{ store: object, compact?: boolean }} opts
 */
export function mountSiteOverview(host, opts) {
  const { store, compact = false } = opts;

  function paint(state) {
    clear(host);
    host.classList.add("site-overview");
    if (compact) host.classList.add("site-overview--compact");
    else host.classList.remove("site-overview--compact");
    host.appendChild(
      el("h3", { className: "site-plan__h", text: "Site overview" }),
    );
    const grid = el("div", { className: "site-overview__grid" });

    const online = onlineCount(state, WALL_CAMERA_IDS);
    const total = WALL_CAMERA_IDS.length;
    let active = 0;
    let people = 0;
    let lastEsc = null;
    for (const id of state.order) {
      const inc = state.incidents[id];
      if (!inc) continue;
      if (isOpenIncident(inc)) active += 1;
      if (inc.severity === "SEVERE") {
        const ts = inc.created_at || inc.peak_ts;
        if (ts && (!lastEsc || Date.parse(ts) > Date.parse(lastEsc))) {
          lastEsc = ts;
        }
      }
    }
    for (const id of WALL_CAMERA_IDS) {
      people += peopleCount(state, id);
    }

    const cells = [
      ["Cameras online", `${online} of ${total}`],
      ["Active incidents", String(active)],
      ["People tracked", String(people)],
      [
        "Last escalation",
        lastEsc
          ? formatRel(lastEsc, now())
          : "None",
      ],
    ];
    for (const [label, value] of cells) {
      const cell = el("div", { className: "site-overview__cell" });
      cell.appendChild(
        el("div", { className: "site-overview__label", text: label }),
      );
      cell.appendChild(
        el("div", { className: "site-overview__value mono", text: value }),
      );
      grid.appendChild(cell);
    }
    host.appendChild(grid);
  }

  paint(store.getState());
  return { paint, destroy: store.subscribe(paint) };
}
