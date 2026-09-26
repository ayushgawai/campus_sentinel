/**
 * Incident detail building blocks shared by the incidents panel and the
 * Incidents page (Fix 5b): header card, one "Details" card, clip card (only
 * when there is something to play), timeline card. All text via textContent.
 */

import { cameraTitle } from "../site.js?v=pro4";
import {
  classLabel,
  cameraLabel,
  formatPct,
  formatRel,
  formatTimeLocal,
  pctNumber,
  ruleLabel,
  severityLabel,
  stateLabel,
} from "../format.js?v=pro4";
import { el, setText } from "../dom.js?v=pro4";
import { now, subscribeTick } from "../clock.js?v=pro4";
import { isOperatorReported } from "../actions.js?v=pro4";
import * as cameraSources from "../cameraSources.js?v=pro4";
import { mountIncidentClip } from "./incidentClip.js?v=pro4";

/** Timeline notes the UI wrote while the server had not confirmed an action. */
const UNCONFIRMED_RE = /\s*·\s*(pending server confirmation|not confirmed by server)\s*$/i;

// One ticker for every "27 s ago" in a detail header.
subscribeTick((nowMs) => {
  for (const node of document.querySelectorAll("[data-ago-iso]")) {
    setText(node, formatRel(node.dataset.agoIso, nowMs));
  }
});

function unconfirmedTag() {
  return el("span", { className: "op-unconfirmed", text: "Pending server confirmation" });
}

/** Report created locally because the server did not confirm it. */
function reportUnconfirmed(inc) {
  return String(inc?.incident_id || "").startsWith("op-local-");
}

/**
 * Header card: "← All incidents" (small ghost link), the class title with
 * severity + state chips on the same baseline, the camera line, then the
 * relative time on its own mono line.
 */
export function detailHeaderCard(inc, { onBack = null } = {}) {
  const card = el("div", { className: "card detail-card inc-head" });

  if (onBack) {
    card.appendChild(
      el("button", {
        type: "button",
        className: "btn btn--ghost btn--sm inc-head__back",
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
      className: `chip chip--${inc.severity === "SEVERE" ? "severe" : "minor"}`,
      text: severityLabel(inc.severity),
    }),
  );
  chips.appendChild(el("span", { className: "chip chip--state", text: stateLabel(inc.state) }));
  row.appendChild(chips);
  card.appendChild(row);

  card.appendChild(el("p", { className: "inc-head__meta", text: cameraTitle(inc.camera_id) }));

  const time = el("p", { className: "inc-head__time mono" });
  const iso = inc.created_at || inc.peak_ts || "";
  const ago = el("span", { dataset: { agoIso: iso } });
  setText(ago, formatRel(iso, now()));
  time.appendChild(ago);
  if (isOperatorReported(inc)) {
    time.appendChild(document.createTextNode(" · Reported by operator"));
    if (reportUnconfirmed(inc)) {
      time.appendChild(document.createTextNode(" · "));
      time.appendChild(unconfirmedTag());
    }
  }
  card.appendChild(time);
  return card;
}

/** Internal tags such as "[zrt-cached]": display names for the tiny chip. */
const TAG_RE = /\s*\[([a-z0-9_:.-]+)\]\s*/gi;
function tagLabel(tag) {
  const t = String(tag).toLowerCase();
  const last = t.split(/[-_:.]/).filter(Boolean).pop() || t;
  return last;
}

/** Observation text without "[tags]" (display only), plus the tags found. */
export function splitTags(text) {
  const tags = [];
  const clean = String(text || "")
    .replace(TAG_RE, (_m, tag) => {
      tags.push(tagLabel(tag));
      return " ";
    })
    .replace(/\s{2,}/g, " ")
    .trim();
  return { clean, tags };
}

/** One "Details" card: fixed 96 px label column, hairline rows. */
export function detailsCard(inc) {
  const card = el("div", { className: "card detail-card" });
  card.appendChild(el("h3", { className: "inc-section-title", text: "Details" }));
  const dl = el("dl", { className: "kv inc-dl" });
  const operator = isOperatorReported(inc);

  const row = (label, value) => {
    const wrap = el("div", { className: "kv__row" });
    wrap.appendChild(el("dt", { className: "kv__k", text: label }));
    const dd = el("dd", { className: "kv__v" });
    if (typeof value === "string") dd.textContent = value;
    else dd.appendChild(value);
    wrap.appendChild(dd);
    dl.appendChild(wrap);
  };

  const desc = String(inc.description || "").trim();
  if (desc || operator) {
    const { clean, tags } = splitTags(desc);
    if (tags.length) {
      const v = el("span", { className: "inc-dl__obs" });
      v.appendChild(document.createTextNode(clean || "Reported by operator"));
      for (const t of tags) v.appendChild(el("span", { className: "chip chip--tag mono", text: t }));
      row("Observation", v);
    } else {
      row("Observation", clean || "Reported by operator");
    }
  }

  const person = String(inc.person_description || "").trim();
  if (person) row("Person", person);

  // Hidden when there is no score (operator reports, or not scored yet).
  if (inc.fused_prob != null) {
    const pct = Math.max(0, Math.min(100, Math.round(pctNumber(inc.fused_prob) || 0)));
    const wrap = el("div", { className: "inc-dl__conf" });
    wrap.appendChild(el("span", { className: "mono", text: formatPct(inc.fused_prob) }));
    const track = el("span", {
      className: "conf-bar",
      attrs: { role: "meter", "aria-label": "Confidence", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct) },
    });
    const fill = el("span", { className: "conf-bar__fill" });
    fill.style.width = `${pct}%`;
    track.appendChild(fill);
    wrap.appendChild(track);
    row("Confidence", wrap);
  }

  // Internal ids such as "scenario:armed-intruder" are not rules for the operator.
  const rules = (Array.isArray(inc.rules_fired) ? inc.rules_fired : [])
    .filter((r) => !String(r).startsWith("scenario:"))
    .map(ruleLabel)
    .filter(Boolean);
  if (rules.length) {
    const chips = el("div", { className: "inc-dl__chips" });
    for (const r of rules) chips.appendChild(el("span", { className: "chip", text: r }));
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

/** Sentence case for display: "CALL STARTED" → "Call started"; mixed case kept. */
function sentenceCase(text) {
  const t = String(text || "").trim();
  if (!t) return t;
  const letters = t.replace(/[^A-Za-z]/g, "");
  const base = letters && letters === letters.toUpperCase() ? t.toLowerCase() : t;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** True when a note only repeats its state ("ALERTED" beside Alerted). */
function repeatsState(note, state) {
  const n = String(note || "").trim().toLowerCase().replace(/[_\s]+/g, " ");
  if (!n) return true;
  return n === String(state || "").toLowerCase().replace(/_/g, " ") || n === stateLabel(state).toLowerCase();
}

/**
 * Timeline: time (72 px, with a connector line and dot) | state chip
 * (96 px, same width for all) | note (hidden when it only repeats the state).
 */
export function timelineCard(inc) {
  const card = el("div", { className: "card detail-card" });
  card.appendChild(el("h3", { className: "inc-section-title", text: "Timeline" }));
  const list = el("ul", { className: "inc-tl" });
  for (const ev of Array.isArray(inc.timeline) ? inc.timeline : []) {
    const li = el("li", { className: "inc-tl__row" });
    li.appendChild(el("span", { className: "inc-tl__time mono", text: formatTimeLocal(ev.ts) }));
    li.appendChild(el("span", { className: "chip chip--state inc-tl__state", text: stateLabel(ev.state) }));
    const note = el("span", { className: "inc-tl__note" });
    const raw = String(ev.note || "");
    const unconfirmed = UNCONFIRMED_RE.test(raw);
    const text = raw.replace(UNCONFIRMED_RE, "");
    if (!repeatsState(text, ev.state)) note.appendChild(document.createTextNode(sentenceCase(text)));
    if (unconfirmed) {
      if (note.childNodes.length) note.appendChild(document.createTextNode(" "));
      note.appendChild(unconfirmedTag());
    }
    li.appendChild(note);
    list.appendChild(li);
  }
  card.appendChild(list);
  return card;
}

/** Calm one-line empty state with an optional muted second line. */
export function emptyState(title, sub = "") {
  const box = el("div", { className: "iq-empty" });
  const text = el("div", { className: "iq-empty__text" });
  text.appendChild(el("span", { text: title }));
  if (sub) text.appendChild(el("span", { className: "iq-empty__sub", text: sub }));
  box.appendChild(text);
  return box;
}
