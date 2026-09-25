/** Incidents page — list + full detail. Status via type weight, not badges. */

import { cameraTitle } from "../site.js?v=fix9b";
import { now, subscribeTick } from "../clock.js?v=fix9b";
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
} from "../format.js?v=fix9b";
import { clear, el, setText } from "../dom.js?v=fix9b";
import { OP_STATUS_EVENT, actionBar, confidenceShort } from "./operator.js?v=fix9b";
import {
  detailHeaderCard,
  detailsCard,
  clipCard,
  timelineCard,
  emptyState,
} from "./incidentDetail.js?v=fix9b";

/** Same entries by identity (store replaces an incident object when it changes). */
function sameSig(a, b) {
  return Boolean(a && b && a.length === b.length && a.every((x, i) => x === b[i]));
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
        <div data-empty hidden></div>
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
      detailBody.appendChild(emptyState("Select an incident to review."));
      return;
    }

    // Same cards as the incidents panel detail (header, Details, clip, timeline).
    const stack = el("div", { className: "inc-detail inc-detail--page" });
    stack.appendChild(detailHeaderCard(inc));
    stack.appendChild(detailsCard(inc));
    const clip = clipCard(inc);
    if (clip) stack.appendChild(clip);
    stack.appendChild(timelineCard(inc));
    detailBody.appendChild(stack);

    if (isOpenIncident(inc)) {
      // Same action bar as the incidents panel.
      const footer = el("footer", { className: "detail__footer detail__footer--op" });
      footer.appendChild(actionBar(inc, actions, { card: false }));
      detailBody.appendChild(footer);
    }
  }

  /** Row "ago" nodes; the ticker refreshes only these. */
  let agoNodes = [];

  function paintTimes(nowMs = now()) {
    if (store.getState().route !== "incidents") return;
    for (const { node, iso } of agoNodes) setText(node, formatRel(iso, nowMs));
  }

  let opVersion = 0;
  let lastSig = null;

  function render(state) {
    if (state.route !== "incidents") return;
    // Rebuild only when the incidents, selection, filter or an operator
    // status changed — the store notifies every frame in mock, and a rebuild
    // between mousedown and mouseup swallows the click.
    const sig = [filter, state.selectedId, opVersion, ...state.order.map((id) => state.incidents[id])];
    if (sameSig(sig, lastSig)) return;
    lastSig = sig;
    const focusKey = detailRoot.contains(document.activeElement)
      ? document.activeElement.dataset.focusKey
      : null;
    agoNodes = [];
    const ids = state.order.filter((id) => {
      const inc = state.incidents[id];
      return inc && matches(inc);
    });

    clear(listEl);
    emptyEl.hidden = ids.length > 0;
    clear(emptyEl);
    if (!ids.length) {
      emptyEl.appendChild(
        state.order.length
          ? emptyState("No incidents match this filter.")
          : emptyState("No active incidents", "All cameras are being monitored."),
      );
    }

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
      top.appendChild(stateWrap);
      const meta = el("div", { className: "iq-row__meta" });
      meta.appendChild(
        el("span", { className: "iq-row__loc", text: cameraTitle(inc.camera_id) }),
      );
      const agoEl = el("span", { className: "mono" });
      agoNodes.push({ node: agoEl, iso: inc.created_at || inc.peak_ts });
      meta.appendChild(agoEl);
      meta.appendChild(
        el("span", {
          className: "mono",
          text: confidenceShort(inc),
        }),
      );
      btn.appendChild(top);
      btn.appendChild(meta);
      btn.addEventListener("click", () => actions.select(id));
      row.appendChild(btn);
      listEl.appendChild(row);
    }

    paintTimes();
    const sel = state.selectedId ? state.incidents[state.selectedId] : null;
    paintDetail(
      sel && matches(sel) ? sel : ids[0] ? state.incidents[ids[0]] : null,
    );
    if (focusKey) detailRoot.querySelector(`[data-focus-key="${focusKey}"]`)?.focus();
  }

  function onOpStatus() {
    opVersion += 1;
    render(store.getState());
  }

  render(store.getState());
  const unsub = store.subscribe(render);
  const unsubTick = subscribeTick(paintTimes);
  document.addEventListener(OP_STATUS_EVENT, onOpStatus);

  return () => {
    unsub();
    unsubTick();
    document.removeEventListener(OP_STATUS_EVENT, onOpStatus);
  };
}
