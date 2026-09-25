/** Active incidents — expandable rows. Hierarchy via type weight, not badges. */

import { DEMO_EPOCH_MS } from "../mock.js";
import { WALL_CAMERA_IDS } from "../site.js";
import {
  classLabel,
  cameraShort,
  cameraLabel,
  formatPct,
  formatRel,
  stateLabel,
  textOr,
  notReported,
  isOpenIncident,
  isDispatchSimState,
} from "../format.js";
import { clear, el, setText } from "../dom.js";

function demoNowMs(state) {
  return DEMO_EPOCH_MS + (state.demo?.t ?? 0) * 1000;
}

function opsSummary(inc, nowMs) {
  const loc = cameraLabel(inc.camera_id);
  const ago = formatRel(inc.created_at || inc.peak_ts, nowMs);
  if (inc.state === "DISPATCHED" || inc.state === "TRACKING") {
    return `Unit notified · ${loc} · ${ago}`;
  }
  if (inc.state === "DISPATCH_PENDING") {
    return `Dispatch pending · ${loc}`;
  }
  if (inc.state === "ALERTED" || inc.state === "NEW") {
    return `Awaiting officer review · last seen ${loc}, ${ago}`;
  }
  return `${stateLabel(inc.state)} · ${loc}`;
}

export function mountQueue(root, store, actions) {
  const nCams = WALL_CAMERA_IDS.length;
  root.innerHTML = `
    <article class="panel iq">
      <header class="panel__header">
        <h2 class="panel__title">Active incidents</h2>
        <div class="panel__slot">
          <span class="metric mono" data-q-count>0</span>
        </div>
      </header>
      <div class="panel__body iq__body">
        <div class="iq-empty" data-empty>
          No activity requiring attention. ${nCams} cameras monitored.
        </div>
        <div class="iq-list" data-list hidden></div>
      </div>
    </article>
  `;

  const countEl = root.querySelector("[data-q-count]");
  const emptyEl = root.querySelector("[data-empty]");
  const listEl = root.querySelector("[data-list]");
  let tick = 0;

  function renderRow(inc, nowMs, selected) {
    const sev = inc.severity || "NONE";
    const open = isOpenIncident(inc);
    const row = el("article", {
      className: `iq-row${selected ? " is-selected" : ""}`,
      dataset: { id: inc.incident_id },
    });

    row.appendChild(
      el("span", {
        className: `iq-row__bar iq-row__bar--${sev}`,
        attrs: { "aria-hidden": "true" },
      }),
    );

    const hit = el("button", {
      type: "button",
      className: "iq-row__hit",
      attrs: {
        "aria-expanded": selected ? "true" : "false",
        "aria-label": `${classLabel(inc.class_token)}, ${stateLabel(inc.state)}`,
      },
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
    const loc = el("span", {
      className: "iq-row__loc",
      text: cameraShort(inc.camera_id),
    });
    loc.title = cameraShort(inc.camera_id);
    meta.appendChild(loc);
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

    hit.appendChild(top);
    hit.appendChild(meta);
    hit.addEventListener("click", () => {
      if (selected) actions.clearSelection();
      else actions.select(inc.incident_id);
    });

    row.appendChild(hit);

    if (selected) {
      const body = el("div", { className: "iq-row__expand" });
      body.appendChild(
        el("p", {
          className: "iq-row__desc",
          text: opsSummary(inc, nowMs),
        }),
      );
      body.appendChild(
        el("p", {
          className: "iq-row__desc",
          text: textOr(inc.description, notReported()),
        }),
      );
      if (open) {
        const actionsRow = el("div", { className: "iq-row__actions" });
        actionsRow.appendChild(
          el("button", {
            type: "button",
            className: "btn btn--primary",
            text: "Confirm",
            onClick: (e) => {
              e.stopPropagation();
              actions.confirm(inc.incident_id);
            },
          }),
        );
        actionsRow.appendChild(
          el("button", {
            type: "button",
            className: "btn btn--danger",
            text: "Dismiss",
            onClick: (e) => {
              e.stopPropagation();
              document.dispatchEvent(
                new CustomEvent("sentinel:dismiss", {
                  detail: { incidentId: inc.incident_id },
                }),
              );
            },
          }),
        );
        body.appendChild(actionsRow);
      }
      row.appendChild(body);
    }

    return row;
  }

  function render(state) {
    const nowMs = demoNowMs(state);
    const ids = state.order;
    setText(countEl, String(ids.length));

    if (ids.length === 0) {
      emptyEl.hidden = false;
      listEl.hidden = true;
      clear(listEl);
      return;
    }

    emptyEl.hidden = true;
    listEl.hidden = false;
    clear(listEl);

    for (const id of ids) {
      const inc = state.incidents[id];
      if (!inc) continue;
      listEl.appendChild(renderRow(inc, nowMs, state.selectedId === id));
    }
  }

  render(store.getState());
  const unsub = store.subscribe(render);
  tick = window.setInterval(() => render(store.getState()), 1000);

  return () => {
    unsub();
    if (tick) window.clearInterval(tick);
  };
}
