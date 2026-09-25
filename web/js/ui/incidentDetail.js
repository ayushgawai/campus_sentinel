/**
 * Incident detail building blocks shared by the incidents panel and the
 * Incidents page (Fix 5b): header card, one "Details" card, clip card (only
 * when there is something to play), timeline card. All text via textContent.
 */

import {
  classLabel,
  cameraLabel,
  formatPct,
  formatRel,
  formatTimeLocal,
  notReported,
  pctNumber,
  severityLabel,
  stateLabel,
  isDispatchSimState,
} from "../format.js";
import { el, setText } from "../dom.js";
import { now, subscribeTick } from "../clock.js";
import { isOperatorReported } from "../actions.js";
import * as cameraSources from "../cameraSources.js";
import { mountIncidentClip } from "./incidentClip.js";

const UNCONFIRMED_RE = /\s*·\s*not confirmed by server\s*$/i;

// One ticker for every "27 s ago" in a detail header.
subscribeTick((nowMs) => {
  for (const node of document.querySelectorAll("[data-ago-iso]")) {
    setText(node, formatRel(node.dataset.agoIso, nowMs));
  }
});

function unconfirmedTag() {
  return el("span", { className: "op-unconfirmed", text: "Not confirmed by server" });
}

/** operator_report → "Operator report", fast_descent → "Fast descent". */
export function ruleLabel(rule) {
  const s = String(rule || "").replaceAll("_", " ").replaceAll("-", " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";
}

/** Report created locally because the server did not confirm it. */
function reportUnconfirmed(inc) {
  return String(inc?.incident_id || "").startsWith("op-local-");
}

/**
 * Header card: optional back link, type + chips, meta line
 * "Camera 3 · 27 s ago · Reported by operator [· Not confirmed by server]".
 */
export function detailHeaderCard(inc, { onBack = null } = {}) {
  const card = el("div", { className: "card detail-card inc-head" });

  if (onBack) {
    card.appendChild(
      el("button", {
        type: "button",
        className: "inc-head__back",
        text: "← All incidents",
        attrs: { "data-focus-key": "back" },
        onClick: onBack,
      }),
    );
  }

  const row = el("div", { className: "inc-head__row" });
  row.appendChild(el("h2", { className: "inc-head__title", text: classLabel(inc.class_token) }));
  const chips = el("div", { className: "inc-head__chips" });
  chips.appendChild(
    el("span", {
      className: `card-chip card-chip--${inc.severity === "SEVERE" ? "severe" : "minor"}`,
      text: severityLabel(inc.severity),
    }),
  );
  chips.appendChild(el("span", { className: "card-chip", text: stateLabel(inc.state) }));
  if (isDispatchSimState(inc.state)) {
    chips.appendChild(el("span", { className: "card-chip card-chip--dispatch", text: "SIMULATED" }));
  }
  row.appendChild(chips);
  card.appendChild(row);

  const meta = el("p", { className: "inc-head__meta" });
  meta.appendChild(document.createTextNode(`${cameraLabel(inc.camera_id)} · `));
  const iso = inc.created_at || inc.peak_ts || "";
  const ago = el("span", { dataset: { agoIso: iso } });
  setText(ago, formatRel(iso, now()));
  meta.appendChild(ago);
  if (isOperatorReported(inc)) {
    meta.appendChild(document.createTextNode(" · Reported by operator"));
    if (reportUnconfirmed(inc)) {
      meta.appendChild(document.createTextNode(" · "));
      meta.appendChild(unconfirmedTag());
    }
  }
  card.appendChild(meta);
  return card;
}

/** One "Details" card: two-column definition list, empty rows hidden. */
export function detailsCard(inc) {
  const card = el("div", { className: "card detail-card" });
  card.appendChild(el("h3", { className: "inc-section-title", text: "Details" }));
  const dl = el("dl", { className: "inc-dl" });
  const operator = isOperatorReported(inc);

  const row = (label, value) => {
    dl.appendChild(el("dt", { text: label }));
    const dd = el("dd");
    if (typeof value === "string") dd.textContent = value;
    else dd.appendChild(value);
    dl.appendChild(dd);
  };

  const desc = String(inc.description || "").trim();
  row("Observation", desc || (operator ? "Reported by operator" : notReported()));

  const person = String(inc.person_description || "").trim();
  if (person) row("Person", person);

  if (!(operator && inc.fused_prob == null)) {
    const wrap = el("div", { className: "inc-dl__conf" });
    wrap.appendChild(el("span", { className: "mono", text: formatPct(inc.fused_prob) }));
    const bar = el("progress", {
      className: "detail__conf-progress inc-dl__bar",
      attrs: { max: "100", "aria-label": "Confidence" },
    });
    bar.max = 100;
    bar.value = Math.round(pctNumber(inc.fused_prob) || 0);
    wrap.appendChild(bar);
    row("Confidence", wrap);
  }

  const rules = (Array.isArray(inc.rules_fired) ? inc.rules_fired : [])
    .map(ruleLabel)
    .filter(Boolean);
  if (rules.length) {
    const chips = el("div", { className: "inc-dl__chips" });
    for (const r of rules) chips.appendChild(el("span", { className: "card-chip", text: r }));
    row("Rules", chips);
  }

  card.appendChild(dl);
  return card;
}

/**
 * Clip card, or null when nothing can play: mock needs a loaded local video
 * for the camera; live needs an http(s) clip_uri.
 */
export function clipCard(inc) {
  const mode = window.__transport?.mode || "MOCK";
  const card = el("div", { className: "card detail-card" });
  card.appendChild(el("h3", { className: "inc-section-title", text: "Clip" }));
  const host = el("div", { className: "detail__clip-host" });
  card.appendChild(host);

  if (mode === "MOCK") {
    const src = cameraSources.get(inc.camera_id);
    if (!src || src.status !== "ready" || !src.url) return null;
    mountIncidentClip(host, { cameraId: inc.camera_id, endTs: inc.peak_ts || inc.created_at });
    return card;
  }

  const uri = String(inc.clip_uri || "");
  if (!/^https?:\/\//i.test(uri)) return null;
  const video = el("video", {
    className: "detail__clip-video",
    attrs: { controls: "", muted: "", playsinline: "", preload: "metadata" },
  });
  video.src = uri;
  host.classList.add("detail__clip");
  host.appendChild(video);
  return card;
}

/** Timeline: one row per entry — time | state chip | note (hanging indent). */
export function timelineCard(inc) {
  const card = el("div", { className: "card detail-card" });
  card.appendChild(el("h3", { className: "inc-section-title", text: "Timeline" }));
  const list = el("ul", { className: "inc-tl" });
  for (const ev of Array.isArray(inc.timeline) ? inc.timeline : []) {
    const li = el("li", { className: "inc-tl__row" });
    li.appendChild(el("span", { className: "inc-tl__time mono", text: formatTimeLocal(ev.ts) }));
    li.appendChild(el("span", { className: "card-chip inc-tl__state", text: stateLabel(ev.state) }));
    const note = el("span", { className: "inc-tl__note" });
    const raw = String(ev.note || "");
    const unconfirmed = UNCONFIRMED_RE.test(raw);
    note.appendChild(document.createTextNode(raw.replace(UNCONFIRMED_RE, "")));
    if (unconfirmed) {
      note.appendChild(document.createTextNode(" "));
      note.appendChild(unconfirmedTag());
    }
    li.appendChild(note);
    list.appendChild(li);
  }
  card.appendChild(list);
  return card;
}
