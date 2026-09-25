/**
 * Live Operations sidebar — Incidents / Site plan.
 * Pushes camera area; never overlays. The Call button in its header opens
 * a separate floating call panel (call.js's mountCallPanel).
 */

import { now, subscribeTick } from "../clock.js?v=live2";
import { WALL_CAMERA_IDS } from "../site.js?v=live2";
import { onlineCount } from "../cameraStatus.js?v=live2";
import {
  classLabel,
  cameraLabel,
  formatPct,
  formatRel,
  formatTimeLocal,
  severityLabel,
  stateLabel,
  textOr,
  notReported,
  awaiting,
  pctNumber,
  isOpenIncident,
  isDispatchSimState,
} from "../format.js?v=live2";
import { mountIncidentClip } from "./incidentClip.js?v=live2";
import { clear, el, setText } from "../dom.js?v=live2";
import { mountMap } from "./map.js?v=live2";
import {
  legendMarkup,
  mountSiteCamerasList,
  mountTrackingCard,
  mountSiteOverview,
} from "./sitePlanExtras.js?v=live2";
import { findCallIncident, formatCallTimer, callElapsedMs } from "./call.js?v=live2";
import { FOCUS_CAMERA_EVENT } from "./cameras.js?v=live2";
import {
  OP_REPORT_EVENT,
  OP_STATUS_EVENT,
  actionBar,
  opButton,
  confidenceLong,
} from "./operator.js?v=live2";
import {
  detailHeaderCard,
  detailsCard,
  clipCard,
  timelineCard,
  emptyState,
} from "./incidentDetail.js?v=live2";

/** Same entries by identity (store replaces an incident object when it changes). */
function sameSig(a, b) {
  return Boolean(a && b && a.length === b.length && a.every((x, i) => x === b[i]));
}

/**
 * Incident list and detail (report toolbar, incident cards, detail cards and
 * action bar). Used by the Live sidebar and the Live incident column.
 * `opts.isVisible()` gates painting so a hidden panel costs nothing.
 * @returns {{ paint: (state: object) => void, showDetail: (id: string) => void, showList: () => void }}
 */
export function mountIncidentPanel(host, store, actions, layoutCtl, opts = {}) {
  const isVisible = opts.isVisible || (() => true);
  let detailId = null;

  /** "Camera N · 8 s ago · 92% confidence" lines, refreshed by the ticker. */
  let agoLines = [];

  function agoLine(tag, inc, nowMs) {
    const node = el(tag, { className: "inc-card__row2" });
    const entry = { node, inc };
    agoLines.push(entry);
    paintAgoLine(entry, nowMs);
    return node;
  }

  function paintAgoLine({ node, inc }, nowMs) {
    setText(
      node,
      [
        cameraLabel(inc.camera_id),
        formatRel(inc.created_at || inc.peak_ts, nowMs),
        confidenceLong(inc),
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }

  function paintTimes(nowMs = now()) {
    if (!isVisible()) return;
    for (const entry of agoLines) paintAgoLine(entry, nowMs);
  }

  /** Operator status changes (pending, not confirmed) force a repaint. */
  let opVersion = 0;
  let lastSig = null;

  function incidentsSig(state) {
    if (detailId && state.incidents[detailId]) {
      return ["detail", detailId, state.incidents[detailId], opVersion];
    }
    return ["list", state.selectedId, opVersion, ...state.order.map((id) => state.incidents[id])];
  }

  function paintIncidents(state) {
    // The store notifies every frame (mock clock) and on every overlay; only
    // rebuild when what this panel shows changed, so buttons keep their
    // clicks and keyboard focus.
    const sig = incidentsSig(state);
    if (sameSig(sig, lastSig)) return;
    lastSig = sig;

    const panel = host;
    const hadFocus = panel.contains(document.activeElement)
      ? document.activeElement.dataset.focusKey
      : null;
    clear(panel);
    agoLines = [];
    const nowMs = now();
    paintIncidentsBody(state, panel, nowMs);
    if (hadFocus) panel.querySelector(`[data-focus-key="${hadFocus}"]`)?.focus();
  }

  function reportToolbar(state) {
    const openCount = state.order.filter((id) => isOpenIncident(state.incidents[id])).length;
    const bar = el("div", { className: "inc-toolbar" });
    bar.appendChild(
      el("span", {
        className: "inc-toolbar__count",
        text: openCount === 1 ? "1 open" : `${openCount} open`,
      }),
    );
    const btn = opButton({
      className: "btn btn--secondary btn--sm op-btn",
      iconName: "flag",
      text: "Report",
      attrs: { "aria-label": "Report incident", title: "Report incident", "data-focus-key": "report" },
      onClick: () =>
        document.dispatchEvent(new CustomEvent(OP_REPORT_EVENT, { detail: { anchor: btn } })),
    });
    bar.appendChild(btn);
    return bar;
  }

  function paintIncidentsBody(state, panel, nowMs) {
    if (detailId && state.incidents[detailId]) {
      const inc = state.incidents[detailId];
      const stack = el("div", { className: "sidebar-stack sidebar-stack--scroll inc-detail" });
      stack.appendChild(
        detailHeaderCard(inc, {
          onBack: () => {
            detailId = null;
            repaint();
          },
        }),
      );
      stack.appendChild(detailsCard(inc));
      const clip = clipCard(inc);
      if (clip) stack.appendChild(clip);
      stack.appendChild(timelineCard(inc));
      // Sticky at the bottom of the same scroll area, so its edges line up
      // with the cards above even when a scrollbar is showing.
      if (isOpenIncident(inc)) stack.appendChild(actionBar(inc, actions));
      panel.appendChild(stack);
      return;
    }

    panel.appendChild(reportToolbar(state));

    const ids = state.order.filter((id) => {
      const inc = state.incidents[id];
      return inc && (inc.severity === "SEVERE" || inc.severity === "MINOR");
    });
    if (!ids.length) {
      panel.appendChild(emptyState("No active incidents", "All cameras are being monitored."));
      return;
    }

    const openIds = [];
    const closedIds = [];
    for (const id of ids) {
      if (isOpenIncident(state.incidents[id])) openIds.push(id);
      else closedIds.push(id);
    }

    for (const id of [...openIds, ...closedIds]) {
      const inc = state.incidents[id];
      const closed = !isOpenIncident(inc);
      const row = el("button", {
        type: "button",
        className: `inc-card${state.selectedId === id ? " is-selected" : ""}${closed ? " is-closed" : ""}`,
      });
      row.appendChild(
        el("span", {
          className: `inc-card__stripe inc-card__stripe--${inc.severity}`,
          attrs: { "aria-hidden": "true" },
        }),
      );
      const top = el("div", { className: "inc-card__row1" });
      top.appendChild(
        el("span", {
          className: "inc-card__type",
          text: classLabel(inc.class_token),
        }),
      );
      const chips = el("span", { className: "inc-card__chips" });
      chips.appendChild(
        el("span", {
          className: `card-chip card-chip--${inc.severity === "SEVERE" ? "severe" : "minor"}`,
          text: stateLabel(inc.state),
        }),
      );
      top.appendChild(chips);
      row.appendChild(top);
      row.appendChild(agoLine("div", inc, nowMs));
      row.addEventListener("click", () => {
        detailId = id;
        actions.select(id);
        if (inc.camera_id && layoutCtl) layoutCtl.swapMain(inc.camera_id);
        repaint();
      });
      panel.appendChild(row);
    }
  }

  function repaint() {
    lastSig = null;
    if (isVisible()) paintIncidents(store.getState());
  }

  subscribeTick((nowMs) => paintTimes(nowMs));
  document.addEventListener(OP_STATUS_EVENT, () => {
    opVersion += 1;
    repaint();
  });

  return {
    paint(state) {
      if (isVisible()) paintIncidents(state);
    },
    showDetail(id) {
      detailId = id || null;
      repaint();
    },
    showList() {
      detailId = null;
      repaint();
    },
  };
}

export function mountSidebar(root, store, actions, layoutCtl, hooks = {}) {
  let open = false;
  let tab = "incidents";
  let mapApi = null;
  let mapHost = null;
  /** @type {{ destroy?: Function, paint?: Function }[]} */
  let mapExtras = [];
  let expandUnmount = null;
  let expandExtras = [];

  root.id = "sidebar";
  root.setAttribute("aria-label", "Incidents");
  root.innerHTML = `
    <div class="sidebar">
      <header class="sidebar__head">
        <nav class="sidebar__tabs" data-tabs role="tablist">
          <button type="button" role="tab" data-tab="incidents" class="is-active">Incidents</button>
          <button type="button" role="tab" data-tab="map">Site plan</button>
        </nav>
        <button type="button" class="btn btn--ghost sidebar__call-btn" data-call-btn hidden>
          <span class="sidebar__call-dot" aria-hidden="true"></span>
          Call <span class="mono" data-call-timer>00:00</span>
        </button>
        <button type="button" class="btn btn--ghost" data-close aria-label="Close panel">Close</button>
      </header>
      <div class="sidebar__body">
        <div class="sidebar__panel" data-panel="incidents"></div>
        <div class="sidebar__panel" data-panel="map" hidden></div>
      </div>
    </div>
  `;

  const tabsEl = root.querySelector("[data-tabs]");
  const panels = {
    incidents: root.querySelector('[data-panel="incidents"]'),
    map: root.querySelector('[data-panel="map"]'),
  };
  const callBtn = root.querySelector("[data-call-btn]");
  const callTimerEl = root.querySelector("[data-call-timer]");
  const incidentPanel = mountIncidentPanel(panels.incidents, store, actions, layoutCtl, {
    isVisible: () => open && tab === "incidents",
  });

  root.querySelector("[data-close]").addEventListener("click", () => api.close());
  callBtn.addEventListener("click", () => {
    document.dispatchEvent(new CustomEvent("sentinel:open-call-panel"));
  });

  for (const btn of tabsEl.querySelectorAll("[data-tab]")) {
    btn.addEventListener("click", () => {
      tab = btn.dataset.tab;
      if (tab !== "incidents") incidentPanel.showList();
      paint();
    });
  }

  function setOpen(next, opts = {}) {
    open = next;
    root.hidden = !open;
    document.body.classList.toggle("sidebar-open", open);
    if (opts.tab) tab = opts.tab;
    if (opts.incidentId) {
      incidentPanel.showDetail(opts.incidentId);
      tab = "incidents";
    }
    if (!open) hooks.onClose?.();
    document.dispatchEvent(
      new CustomEvent("sentinel:sidebar", { detail: { open, tab } }),
    );
    paint();
  }

  const api = {
    isOpen: () => open,
    open(nextTab = "incidents", incidentId = null) {
      setOpen(true, { tab: nextTab, incidentId });
    },
    close() {
      setOpen(false);
    },
    setTab(t) {
      tab = t;
      paint();
    },
  };

  const ACTIVE_CALL_STATES = new Set(["DISPATCHED", "TRACKING"]);

  function paintTabs(state) {
    for (const btn of tabsEl.querySelectorAll("[data-tab]")) {
      btn.classList.toggle("is-active", btn.dataset.tab === tab);
      btn.setAttribute("aria-selected", btn.dataset.tab === tab ? "true" : "false");
    }
    for (const [name, panel] of Object.entries(panels)) {
      panel.hidden = name !== tab;
    }
  }

  function paintCallBtn(state, nowMs = now()) {
    const inc = findCallIncident(state);
    const active = inc && ACTIVE_CALL_STATES.has(inc.state);
    callBtn.hidden = !active;
    if (!active) return;
    const ms = callElapsedMs(inc, state, nowMs);
    setText(callTimerEl, ms == null ? "00:00" : formatCallTimer(ms));
  }

  function destroyMapExtras(list) {
    for (const api of list) {
      try {
        api.destroy?.();
      } catch {
        /* ignore */
      }
    }
    list.length = 0;
  }

  function ensureMap(state) {
    if (mapHost) {
      for (const api of mapExtras) api.paint?.(state);
      return;
    }
    clear(panels.map);
    panels.map.classList.add("sidebar-site");

    // Card 1: Site plan (header + map + legend)
    const mapCard = el("div", { className: "card card--compact site-map-card" });
    const mapHead = el("div", { className: "site-card__head" });
    const mapTitles = el("div", { className: "site-card__titles" });
    mapTitles.appendChild(
      el("h3", { className: "site-card__title", text: "Site plan" }),
    );
    const mapSub = el("span", {
      className: "site-card__meta",
      text: "6 cameras · 6 online",
    });
    mapSub.dataset.onlineMeta = "1";
    mapTitles.appendChild(mapSub);
    mapHead.appendChild(mapTitles);
    mapHead.appendChild(
      el("button", {
        type: "button",
        className: "btn btn--icon site-map-card__expand",
        text: "⛶",
        attrs: {
          "aria-label": "Expand map",
          title: "Expand map",
        },
        onClick: () => openMapExpand(),
      }),
    );
    mapCard.appendChild(mapHead);

    const mapCanvas = el("div", { className: "map-canvas" });
    mapHost = el("div", { className: "sidebar-map" });
    mapCanvas.appendChild(mapHost);
    mapCard.appendChild(mapCanvas);

    const legend = el("div", { className: "site-legend" });
    legend.innerHTML = legendMarkup();
    mapCard.appendChild(legend);
    panels.map.appendChild(mapCard);

    const unmount = mountMap(mapHost, store, actions, {
      showTip: false,
      fillHeight: false,
      showHeader: false,
    });
    mapApi = window.__map;
    mapHost._unmount = unmount;

    // Card 2: Cameras
    const camsHost = el("div", { className: "sidebar-site__cams" });
    panels.map.appendChild(camsHost);
    mapExtras.push(
      mountSiteCamerasList(camsHost, {
        store,
        actions,
        layoutCtl,
        columns: 2,
      }),
    );

    // Card 3: Tracking
    const trackHost = el("div", { className: "sidebar-site__track" });
    panels.map.appendChild(trackHost);
    mapExtras.push(mountTrackingCard(trackHost, { store, vertical: false }));

    // Keep online subtitle in sync
    mapExtras.push({
      paint(s) {
        const online = onlineCount(s, WALL_CAMERA_IDS);
        setText(mapSub, `${WALL_CAMERA_IDS.length} cameras · ${online} online`);
      },
      destroy() {},
    });
    mapExtras[mapExtras.length - 1].paint(state);
  }

  function openMapExpand() {
    const host = document.getElementById("map-expand");
    if (!host) return;
    destroyMapExtras(expandExtras);
    if (typeof expandUnmount === "function") {
      try {
        expandUnmount();
      } catch {
        /* ignore */
      }
      expandUnmount = null;
    }

    host.hidden = false;
    host.className = "map-expand is-open";
    host.innerHTML = `
      <div class="map-expand__backdrop" data-close></div>
      <div class="map-expand__panel float-dots" role="dialog" aria-label="Site plan">
        <header class="map-expand__head">
          <h2 class="panel__title">Site plan</h2>
          <div class="map-expand__head-actions">
            <span class="metric mono" data-expand-count>6 cameras</span>
            <button type="button" class="btn btn--ghost" data-close>Close</button>
          </div>
        </header>
        <div class="map-expand__layout">
          <div class="card card--compact site-map-card map-expand__map-card">
            <div class="site-card__head">
              <div class="site-card__titles">
                <h3 class="site-card__title">Site plan</h3>
                <span class="site-card__meta" data-expand-online>6 cameras · 6 online</span>
              </div>
            </div>
            <div class="map-canvas map-expand__map" data-map></div>
            <div class="site-legend" data-legend></div>
          </div>
          <aside class="map-expand__side" data-side>
            <div data-cams></div>
            <div data-track></div>
          </aside>
        </div>
      </div>
    `;

    const mapEl = host.querySelector("[data-map]");
    const side = host.querySelector("[data-side]");
    expandUnmount = mountMap(mapEl, store, actions, {
      fillHeight: true,
      showTip: false,
      showHeader: false,
    });
    const countEl = host.querySelector("[data-expand-count]");
    if (countEl) setText(countEl, "6 cameras");
    const onlineMeta = host.querySelector("[data-expand-online]");
    const syncExpandOnline = (s) => {
      const online = onlineCount(s, WALL_CAMERA_IDS);
      if (onlineMeta) {
        setText(onlineMeta, `${WALL_CAMERA_IDS.length} cameras · ${online} online`);
      }
    };
    syncExpandOnline(store.getState());

    expandExtras.push(
      mountSiteCamerasList(side.querySelector("[data-cams]"), {
        store,
        actions,
        layoutCtl,
        columns: 1,
      }),
    );
    expandExtras.push(
      mountTrackingCard(side.querySelector("[data-track]"), {
        store,
        vertical: true,
      }),
    );
    expandExtras.push({
      paint: syncExpandOnline,
      destroy() {},
    });
    const legend = host.querySelector("[data-legend]");
    legend.innerHTML = legendMarkup();

    const close = () => {
      destroyMapExtras(expandExtras);
      if (typeof expandUnmount === "function") {
        try {
          expandUnmount();
        } catch {
          /* ignore */
        }
        expandUnmount = null;
      }
      host.hidden = true;
      host.className = "map-expand";
      clear(host);
      if (mapHost?._unmount) {
        const parent = mapHost.parentElement;
        const next = el("div", { className: "sidebar-map" });
        parent?.replaceChild(next, mapHost);
        try {
          mapHost._unmount();
        } catch {
          /* ignore */
        }
        mapHost = next;
        mapHost._unmount = mountMap(mapHost, store, actions, {
          showTip: false,
          fillHeight: false,
          showHeader: false,
        });
        mapApi = window.__map;
      }
    };
    host.querySelectorAll("[data-close]").forEach((b) =>
      b.addEventListener("click", close),
    );
    host._close = close;
  }

  function paint() {
    if (!open) return;
    const state = store.getState();
    paintTabs(state);
    paintCallBtn(state);
    if (tab === "incidents") incidentPanel.paint(state);
    if (tab === "map") {
      ensureMap(state);
    }
  }

  function render(state) {
    if (!open) return;
    paint();
    const expand = document.getElementById("map-expand");
    if (expand && !expand.hidden) {
      for (const api of expandExtras) api.paint?.(state);
    }
  }

  store.subscribe(render);
  subscribeTick((nowMs) => {
    if (open) paintCallBtn(store.getState(), nowMs);
  });

  window.__sidebar = api;
  return api;
}
