/**
 * Live Operations sidebar — Incidents / Site plan / Call.
 * Pushes camera area; never overlays.
 */

import { DEMO_EPOCH_MS } from "../mock.js";
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
  toolKeyLabel,
  toolNameLabel,
  LOCATION_TOOL_KEYS,
  HIDDEN_TOOL_KEYS,
} from "../format.js";
import { redactPlaces } from "../site.js";
import { mountIncidentClip } from "./incidentClip.js";
import { clear, el, setText } from "../dom.js";
import { mountMap } from "./map.js";
import {
  legendMarkup,
  mountSiteCamerasList,
  mountTrackingCard,
  mountSiteOverview,
} from "./sitePlanExtras.js";
import { findCallIncident, formatCallTimer, buildThread } from "./call.js";
import { navigate } from "../router.js";
import { FOCUS_CAMERA_EVENT } from "./cameras.js";

function demoNowMs(state) {
  return DEMO_EPOCH_MS + (state.demo?.t ?? 0) * 1000;
}

export function mountSidebar(root, store, actions, layoutCtl) {
  let open = false;
  let tab = "incidents";
  let detailId = null;
  let mapApi = null;
  let mapHost = null;
  /** @type {{ destroy?: Function, paint?: Function }[]} */
  let mapExtras = [];
  let expandUnmount = null;
  let expandExtras = [];

  root.id = "sidebar";
  root.setAttribute("aria-label", "Incident panel");
  root.innerHTML = `
    <div class="sidebar">
      <header class="sidebar__head">
        <nav class="sidebar__tabs" data-tabs role="tablist">
          <button type="button" role="tab" data-tab="incidents" class="is-active">Incidents</button>
          <button type="button" role="tab" data-tab="map">Site plan</button>
          <button type="button" role="tab" data-tab="call" hidden>Call <span class="sim-tag">SIMULATED</span></button>
        </nav>
        <button type="button" class="btn btn--ghost" data-close aria-label="Close panel">Close</button>
      </header>
      <div class="sidebar__body">
        <div class="sidebar__panel" data-panel="incidents"></div>
        <div class="sidebar__panel" data-panel="map" hidden></div>
        <div class="sidebar__panel" data-panel="call" hidden></div>
      </div>
    </div>
  `;

  const tabsEl = root.querySelector("[data-tabs]");
  const panels = {
    incidents: root.querySelector('[data-panel="incidents"]'),
    map: root.querySelector('[data-panel="map"]'),
    call: root.querySelector('[data-panel="call"]'),
  };
  const callTabBtn = root.querySelector('[data-tab="call"]');

  root.querySelector("[data-close]").addEventListener("click", () => api.close());

  for (const btn of tabsEl.querySelectorAll("[data-tab]")) {
    btn.addEventListener("click", () => {
      tab = btn.dataset.tab;
      detailId = tab === "incidents" ? detailId : detailId;
      if (tab !== "incidents") detailId = tab === "incidents" ? detailId : null;
      paint();
    });
  }

  function setOpen(next, opts = {}) {
    open = next;
    root.hidden = !open;
    document.body.classList.toggle("sidebar-open", open);
    if (opts.tab) tab = opts.tab;
    if (opts.incidentId) {
      detailId = opts.incidentId;
      tab = "incidents";
    }
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

  function paintTabs(state) {
    const callInc = findCallIncident(state);
    callTabBtn.hidden = !callInc;
    for (const btn of tabsEl.querySelectorAll("[data-tab]")) {
      const on = btn.dataset.tab === tab && !btn.hidden;
      btn.classList.toggle("is-active", btn.dataset.tab === tab);
      btn.setAttribute("aria-selected", btn.dataset.tab === tab ? "true" : "false");
    }
    for (const [name, panel] of Object.entries(panels)) {
      panel.hidden = name !== tab;
    }
  }

  function paintIncidents(state) {
    const panel = panels.incidents;
    clear(panel);
    const nowMs = demoNowMs(state);

    if (detailId && state.incidents[detailId]) {
      const inc = state.incidents[detailId];
      const stack = el("div", { className: "sidebar-stack sidebar-stack--scroll" });

      stack.appendChild(
        el("button", {
          type: "button",
          className: "btn btn--ghost card",
          text: "← Incidents",
          onClick: () => {
            detailId = null;
            paint();
          },
        }),
      );

      const headCard = el("div", { className: "card detail-card" });
      const head = el("header", { className: "inc-card__row1" });
      head.appendChild(
        el("h2", {
          className: "inc-card__type",
          text: classLabel(inc.class_token),
        }),
      );
      const chips = el("div", { className: "inc-card__chips" });
      chips.appendChild(
        el("span", {
          className: `card-chip card-chip--${inc.severity === "SEVERE" ? "severe" : "minor"}`,
          text: severityLabel(inc.severity),
        }),
      );
      chips.appendChild(
        el("span", { className: "card-chip", text: stateLabel(inc.state) }),
      );
      if (isDispatchSimState(inc.state)) {
        chips.appendChild(
          el("span", {
            className: "card-chip card-chip--dispatch",
            text: "SIMULATED",
          }),
        );
      }
      head.appendChild(chips);
      headCard.appendChild(head);
      headCard.appendChild(
        el("p", {
          className: "inc-card__row2",
          text: `${cameraLabel(inc.camera_id)} · ${formatRel(inc.created_at || inc.peak_ts, nowMs)} · ${formatPct(inc.fused_prob)} confidence`,
        }),
      );
      stack.appendChild(headCard);

      const confCard = el("div", { className: "card detail-card" });
      confCard.appendChild(el("h3", { className: "card__title", text: "Confidence" }));
      confCard.appendChild(
        el("p", { className: "detail__conf mono", text: formatPct(inc.fused_prob) }),
      );
      const bar = el("progress", {
        className: "detail__conf-progress",
        attrs: {
          max: "100",
          value: String(Math.round(pctNumber(inc.fused_prob) || 0)),
        },
      });
      bar.max = 100;
      bar.value = Math.round(pctNumber(inc.fused_prob) || 0);
      confCard.appendChild(bar);
      stack.appendChild(confCard);

      const obsCard = el("div", { className: "card detail-card" });
      obsCard.appendChild(
        el("h3", { className: "card__title", text: "What the model saw" }),
      );
      obsCard.appendChild(
        el("blockquote", {
          className: "detail__quote",
          text: textOr(inc.description, notReported()),
        }),
      );
      stack.appendChild(obsCard);

      const personCard = el("div", { className: "card detail-card" });
      personCard.appendChild(el("h3", { className: "card__title", text: "Person" }));
      personCard.appendChild(
        el("p", {
          className: "card__body",
          text: textOr(inc.person_description, notReported()),
        }),
      );
      stack.appendChild(personCard);

      const clipCard = el("div", { className: "card detail-card" });
      clipCard.appendChild(el("h3", { className: "card__title", text: "Clip" }));
      const clipHost = el("div", { className: "detail__clip-host" });
      clipCard.appendChild(clipHost);
      if ((window.__transport?.mode || "MOCK") === "MOCK") {
        mountIncidentClip(clipHost, {
          cameraId: inc.camera_id,
          endTs: inc.peak_ts || inc.created_at,
        });
      } else if (inc.clip_uri) {
        clipCard.appendChild(
          el("p", { className: "card__meta mono", text: String(inc.clip_uri) }),
        );
      }
      stack.appendChild(clipCard);

      const rules = Array.isArray(inc.rules_fired) ? inc.rules_fired : [];
      const rulesCard = el("div", { className: "card detail-card" });
      rulesCard.appendChild(el("h3", { className: "card__title", text: "Rules fired" }));
      rulesCard.appendChild(
        el("p", {
          className: "card__meta mono",
          text: rules.length ? rules.map(String).join(" · ") : "None",
        }),
      );
      stack.appendChild(rulesCard);

      const tlCard = el("div", { className: "card detail-card" });
      tlCard.appendChild(el("h3", { className: "card__title", text: "Timeline" }));
      const tl = el("ol", { className: "detail__timeline" });
      for (const ev of Array.isArray(inc.timeline) ? inc.timeline : []) {
        const li = el("li", { className: "card__meta mono" });
        setText(
          li,
          `${formatTimeLocal(ev.ts)} · ${stateLabel(ev.state)}${ev.note ? ` · ${ev.note}` : ""}`,
        );
        tl.appendChild(li);
      }
      tlCard.appendChild(tl);
      stack.appendChild(tlCard);

      if (isOpenIncident(inc)) {
        const footer = el("footer", {
          className: "card detail-card detail-card__actions",
        });
        footer.appendChild(
          el("button", {
            type: "button",
            className: "btn btn--ghost",
            text: "Dismiss",
            onClick: () => {
              document.dispatchEvent(
                new CustomEvent("sentinel:dismiss", {
                  detail: { incidentId: inc.incident_id },
                }),
              );
            },
          }),
        );
        footer.appendChild(
          el("button", {
            type: "button",
            className: "btn btn--primary",
            text: "Confirm",
            onClick: () => actions.confirm(inc.incident_id),
          }),
        );
        stack.appendChild(footer);
      }

      panel.appendChild(stack);
      return;
    }

    const ids = state.order.filter((id) => {
      const inc = state.incidents[id];
      return inc && (inc.severity === "SEVERE" || inc.severity === "MINOR");
    });
    if (!ids.length) {
      panel.appendChild(
        el("p", {
          className: "iq-empty",
          text: "No activity requiring attention.",
        }),
      );
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
      if (isDispatchSimState(inc.state)) {
        chips.appendChild(
          el("span", {
            className: "card-chip card-chip--dispatch",
            text: "SIMULATED",
          }),
        );
      }
      top.appendChild(chips);
      row.appendChild(top);
      row.appendChild(
        el("div", {
          className: "inc-card__row2",
          text: `${cameraLabel(inc.camera_id)} · ${formatRel(inc.created_at || inc.peak_ts, nowMs)} · ${formatPct(inc.fused_prob)} confidence`,
        }),
      );
      row.addEventListener("click", () => {
        detailId = id;
        actions.select(id);
        if (inc.camera_id && layoutCtl) layoutCtl.swapMain(inc.camera_id);
        paint();
      });
      panel.appendChild(row);
    }
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
        let online = 0;
        for (const id of Object.keys(s.cameras || {})) {
          if (s.cameras[id]?.online !== false) online += 1;
        }
        setText(mapSub, `6 cameras · ${online} online`);
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
      let online = 0;
      const cams = s.cameras || {};
      for (const id of Object.keys(cams)) {
        if (cams[id]?.online !== false) online += 1;
      }
      if (onlineMeta) setText(onlineMeta, `6 cameras · ${online} online`);
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

  function paintCall(state) {
    const panel = panels.call;
    clear(panel);
    const inc = findCallIncident(state);
    if (!inc) {
      panel.appendChild(
        el("p", {
          className: "iq-empty",
          text: "No active call.",
        }),
      );
      return;
    }

    const stack = el("div", { className: "sidebar-stack sidebar-stack--scroll" });
    const nowMs = demoNowMs(state);
    const dts = state.call?.dispatchedAt;
    const started = formatRel(dts || inc.created_at || inc.peak_ts, nowMs);

    const head = el("div", { className: "card call-head-card" });
    const titleRow = el("div", { className: "call-head-card__title-row" });
    titleRow.appendChild(
      el("h2", {
        className: "call-head-card__title",
        text: `${classLabel(inc.class_token)} call`,
      }),
    );
    titleRow.appendChild(
      el("span", { className: "card-chip card-chip--dispatch", text: "SIMULATED" }),
    );
    head.appendChild(titleRow);
    const timer = el("span", { className: "call-head-card__timer mono" });
    setText(
      timer,
      dts ? formatCallTimer(nowMs - Date.parse(dts)) : "00:00",
    );
    head.appendChild(timer);
    head.appendChild(
      el("p", {
        className: "call-head-card__meta",
        text: `${cameraLabel(inc.camera_id)} · started ${started}`,
      }),
    );
    stack.appendChild(head);

    const chatCard = el("div", { className: "card chat-card" });
    const thread = buildThread(
      (state.call?.transcript || []).filter(
        (t) => !state.call.incidentId || t.incident_id === inc.incident_id,
      ),
    ).slice(-6);
    if (!thread.length) {
      chatCard.appendChild(
        el("p", {
          className: "card__meta",
          text: "Awaiting dispatch conversation.",
        }),
      );
    }
    for (const u of thread) {
      const row = el("div", { className: `chat-msg chat-msg--${u.speaker}` });
      row.appendChild(
        el("div", {
          className: "chat-msg__who",
          text: u.speaker === "dispatcher" ? "Dispatcher" : "Sentinel",
        }),
      );
      row.appendChild(
        el("div", {
          className: "chat-msg__bubble",
          text: redactPlaces(u.text),
        }),
      );
      chatCard.appendChild(row);
    }
    stack.appendChild(chatCard);

    const tools = (state.call?.tools || []).filter(
      (t) => !state.call.incidentId || t.incident_id === inc.incident_id,
    );
    const last = tools[tools.length - 1];
    if (last) {
      const toolCard = el("div", { className: "card tool-card" });
      toolCard.appendChild(
        el("h3", {
          className: "tool-card__name",
          text: toolNameLabel(last.tool),
        }),
      );
      if (last.result && typeof last.result === "object") {
        const dl = el("dl", { className: "call-tool__dl" });
        for (const [k, v] of Object.entries(last.result).slice(0, 6)) {
          if (HIDDEN_TOOL_KEYS.has(k)) continue;
          if (LOCATION_TOOL_KEYS.has(k)) continue;
          dl.appendChild(el("dt", { text: toolKeyLabel(k) }));
          dl.appendChild(
            el("dd", {
              className: "mono",
              text:
                k === "camera_id"
                  ? cameraLabel(String(v))
                  : k === "state"
                    ? stateLabel(String(v))
                    : typeof v === "string"
                      ? redactPlaces(v)
                      : String(v),
            }),
          );
        }
        toolCard.appendChild(dl);
      }
      stack.appendChild(toolCard);
    }

    const cta = el("div", { className: "sidebar-call__cta" });
    cta.appendChild(
      el("button", {
        type: "button",
        className: "btn btn--primary",
        text: "Open call console",
        onClick: () => navigate("call"),
      }),
    );
    stack.appendChild(cta);
    panel.appendChild(stack);
  }

  function paint() {
    if (!open) return;
    const state = store.getState();
    paintTabs(state);
    if (tab === "incidents") paintIncidents(state);
    if (tab === "map") {
      ensureMap(state);
    }
    if (tab === "call") paintCall(state);
  }

  function render(state) {
    if (!open) return;
    // Keep call tab visibility updated
    const callInc = findCallIncident(state);
    callTabBtn.hidden = !callInc;
    if (tab === "call" && !callInc) {
      tab = "incidents";
    }
    paint();
    const expand = document.getElementById("map-expand");
    if (expand && !expand.hidden) {
      for (const api of expandExtras) api.paint?.(state);
    }
  }

  const unsub = store.subscribe(render);

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const expand = document.getElementById("map-expand");
    if (expand && !expand.hidden) {
      expand._close?.();
      e.preventDefault();
      return;
    }
    if (open) {
      api.close();
      e.preventDefault();
    }
  });

  window.__sidebar = api;
  return api;
}
