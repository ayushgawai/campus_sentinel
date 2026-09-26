/**
 * AI models: a live status table — Role | Model | Runtime | Status |
 * Last active | Live metric — shared by the header card and the System
 * page. Status and metrics come from modelActivity.js (real events only);
 * it refreshes every second. Only models actually in use are listed.
 */

import { el } from "../dom.js?v=pro3";
import { formatClock } from "../format.js?v=pro3";
import { subscribeTick } from "../clock.js?v=pro3";
import { modelRows } from "../modelStatus.js?v=pro3";
import { liveModelRows } from "../modelActivity.js?v=pro3";

const COLUMNS = ["Role", "Model", "Runtime", "Status", "Last active", "Live metric"];
const STATUS_TEXT = { active: "Active", idle: "Idle", offline: "Offline", error: "Error", connecting: "Connecting" };

/**
 * @param {{ className?: string, store?: object }} [opts]
 * @returns {{ el: HTMLElement, update: (state: object) => object, summary: () => string }}
 */
export function createModelsTable(opts = {}) {
  const root = el("div", { className: `mtable ${opts.className || ""}`.trim() });
  const table = el("table", { className: "mtable__table" });
  const thead = el("thead");
  const headRow = el("tr");
  COLUMNS.forEach((c, i) => {
    headRow.appendChild(el("th", { scope: "col", text: c, className: i >= 4 ? "mtable__extra" : "" }));
  });
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = el("tbody");
  table.appendChild(tbody);
  root.appendChild(table);

  let sig = "";
  let lastState = null;
  let counts = { active: 0, ready: 0 };
  const listeners = new Set();

  function paint(state, nowMs) {
    const view = liveModelRows(state, nowMs);
    counts = { active: view.active, ready: view.ready };
    const next = view.rows
      .map((r) => `${r.id}|${r.name}|${r.runtime}|${r.status}|${r.at}|${r.metric}`)
      .join("~");
    if (next === sig) return;
    sig = next;
    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
    for (const r of view.rows) {
      const tr = el("tr", { className: `is-${r.status}` });
      tr.appendChild(el("th", { scope: "row", className: "mtable__role", text: r.role }));
      const model = el("td", { className: "mtable__model" });
      model.appendChild(el("span", { className: "mtable__name", text: r.name, attrs: { title: r.name } }));
      tr.appendChild(model);
      const rt = el("td", { className: `mtable__runtime${r.runtime === "HP Z Runtime" ? " is-zrt" : ""}` });
      if (r.runtime === "Cloud") rt.appendChild(el("span", { className: "ochip ochip--state", text: "Cloud" }));
      else rt.textContent = r.runtime;
      tr.appendChild(rt);
      const status = el("td", { className: `mtable__status is-${r.status}` });
      status.appendChild(el("span", { className: `mdot mdot--${r.status}`, attrs: { "aria-hidden": "true" } }));
      status.appendChild(el("span", { text: STATUS_TEXT[r.status] }));
      tr.appendChild(status);
      tr.appendChild(
        el("td", { className: "mtable__at mono mtable__extra", text: r.at ? formatClock(r.at) : "—" }),
      );
      tr.appendChild(el("td", { className: "mtable__metric mono mtable__extra", text: r.metric }));
      tbody.appendChild(tr);
    }
    for (const fn of listeners) fn();
  }

  /** Keeps the old contract: returns { overall } for the header chip. */
  function update(state) {
    lastState = state;
    paint(state);
    return modelRows(state);
  }

  subscribeTick((ms) => {
    if (lastState) paint(opts.store ? opts.store.getState() : lastState, ms);
  });

  return {
    el: root,
    update,
    summary: () => `${counts.active} active · ${counts.ready} ready`,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
