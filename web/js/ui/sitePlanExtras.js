/**
 * Site plan extras — cameras list, tracking card, overview, legend.
 * Shared by sidebar Site plan tab and the expand modal.
 */

import { WALL_CAMERA_IDS, cameraLabel, cameraTitle } from "../site.js?v=pro4";
import { followedIncident, pathHops } from "../tracking.js?v=pro4";
import {
  classLabel,
  severityLabel,
  formatRel,
  formatElapsedPlus,
  formatClock,
  isOpenIncident,
} from "../format.js?v=pro4";
import { clear, el, setText } from "../dom.js?v=pro4";
import { FOCUS_CAMERA_EVENT } from "./cameras.js?v=pro4";
import { now, subscribeTick } from "../clock.js?v=pro4";
import { activeIncidentForCamera, cameraStatus, onlineCount } from "../cameraStatus.js?v=pro4";

function activeHit(state, cameraId) {
  const inc = activeIncidentForCamera(state, cameraId);
  return inc ? { sev: inc.severity, inc } : null;
}

function peopleCount(state, cameraId) {
  const boxes = state.cameras?.[cameraId]?.boxes;
  return Array.isArray(boxes) ? boxes.length : 0;
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
 * Tracking bar: ONE line — "Tracking", then a chip per recent hop of the
 * followed incident (tracking.js) with the time the data gives for it, the
 * current camera filled with the severity colour, and the time since first
 * seen on the right. No path yet: one muted line.
 * @param {HTMLElement} host
 * @param {{ store: object }} opts
 */
export function mountTrackingCard(host, opts) {
  const { store } = opts;
  // Keep the host's own classes (e.g. the Live stage's live-track).
  const baseClass = host.className ? `${host.className} ` : "";
  let live = null;
  let lastSig = null;

  function paintTimes(nowMs = now()) {
    if (!live) return;
    const start = Date.parse(live.inc.created_at || live.inc.peak_ts || "");
    setText(live.nowEl, Number.isNaN(start) ? "" : formatElapsedPlus((nowMs - start) / 1000));
  }

  const camShort = (id) => cameraLabel(id).replace(/^Camera\b/, "Cam");

  function paint(state) {
    const inc = followedIncident(state);
    const { hops, earlier } = pathHops(state, inc);
    const sig = inc
      ? [inc.incident_id, inc.severity, inc.camera_id, earlier, ...hops.map((h) => `${h.cameraId}@${h.at || ""}`)].join("|")
      : "none";
    if (sig === lastSig) return;
    lastSig = sig;

    clear(host);
    live = null;
    host.className = `${baseClass}site-track`;
    if (!inc) {
      host.classList.add("site-track--empty");
      host.appendChild(
        el("span", { className: "site-track__slim", text: "Tracking starts when the person moves to another camera" }),
      );
      return;
    }
    host.classList.add("site-track--active", inc.severity === "SEVERE" ? "is-severe" : "is-minor");
    host.setAttribute("aria-label", `Tracking ${classLabel(inc.class_token)}`);
    host.appendChild(el("span", { className: "site-track__label", text: "Tracking" }));

    const route = el("ol", { className: "site-track__route" });
    if (earlier > 0) {
      route.appendChild(el("li", { className: "site-track__chip is-earlier mono", text: `+${earlier} earlier` }));
    }
    hops.forEach((h, i) => {
      const current = i === hops.length - 1;
      if (i > 0 || earlier > 0) {
        route.appendChild(el("li", { className: "site-track__arrow", text: "→", attrs: { "aria-hidden": "true" } }));
      }
      const ms = h.at ? Date.parse(h.at) : NaN;
      const when = current ? "now" : Number.isNaN(ms) ? "" : formatClock(ms);
      const chip = el("li", {
        className: `site-track__chip${current ? " is-current" : ""}`,
        text: when ? `${camShort(h.cameraId)} · ${when}` : camShort(h.cameraId),
        attrs: { title: cameraTitle(h.cameraId) },
      });
      route.appendChild(chip);
    });
    host.appendChild(route);
    const nowEl = el("span", { className: "site-track__elapsed mono" });
    host.appendChild(nowEl);
    live = { inc, nowEl };
    paintTimes();
    fitRoute(route, earlier);
  }

  /** One line only: fold the oldest hops into "+N earlier" until it fits. */
  function fitRoute(route, earlier) {
    if (!route.isConnected || !route.clientWidth) return;
    let folded = earlier;
    const hopChips = () => [...route.querySelectorAll(".site-track__chip:not(.is-earlier)")];
    while (route.scrollWidth > route.clientWidth + 1 && hopChips().length > 1) {
      const first = hopChips()[0];
      const next = first.nextElementSibling;
      if (next?.classList.contains("site-track__arrow")) next.remove();
      first.remove();
      folded += 1;
      let chip = route.querySelector(".site-track__chip.is-earlier");
      if (!chip) {
        chip = el("li", { className: "site-track__chip is-earlier mono" });
        route.insertBefore(el("li", { className: "site-track__arrow", text: "→", attrs: { "aria-hidden": "true" } }), route.firstChild);
        route.insertBefore(chip, route.firstChild);
      }
      setText(chip, `+${folded} earlier`);
    }
  }

  // Width changes (mode switch, resize): refit from the full route.
  const ro = new ResizeObserver(() => {
    lastSig = null;
    paint(store.getState());
  });
  ro.observe(host);

  paint(store.getState());
  const unsub = store.subscribe(paint);
  const unsubTick = subscribeTick(paintTimes);
  return {
    paint,
    destroy() {
      unsub();
      unsubTick();
      ro.disconnect();
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
