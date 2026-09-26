/**
 * One incident list row, shared by the Live left column and the Incidents
 * page: a white card laid out as dot | main | meta, plus an always-visible
 * expand chevron that reveals Details plus the shared incident actions.
 * Chips use the on-card chip tokens (never dark-surface colours on white).
 * Closed rows are grey, not faded: chips and buttons keep full contrast.
 */

import { cameraTitle } from "../site.js?v=pro4";
import { classLabel, formatRel, isOpenIncident, severityLabel, stateLabel } from "../format.js?v=pro4";
import { el } from "../dom.js?v=pro4";
import { now } from "../clock.js?v=pro4";
import { icon } from "../icons.js?v=pro4";
import { incidentActions } from "./incidentActions.js?v=pro4";

function rowButton(text, cls, iconName, onClick, disabled = false) {
  const b = el("button", {
    type: "button",
    className: `btn btn--sm ${cls}`,
    disabled,
    onClick: (e) => {
      e.stopPropagation();
      onClick();
    },
  });
  if (iconName) b.appendChild(icon(iconName));
  b.appendChild(el("span", { text }));
  return b;
}

/**
 * @param {object} p
 * @param {object} p.inc incident
 * @param {number} [p.count] grouped open incidents like this one (×N)
 * @param {boolean} [p.selected]
 * @param {boolean} [p.expanded]
 * @param {() => void} p.onSelect row click
 * @param {() => void} p.onToggle chevron click
 * @param {() => void} p.onDetails
 * @param {object} [p.actions] store actions
 * @param {object} [p.store] store (for the shared action layout)
 * @param {string} [p.focusKey]
 */
export function incidentRow(p) {
  const { inc } = p;
  const id = inc.incident_id;
  const sev = inc.severity === "SEVERE" ? "severe" : "minor";
  const open = isOpenIncident(inc);
  const row = el("div", {
    className: `irow irow--${sev}${p.selected ? " is-selected" : ""}${open ? "" : " is-closed"}${p.expanded ? " is-expanded" : ""}`,
  });

  const hit = el("button", {
    type: "button",
    className: "irow__hit",
    attrs: { "data-focus-key": p.focusKey || `row-${id}`, "aria-label": `${classLabel(inc.class_token)}, ${severityLabel(inc.severity)}, ${stateLabel(inc.state)}` },
    onClick: p.onSelect,
  });
  hit.appendChild(el("span", { className: "irow__dot", attrs: { "aria-hidden": "true" } }));

  const main = el("span", { className: "irow__main" });
  const l1 = el("span", { className: "irow__l1" });
  l1.appendChild(el("span", { className: "irow__class", text: classLabel(inc.class_token) }));
  l1.appendChild(el("span", { className: `ochip ochip--${sev}`, text: severityLabel(inc.severity) }));
  if ((p.count || 1) > 1) {
    l1.appendChild(
      el("span", {
        className: "ochip ochip--state mono",
        text: `×${p.count}`,
        attrs: { title: `${p.count} open incidents like this on the same camera` },
      }),
    );
  }
  main.appendChild(l1);
  main.appendChild(el("span", { className: "irow__cam", text: cameraTitle(inc.camera_id) }));
  hit.appendChild(main);

  const meta = el("span", { className: "irow__meta" });
  const iso = inc.created_at || inc.peak_ts || "";
  // Ticked by the shared [data-ago-iso] ticker (incidentDetail.js).
  meta.appendChild(el("span", { className: "irow__ago mono", text: formatRel(iso, now()), dataset: { agoIso: iso } }));
  meta.appendChild(
    el("span", {
      className: open ? "irow__state" : "ochip ochip--state",
      text: stateLabel(inc.state),
    }),
  );
  hit.appendChild(meta);
  row.appendChild(hit);

  const chev = el("button", {
    type: "button",
    className: "btn btn--sm btn--icon irow__chev",
    attrs: {
      "aria-expanded": p.expanded ? "true" : "false",
      "aria-label": p.expanded ? "Hide actions" : "Show actions",
      title: p.expanded ? "Hide actions" : "Show actions",
    },
    onClick: (e) => {
      e.stopPropagation();
      p.onToggle();
    },
  });
  chev.appendChild(icon("chevron"));
  row.appendChild(chev);

  if (p.expanded) {
    // Same action layout as the focus card; Details sits above it.
    const acts = el("div", { className: "irow__actions" });
    acts.appendChild(rowButton("Details", "btn--secondary irow__details", "info", p.onDetails));
    if (open && p.actions && p.store) acts.appendChild(incidentActions(inc, p.actions, p.store));
    row.appendChild(acts);
  }
  return row;
}
