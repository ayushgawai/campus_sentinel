/**
 * AI models table: Role | Model | Runtime | Status. Shared by the header
 * card and the System page so both always show the same rows. A measured
 * metric (Detection step p95) sits under the model name, never a placeholder.
 */

import { el } from "../dom.js?v=fix9b";
import { MODELS_FOOTER } from "../models.js?v=fix9b";
import { STATUS_DOT, STATUS_LABEL, modelRows, modelsSignature } from "../modelStatus.js?v=fix9b";

const COLUMNS = ["Role", "Model", "Runtime", "Status"];

/**
 * @param {{ className?: string }} [opts]
 * @returns {{ el: HTMLElement, update: (state: object) => { overall: string } }}
 */
export function createModelsTable(opts = {}) {
  const root = el("div", { className: `mtable ${opts.className || ""}`.trim() });
  const table = el("table", { className: "mtable__table" });
  const thead = el("thead");
  const headRow = el("tr");
  for (const c of COLUMNS) {
    headRow.appendChild(el("th", { scope: "col", text: c }));
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = el("tbody");
  table.appendChild(tbody);
  root.appendChild(table);
  root.appendChild(el("p", { className: "mtable__foot", text: MODELS_FOOTER }));

  let sig = "";

  function update(state) {
    const view = modelRows(state);
    const next = modelsSignature(view);
    if (next === sig) return view;
    sig = next;
    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
    for (const r of view.rows) {
      const tr = el("tr");
      tr.appendChild(el("th", { scope: "row", className: "mtable__role", text: r.role }));

      const model = el("td", { className: "mtable__model" });
      model.appendChild(el("span", { className: "mtable__name", text: r.name }));
      if (r.metric) {
        model.appendChild(el("span", { className: "mtable__metric mono", text: r.metric }));
      }
      tr.appendChild(model);

      tr.appendChild(
        el("td", {
          className: `mtable__runtime${r.runtime === "HP Z Runtime" ? " is-zrt" : ""}`,
          text: r.runtime,
        }),
      );

      const status = el("td", { className: `mtable__status is-${r.status}` });
      status.appendChild(
        el("span", { className: `dot ${STATUS_DOT[r.status]}`, attrs: { "aria-hidden": "true" } }),
      );
      status.appendChild(el("span", { text: STATUS_LABEL[r.status] }));
      tr.appendChild(status);
      tbody.appendChild(tr);
    }
    return view;
  }

  return { el: root, update };
}
