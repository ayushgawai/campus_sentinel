/** Incidents page — list + full detail. Status via type weight, not badges. */

import { DEMO_EPOCH_MS } from "../mock.js";
import {
  classLabel,
  cameraLabel,
  formatPct,
  formatRel,
  severityLabel,
  stateLabel,
  textOr,
  notReported,
  formatTimeLocal,
  pctNumber,
  isOpenIncident,
  isDispatchSimState,
} from "../format.js";
import { clear, el, setText } from "../dom.js";
import { mountIncidentClip } from "./incidentClip.js";

function demoNowMs(state) {
  return DEMO_EPOCH_MS + (state.demo?.t ?? 0) * 1000;
}

export function mountIncidents(listRoot, detailRoot, store, actions) {
  listRoot.innerHTML = `
    <article class="panel incidents-panel">
      <header class="panel__header">
        <h2 class="panel__title">Incidents</h2>
        <div class="panel__slot filter-bar" data-filters>
          <button type="button" class="is-active" data-filter="all">All</button>
          <button type="button" data-filter="SEVERE">Severe</button>
          <button type="button" data-filter="MINOR">Minor</button>
          <button type="button" data-filter="open">Open</button>
        </div>
      </header>
      <div class="panel__body iq__body">
        <div class="iq-list" data-list></div>
        <p class="iq-empty" data-empty hidden>No incidents match this filter.</p>
      </div>
    </article>
  `;

  detailRoot.innerHTML = `
    <article class="panel incidents-detail">
      <div class="panel__body" data-detail-body>
        <p class="iq-empty">Select an incident to review.</p>
      </div>
    </article>
  `;

  const listEl = listRoot.querySelector("[data-list]");
  const emptyEl = listRoot.querySelector("[data-empty]");
  const detailBody = detailRoot.querySelector("[data-detail-body]");
  let filter = "all";

  for (const btn of listRoot.querySelectorAll("[data-filter]")) {
    btn.addEventListener("click", () => {
      filter = btn.dataset.filter;
      for (const b of listRoot.querySelectorAll("[data-filter]")) {
        b.classList.toggle("is-active", b === btn);
      }
      render(store.getState());
    });
  }

  function matches(inc) {
    if (filter === "all") return true;
    if (filter === "SEVERE" || filter === "MINOR") return inc.severity === filter;
    if (filter === "open") return isOpenIncident(inc);
    return true;
  }

  function paintDetail(inc) {
    clear(detailBody);
    if (!inc) {
      detailBody.appendChild(
        el("p", {
          className: "iq-empty",
          text: "Select an incident to review.",
        }),
      );
      return;
    }

    const head = el("header", { className: "incidents-detail__head" });
    head.appendChild(
      el("h2", {
        className: "detail__class",
        text: classLabel(inc.class_token),
      }),
    );
    head.appendChild(
      el("span", {
        className: `status status--${inc.severity === "SEVERE" ? "severe" : inc.severity === "MINOR" ? "warn" : "info"}`,
        text: severityLabel(inc.severity),
      }),
    );
    head.appendChild(
      el("span", {
        className: "status",
        text: stateLabel(inc.state),
      }),
    );
    if (isDispatchSimState(inc.state)) {
      head.appendChild(el("span", { className: "sim-tag", text: "SIMULATED" }));
    }
    detailBody.appendChild(head);

    detailBody.appendChild(
      el("p", {
        className: "detail__line",
        text: `${cameraLabel(inc.camera_id)} · ${formatTimeLocal(inc.peak_ts)}`,
      }),
    );

    const conf = el("div", { className: "detail__conf mono" });
    setText(conf, `Confidence ${formatPct(inc.fused_prob)}`);
    detailBody.appendChild(conf);
    const bar = el("progress", {
      className: "detail__conf-progress",
      attrs: {
        max: "100",
        value: String(Math.round(pctNumber(inc.fused_prob) || 0)),
        "aria-label": "Confidence",
      },
    });
    bar.max = 100;
    bar.value = Math.round(pctNumber(inc.fused_prob) || 0);
    detailBody.appendChild(bar);

    detailBody.appendChild(
      el("h3", {
        className: "call-col-h",
        text: "Observation",
      }),
    );
    detailBody.appendChild(
      el("blockquote", {
        className: "detail__quote",
        text: textOr(inc.description, notReported()),
      }),
    );
    detailBody.appendChild(
      el("p", {
        className: "detail__line",
        text: `Person: ${textOr(inc.person_description, notReported())}`,
      }),
    );
    detailBody.appendChild(
      el("p", {
        className: "detail__line",
        text: `Camera: ${cameraLabel(inc.camera_id)}`,
      }),
    );

    const clipHost = el("div", { className: "detail__clip-host" });
    detailBody.appendChild(clipHost);
    if ((window.__transport?.mode || "MOCK") === "MOCK") {
      mountIncidentClip(clipHost, {
        cameraId: inc.camera_id,
        endTs: inc.peak_ts || inc.created_at,
      });
    }

    const rules = Array.isArray(inc.rules_fired) ? inc.rules_fired : [];
    detailBody.appendChild(
      el("h3", { className: "call-col-h", text: "Rules fired" }),
    );
    if (!rules.length) {
      detailBody.appendChild(
        el("p", { className: "iq-empty", text: "None" }),
      );
    } else {
      const rulesList = el("p", { className: "detail__line mono" });
      setText(rulesList, rules.map(String).join(" · "));
      detailBody.appendChild(rulesList);
    }

    detailBody.appendChild(
      el("h3", { className: "call-col-h", text: "Timeline" }),
    );
    const tl = el("ol", { className: "detail__timeline" });
    for (const ev of Array.isArray(inc.timeline) ? inc.timeline : []) {
      const li = el("li", { className: "detail__line mono" });
      setText(
        li,
        `${formatTimeLocal(ev.ts)} · ${stateLabel(ev.state)}${ev.note ? ` · ${ev.note}` : ""}`,
      );
      tl.appendChild(li);
    }
    detailBody.appendChild(tl);

    if (isOpenIncident(inc)) {
      const footer = el("footer", { className: "detail__footer" });
      footer.appendChild(
        el("button", {
          type: "button",
          className: "btn btn--primary",
          text: "Confirm",
          onClick: () => actions.confirm(inc.incident_id),
        }),
      );
      footer.appendChild(
        el("button", {
          type: "button",
          className: "btn btn--danger",
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
      detailBody.appendChild(footer);
    }
  }

  function render(state) {
    if (state.route !== "incidents") return;
    const nowMs = demoNowMs(state);
    const ids = state.order.filter((id) => {
      const inc = state.incidents[id];
      return inc && matches(inc);
    });

    clear(listEl);
    emptyEl.hidden = ids.length > 0;

    for (const id of ids) {
      const inc = state.incidents[id];
      const row = el("article", {
        className: `iq-row${state.selectedId === id ? " is-selected" : ""}`,
      });
      row.appendChild(
        el("span", {
          className: `iq-row__bar iq-row__bar--${inc.severity || "NONE"}`,
        }),
      );
      const btn = el("button", {
        type: "button",
        className: "iq-row__hit",
        dataset: { id },
      });
      const top = el("div", { className: "iq-row__top" });
      top.appendChild(
        el("span", {
          className: "iq-row__type",
          text: classLabel(inc.class_token),
        }),
      );
      const stateWrap = el("span", { className: "iq-row__state-wrap" });
      stateWrap.appendChild(
        el("span", {
          className: "iq-row__state",
          text: stateLabel(inc.state),
        }),
      );
      if (isDispatchSimState(inc.state)) {
        stateWrap.appendChild(el("span", { className: "sim-tag", text: "SIMULATED" }));
      }
      top.appendChild(stateWrap);
      const meta = el("div", { className: "iq-row__meta" });
      meta.appendChild(
        el("span", { className: "iq-row__loc", text: cameraLabel(inc.camera_id) }),
      );
      meta.appendChild(
        el("span", {
          className: "mono",
          text: formatRel(inc.created_at || inc.peak_ts, nowMs),
        }),
      );
      meta.appendChild(
        el("span", {
          className: "mono",
          text: formatPct(inc.fused_prob),
        }),
      );
      btn.appendChild(top);
      btn.appendChild(meta);
      btn.addEventListener("click", () => actions.select(id));
      row.appendChild(btn);
      listEl.appendChild(row);
    }

    const sel = state.selectedId ? state.incidents[state.selectedId] : null;
    paintDetail(
      sel && matches(sel) ? sel : ids[0] ? state.incidents[ids[0]] : null,
    );
  }

  render(store.getState());
  const unsub = store.subscribe(render);
  const tick = window.setInterval(() => {
    if (store.getState().route === "incidents") render(store.getState());
  }, 1000);

  return () => {
    unsub();
    window.clearInterval(tick);
  };
}
