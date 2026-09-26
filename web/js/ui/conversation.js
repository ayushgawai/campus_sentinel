/**
 * Messaging-style call transcript, shared by the Call page, Call history
 * and the Live call panel (compact):
 *   Sentinel = our side, right-aligned aqua bubbles; Responder = left,
 *   neutral bubbles (display name only; data speaker stays "dispatcher").
 *   Consecutive lines from one speaker within 60 s form one group (one
 *   avatar, one name + time). Gaps over 2 min get a centred time divider.
 *   Tool events are centred system lines. A typing indicator follows the
 *   newest Sentinel line while it is still arriving.
 * Phone numbers are masked and camera places redacted before display.
 */

import { el } from "../dom.js?v=pro7";
import { formatClock } from "../format.js?v=pro7";
import { icon } from "../icons.js?v=pro7";
import { redactPlaces } from "../site.js?v=pro7";

const GROUP_MS = 60 * 1000;
const DIVIDER_MS = 2 * 60 * 1000;
/** A Sentinel line newer than this is treated as still being spoken. */
const SPEAKING_MS = 1500;

/** Past-tense line for a tool event. */
const TOOL_TEXT = {
  lookup_location: "Looked up the location",
  get_person_description: "Checked the person's description",
  get_elapsed_time: "Checked the elapsed time",
  get_suspect_status: "Checked the person's status",
  repeat_last: "Repeated the last update",
};

export function toolLine(tool, fallback) {
  return TOOL_TEXT[String(tool || "")] || fallback || "Shared information";
}

/** Mask digit runs of 10+ digits (phone numbers); shorter runs stay. */
export function maskNumbers(text) {
  return String(text ?? "").replace(/\+?\d[\d\s().-]{7,}\d/g, (m) =>
    (m.match(/\d/g) || []).length >= 10 ? "[number hidden]" : m,
  );
}

function fullTime(ms) {
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function avatar(self) {
  const a = el("span", { className: `cv-avatar cv-avatar--${self ? "self" : "other"}`, attrs: { "aria-hidden": "true" } });
  if (self) a.appendChild(icon("shield"));
  else a.textContent = "R";
  return a;
}

/**
 * Render into `root` (cleared). `lines`: buildThread() output
 * ({speaker, text, ts}); `tools`: [{tool, ts}].
 * @param {HTMLElement} root
 * @param {{ lines: object[], tools?: object[], compact?: boolean, live?: boolean, toolText?: (t: string) => string, nowMs?: number, empty?: string }} opts
 */
export function renderConversation(root, opts) {
  const { lines = [], tools = [], compact = false, live = false } = opts;
  while (root.firstChild) root.removeChild(root.firstChild);
  root.classList.add("cv");
  root.classList.toggle("cv--compact", compact);

  const items = [
    ...lines.map((u) => ({ at: Date.parse(u.ts || "") || 0, kind: "msg", u })),
    ...tools.map((t) => ({ at: Date.parse(t.ts || "") || 0, kind: "tool", t })),
  ].sort((a, b) => a.at - b.at);

  if (!items.length) {
    if (opts.empty) root.appendChild(el("p", { className: "cv-empty", text: opts.empty }));
    return;
  }

  let group = null;
  let prevAt = null;
  for (const it of items) {
    if (prevAt != null && it.at && prevAt && it.at - prevAt > DIVIDER_MS) {
      root.appendChild(el("div", { className: "cv-divider mono", text: formatClock(it.at).slice(0, 5) }));
      group = null;
    }
    if (it.at) prevAt = it.at;
    if (it.kind === "tool") {
      const text = opts.toolText ? opts.toolText(it.t.tool) : toolLine(it.t.tool);
      root.appendChild(el("div", { className: "cv-sys", text: `↳ ${text}` }));
      group = null;
      continue;
    }
    const self = it.u.speaker !== "dispatcher";
    const sameGroup = group && group.self === self && it.at && group.lastAt && it.at - group.lastAt <= GROUP_MS;
    if (!sameGroup) {
      const g = el("div", { className: `cv-group cv-group--${self ? "self" : "other"}` });
      if (!compact) g.appendChild(avatar(self));
      const col = el("div", { className: "cv-col" });
      const head = el("div", { className: "cv-head" });
      head.appendChild(el("span", { className: "cv-name", text: self ? "Sentinel" : "Responder" }));
      if (it.at) head.appendChild(el("span", { className: "cv-time mono", text: formatClock(it.at) }));
      col.appendChild(head);
      g.appendChild(col);
      root.appendChild(g);
      group = { self, lastAt: it.at, col, el: g };
    }
    const bubble = el("div", {
      className: "cv-bubble",
      text: maskNumbers(redactPlaces(it.u.text)),
      attrs: it.at ? { title: fullTime(it.at) } : {},
    });
    group.col.appendChild(bubble);
    group.lastAt = it.at || group.lastAt;
    group.lastBubble = bubble;
  }

  // Typing indicator while the newest Sentinel line is still arriving.
  const last = items[items.length - 1];
  const nowMs = opts.nowMs ?? Date.now();
  if (live && last.kind === "msg" && last.u.speaker !== "dispatcher" && last.at && nowMs - last.at < SPEAKING_MS && group) {
    const dots = el("div", { className: "cv-typing", attrs: { "aria-label": "Sentinel is speaking" } });
    for (let i = 0; i < 3; i++) dots.appendChild(el("span", { attrs: { "aria-hidden": "true" } }));
    group.col.appendChild(dots);
  }
}

/**
 * Auto-scroll that stops while the user reads older lines; shows a
 * "New messages ↓" button in `wrap` until they return to the bottom.
 * @returns {{ afterRender: (grew: boolean) => void }}
 */
export function stickToBottom(scroller, wrap) {
  let stick = true;
  const btn = el("button", {
    type: "button",
    className: "btn btn--sm cv-newbtn",
    text: "New messages ↓",
    onClick: () => {
      scroller.scrollTop = scroller.scrollHeight;
      stick = true;
      btn.hidden = true;
    },
  });
  btn.hidden = true;
  wrap.appendChild(btn);
  scroller.addEventListener("scroll", () => {
    stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
    if (stick) btn.hidden = true;
  });
  return {
    afterRender(grew) {
      if (stick) scroller.scrollTop = scroller.scrollHeight;
      else if (grew) btn.hidden = false;
    },
  };
}
