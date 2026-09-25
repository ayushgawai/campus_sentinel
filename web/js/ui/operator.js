/**
 * Operator actions (Fix 5): Report incident popover, Call for help and
 * Broadcast dialogs, plus the action-bar pieces shared by the incidents
 * panel, the Incidents page and the Call Console. Dialogs follow the
 * dismiss.js pattern (overlay + .panel.dismiss); all user text via textContent.
 */

import {
  REPORT_TYPES,
  BROADCAST_AUDIENCES,
  BROADCAST_MAX,
  OP_STATUS_EVENT,
  broadcastPresets,
  audienceText,
  isDispatchedOrLater,
  isOperatorReported,
} from "../actions.js?v=fix9b";
import { WALL_CAMERA_IDS, cameraLabel, cameraTitle } from "../site.js?v=fix9b";
import { classLabel, formatPct } from "../format.js?v=fix9b";
import { clear, el, setText } from "../dom.js?v=fix9b";
import { icon } from "../icons.js?v=fix9b";
import { subscribeTick } from "../clock.js?v=fix9b";
import { callElapsedMs, formatCallTimer } from "./call.js?v=fix9b";

export const OP_REPORT_EVENT = "sentinel:op-report";
export const OP_CALL_EVENT = "sentinel:op-call";
export const OP_BROADCAST_EVENT = "sentinel:op-broadcast";
export { OP_STATUS_EVENT };

const MAX_NOTE = 140;
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Icon + sentence-case label button. */
export function opButton({ className, iconName, text, onClick, attrs }) {
  const btn = el("button", { type: "button", className, onClick, attrs });
  if (iconName) btn.appendChild(icon(iconName));
  btn.appendChild(el("span", { text }));
  return btn;
}

/** "Reported by operator" chip text, or null. */
export function operatorTag(inc) {
  if (!isOperatorReported(inc)) return null;
  return String(inc.incident_id || "").startsWith("op-local-")
    ? "Reported by operator · pending server confirmation"
    : "Reported by operator";
}

/** Tile chip / list meta: "92%", or "Operator" for a report with no model score. */
export function confidenceShort(inc) {
  if (inc?.fused_prob == null && isOperatorReported(inc)) return "· Reported";
  if (inc?.fused_prob == null) return "";
  return formatPct(inc.fused_prob);
}

/** Sidebar card line: "92% confidence" or "Reported by operator". */
export function confidenceLong(inc) {
  if (inc?.fused_prob == null && isOperatorReported(inc)) return "Reported by operator";
  // No score yet: say nothing rather than "Pending confidence".
  if (inc?.fused_prob == null) return "";
  return `${formatPct(inc.fused_prob)} confidence`;
}

// ---------- Dispatched status ticker (one per page, not per bar) ----------

let storeRef = null;

function dispatchedText(inc, state, nowMs) {
  if (!inc) return "";
  if (inc.state === "DISPATCH_PENDING") return "Dispatch pending";
  const ms = callElapsedMs(inc, state, nowMs);
  return ms == null ? "Dispatched" : `Dispatched · ${formatCallTimer(ms)}`;
}

function paintDispatched(nowMs) {
  if (!storeRef) return;
  const state = storeRef.getState();
  for (const node of document.querySelectorAll("[data-op-dispatched]")) {
    setText(node, dispatchedText(state.incidents[node.dataset.opDispatched], state, nowMs));
  }
}

/**
 * Broadcast + Call for help (or "Dispatched · 01:28") for one incident, and
 * the quiet server note under them. Returns { row, note, strong } where
 * `strong` says the bar's one strong action is Call for help.
 */
export function operatorActions(inc, actions, { broadcast = true, call = true } = {}) {
  const row = el("div", { className: "op-row" });
  const dispatchSt = actions.getOpStatus("dispatch", inc.incident_id);
  const broadcastSt = actions.getOpStatus("broadcast", inc.incident_id);
  const confirmSt = actions.getOpStatus("confirm", inc.incident_id);
  const dismissSt = actions.getOpStatus("dismiss", inc.incident_id);

  if (broadcast) {
    const b = opButton({
      className: "btn btn--secondary op-btn",
      iconName: "megaphone",
      text: "Broadcast",
      attrs: { "data-focus-key": "broadcast" },
      onClick: () =>
        document.dispatchEvent(
          new CustomEvent(OP_BROADCAST_EVENT, { detail: { incidentId: inc.incident_id } }),
        ),
    });
    b.disabled = broadcastSt?.state === "pending";
    row.appendChild(b);
  }

  const dispatched = isDispatchedOrLater(inc);
  if (!call) {
    // Broadcast only (call panel footer).
  } else if (dispatched) {
    const st = el("span", {
      className: "op-status mono",
      dataset: { opDispatched: inc.incident_id },
      attrs: { role: "status" },
    });
    setText(st, dispatchedText(inc, storeRef?.getState() || { incidents: {} }, undefined));
    row.appendChild(st);
  } else {
    const pending = dispatchSt?.state === "pending";
    const c = opButton({
      className: `btn op-btn op-btn--call op-btn--${inc.severity === "SEVERE" ? "severe" : "minor"}`,
      iconName: "phone",
      text: pending ? "Calling…" : "Call for help",
      attrs: { "data-focus-key": "call" },
      onClick: () =>
        document.dispatchEvent(
          new CustomEvent(OP_CALL_EVENT, { detail: { incidentId: inc.incident_id } }),
        ),
    });
    c.disabled = pending;
    row.appendChild(c);
  }

  let noteText = "";
  for (const st of [call ? dispatchSt : null, broadcast ? broadcastSt : null]) {
    if (st?.state === "unconfirmed") noteText = "Pending server confirmation";
    if (st?.state === "declined") noteText = `Declined by server: ${st.message || "request refused"}`;
  }
  const note = el("p", { className: "op-note", attrs: { role: "status" } });
  setText(note, noteText);
  note.hidden = !noteText;

  return { row, note, strong: call && !dispatched };
}

/**
 * Incident action bar (Fix 5b).
 * Row 1: full-width "Call for help" (coral Severe / primary Minor), or after
 *        dispatch a full-width quiet "● Dispatched · 01:28" status.
 * Row 2 (review): Broadcast, Confirm, Dismiss — three equal buttons.
 *        Confirm is primary when Call for help is not available.
 */
export function actionBar(inc, actions, { review = true, card = true } = {}) {
  const bar = el("div", { className: `op-bar${card ? " card detail-card" : ""}` });
  const dispatchSt = actions.getOpStatus("dispatch", inc.incident_id);
  const broadcastSt = actions.getOpStatus("broadcast", inc.incident_id);
  const dispatched = isDispatchedOrLater(inc);

  if (dispatched) {
    const st = el("div", { className: "op-bar__status", attrs: { role: "status" } });
    st.appendChild(el("span", { className: "op-bar__dot", attrs: { "aria-hidden": "true" } }));
    const text = el("span", { className: "mono", dataset: { opDispatched: inc.incident_id } });
    setText(text, dispatchedText(inc, storeRef?.getState() || { incidents: {} }, undefined));
    st.appendChild(text);
    bar.appendChild(st);
  } else {
    const pending = dispatchSt?.state === "pending";
    const call = opButton({
      className: `btn op-btn op-btn--call op-bar__primary op-btn--${inc.severity === "SEVERE" ? "severe" : "minor"}`,
      iconName: "phone",
      text: pending ? "Calling…" : "Call for help",
      attrs: { "data-focus-key": "call" },
      onClick: () =>
        document.dispatchEvent(
          new CustomEvent(OP_CALL_EVENT, { detail: { incidentId: inc.incident_id } }),
        ),
    });
    call.disabled = pending;
    bar.appendChild(call);
  }

  let noteText = "";
  for (const st of [dispatchSt, review ? broadcastSt : null, confirmSt, dismissSt]) {
    if (st?.state === "unconfirmed") noteText = "Pending server confirmation";
    if (st?.state === "declined") noteText = `Declined by server: ${st.message || "request refused"}`;
  }
  if (noteText) {
    bar.appendChild(el("p", { className: "op-bar__note", text: noteText, attrs: { role: "status" } }));
  }

  if (review) {
    const grid = el("div", { className: "op-bar__grid" });
    const b = opButton({
      className: "btn btn--secondary op-btn",
      iconName: "megaphone",
      text: "Broadcast",
      attrs: { "data-focus-key": "broadcast" },
      onClick: () =>
        document.dispatchEvent(
          new CustomEvent(OP_BROADCAST_EVENT, { detail: { incidentId: inc.incident_id } }),
        ),
    });
    b.disabled = broadcastSt?.state === "pending";
    grid.appendChild(b);
    const confirm = opButton({
        className: `btn op-btn ${dispatched ? "btn--primary" : "btn--secondary"}`,
        iconName: "check",
        text: confirmSt?.state === "pending" ? "Confirming…" : "Confirm",
        attrs: { "data-focus-key": "confirm" },
        onClick: () => actions.confirm(inc.incident_id),
      });
    confirm.disabled = confirmSt?.state === "pending";
    grid.appendChild(confirm);
    const dismiss = opButton({
        className: "btn btn--secondary op-btn",
        iconName: "close",
        text: dismissSt?.state === "pending" ? "Dismissing…" : "Dismiss",
        attrs: { "data-focus-key": "dismiss" },
        onClick: () =>
          document.dispatchEvent(
            new CustomEvent("sentinel:dismiss", { detail: { incidentId: inc.incident_id } }),
          ),
      });
    dismiss.disabled = dismissSt?.state === "pending";
    grid.appendChild(dismiss);
    bar.appendChild(grid);
  }
  return bar;
}

// ---------- Dialog host ----------

export function mountOperator(root, store, actions) {
  storeRef = store;
  subscribeTick(paintDispatched);

  let openKind = null;
  let returnFocus = null;
  let closeTimer = 0;

  function close() {
    if (closeTimer) window.clearTimeout(closeTimer);
    closeTimer = 0;
    openKind = null;
    root.hidden = true;
    root.className = "";
    root.setAttribute("aria-hidden", "true");
    clear(root);
    const back = returnFocus;
    returnFocus = null;
    if (back && document.contains(back)) back.focus();
  }

  function trap(panel) {
    panel.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const items = [...panel.querySelectorAll(FOCUSABLE)].filter(
        (n) => n.offsetParent !== null,
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    });
  }

  function begin(kind, overlayClass) {
    if (openKind) close();
    returnFocus = document.activeElement;
    openKind = kind;
    clear(root);
    root.hidden = false;
    root.setAttribute("aria-hidden", "false");
    root.className = `${overlayClass} is-open`;
  }

  function dialogPanel(title) {
    const panel = el("article", {
      className: "panel dismiss op-dialog",
      attrs: { role: "dialog", "aria-modal": "true", "aria-label": title },
    });
    const header = el("header", { className: "panel__header" }, [
      el("h2", { className: "panel__title", text: title }),
    ]);
    const body = el("div", { className: "panel__body dismiss__body op-dialog__body" });
    panel.appendChild(header);
    panel.appendChild(body);
    root.appendChild(panel);
    trap(panel);
    return { panel, body };
  }

  function chip(text, pressed, onClick) {
    const b = el("button", {
      type: "button",
      className: `op-chip${pressed ? " is-on" : ""}`,
      text,
      attrs: { "aria-pressed": pressed ? "true" : "false" },
      onClick,
    });
    return b;
  }

  function setPressed(btn, on) {
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  // ---------- Report incident (anchored popover) ----------

  function openReport({ cameraId = null, anchor = null } = {}) {
    begin("report", "op-pop-layer");
    const state = store.getState();
    const selCam = state.selectedId ? state.incidents[state.selectedId]?.camera_id : null;
    let cam = cameraId || selCam || WALL_CAMERA_IDS[0];
    let type = null;
    let severity = "MINOR";

    const pop = el("div", {
      className: "op-pop",
      attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Report incident" },
    });

    const head = el("div", { className: "op-pop__head" });
    head.appendChild(el("h2", { className: "op-pop__title", text: "Report incident" }));
    if (cameraId) {
      head.appendChild(el("span", { className: "op-pop__cam mono", text: cameraLabel(cameraId) }));
    }
    pop.appendChild(head);

    if (!cameraId) {
      const select = el("select", {
        className: "op-select",
        attrs: { "aria-label": "Camera" },
      });
      for (const id of WALL_CAMERA_IDS) {
        const opt = el("option", { text: cameraTitle(id) });
        opt.value = id;
        if (id === cam) opt.selected = true;
        select.appendChild(opt);
      }
      select.addEventListener("change", () => {
        cam = select.value;
      });
      pop.appendChild(select);
    }

    const types = el("div", {
      className: "op-chips",
      attrs: { role: "group", "aria-label": "Type" },
    });
    const typeBtns = [];
    for (const t of REPORT_TYPES) {
      const b = chip(t.label, false, () => {
        type = t.token;
        for (const x of typeBtns) setPressed(x, x === b);
        paint();
      });
      typeBtns.push(b);
      types.appendChild(b);
    }
    pop.appendChild(types);

    const sev = el("div", {
      className: "op-seg",
      attrs: { role: "group", "aria-label": "Severity" },
    });
    const sevBtns = [];
    for (const [value, label] of [
      ["MINOR", "Minor"],
      ["SEVERE", "Severe"],
    ]) {
      const b = chip(label, value === severity, () => {
        severity = value;
        for (const x of sevBtns) setPressed(x, x === b);
      });
      sevBtns.push(b);
      sev.appendChild(b);
    }
    pop.appendChild(sev);

    const note = el("input", {
      className: "op-input",
      type: "text",
      attrs: {
        maxlength: String(MAX_NOTE),
        placeholder: "Add a note (optional)",
        "aria-label": "Note",
        autocomplete: "off",
      },
    });
    pop.appendChild(note);

    const err = el("p", { className: "op-note", attrs: { role: "status" } });
    err.hidden = true;
    pop.appendChild(err);

    const foot = el("div", { className: "op-pop__foot" });
    foot.appendChild(
      el("button", { type: "button", className: "btn btn--secondary", text: "Cancel", onClick: close }),
    );
    const submit = el("button", {
      type: "button",
      className: "btn btn--primary",
      text: "Report",
      onClick: send,
    });
    foot.appendChild(submit);
    pop.appendChild(foot);

    let sending = false;
    function paint() {
      submit.disabled = sending || !type;
      setText(submit, sending ? "Reporting…" : "Report");
    }

    async function send() {
      if (sending || !type) return;
      sending = true;
      paint();
      const res = await actions.reportIncident({
        cameraId: cam,
        classToken: type,
        severity,
        note: note.value.slice(0, MAX_NOTE),
      });
      if (openKind !== "report") return;
      sending = false;
      if (res.ok || res.unconfirmed) {
        close();
        return;
      }
      if (res.message) {
        setText(err, `Declined by server: ${res.message}`);
        err.hidden = false;
      }
      paint();
    }

    note.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        send();
      }
    });

    root.appendChild(pop);
    trap(pop);
    paint();
    position(pop, anchor);
    (typeBtns[0] || note).focus();
  }

  /** Below the anchor, right-aligned to it; flips above and clamps to the viewport. */
  function position(pop, anchor) {
    const pad = 12;
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = (vw - pw) / 2;
    let top = (vh - ph) / 2;
    if (anchor && document.contains(anchor)) {
      const r = anchor.getBoundingClientRect();
      left = r.right - pw;
      top = r.bottom + 6;
      if (top + ph > vh - pad) top = r.top - ph - 6;
    }
    pop.style.left = `${Math.round(Math.min(Math.max(pad, left), vw - pw - pad))}px`;
    pop.style.top = `${Math.round(Math.min(Math.max(pad, top), vh - ph - pad))}px`;
  }

  // ---------- Call for help (confirm dialog) ----------

  function openCall(incidentId) {
    const inc = store.getState().incidents[incidentId];
    if (!inc || isDispatchedOrLater(inc)) return;
    begin("call", "dismiss-overlay");
    const { panel, body } = dialogPanel("Call for help");
    body.appendChild(
      el("p", {
        className: "op-dialog__q",
        text: `Call for help for ${classLabel(inc.class_token)} on ${cameraLabel(inc.camera_id)}?`,
      }),
    );
    body.appendChild(
      el("p", {
        className: "dismiss__lead",
        text: "Simulated call to a verified teammate. No emergency number is dialed.",
      }),
    );
    if (inc.severity !== "SEVERE") {
      body.appendChild(
        el("p", { className: "dismiss__lead", text: "This escalates the incident to Severe." }),
      );
    }
    const err = el("p", { className: "op-note", attrs: { role: "status" } });
    err.hidden = true;
    body.appendChild(err);

    const foot = el("div", { className: "op-dialog__foot" });
    foot.appendChild(
      el("button", { type: "button", className: "btn btn--secondary", text: "Cancel", onClick: close }),
    );
    const go = opButton({
      className: "btn op-btn op-btn--call op-btn--severe",
      iconName: "phone",
      text: "Call for help",
      onClick: confirmCall,
    });
    foot.appendChild(go);
    body.appendChild(foot);

    let sending = false;
    async function confirmCall() {
      if (sending) return;
      sending = true;
      go.disabled = true;
      setText(go.querySelector("span"), "Calling…");
      const res = await actions.callForHelp(incidentId);
      if (openKind !== "call") return;
      if (res.ok || res.unconfirmed || res.pending) {
        close();
        return;
      }
      sending = false;
      go.disabled = false;
      setText(go.querySelector("span"), "Call for help");
      if (res.message) {
        setText(err, `Declined by server: ${res.message}`);
        err.hidden = false;
      } else {
        close();
      }
    }

    panel.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target?.tagName !== "BUTTON") {
        e.preventDefault();
        confirmCall();
      }
    });
    go.focus();
  }

  // ---------- Broadcast (centred modal) ----------

  function openBroadcast(incidentId) {
    const inc = incidentId ? store.getState().incidents[incidentId] : null;
    begin("broadcast", "dismiss-overlay");
    const { panel, body } = dialogPanel("Broadcast");
    panel.classList.add("op-dialog--wide");

    let audience = ["everyone"];

    body.appendChild(el("h3", { className: "op-label", text: "Audience" }));
    const audRow = el("div", {
      className: "op-chips",
      attrs: { role: "group", "aria-label": "Audience" },
    });
    const audBtns = new Map();
    for (const a of BROADCAST_AUDIENCES) {
      const b = chip(a.label, audience.includes(a.id), () => {
        if (a.id === "everyone") audience = ["everyone"];
        else {
          const rest = audience.filter((x) => x !== "everyone");
          audience = rest.includes(a.id) ? rest.filter((x) => x !== a.id) : [...rest, a.id];
          if (!audience.length) audience = ["everyone"];
        }
        for (const [id, btn] of audBtns) setPressed(btn, audience.includes(id));
        paint();
      });
      audBtns.set(a.id, b);
      audRow.appendChild(b);
    }
    body.appendChild(audRow);

    body.appendChild(el("h3", { className: "op-label", text: "Message" }));
    const presets = el("div", {
      className: "op-chips op-chips--presets",
      attrs: { role: "group", "aria-label": "Message presets" },
    });
    for (const text of broadcastPresets(inc?.camera_id)) {
      presets.appendChild(
        chip(text, false, () => {
          box.value = text.slice(0, BROADCAST_MAX);
          paint();
          box.focus();
        }),
      );
    }
    body.appendChild(presets);

    const box = el("textarea", {
      className: "op-input op-textarea",
      attrs: {
        maxlength: String(BROADCAST_MAX),
        rows: "3",
        "aria-label": "Broadcast message",
        placeholder: "Write a message",
      },
    });
    box.addEventListener("input", paint);
    box.addEventListener("keydown", (e) => {
      // One-line announcements; Ctrl/Cmd+Enter sends.
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) send();
    });
    body.appendChild(box);

    const meta = el("div", { className: "op-meta" });
    const preview = el("p", { className: "op-preview" });
    const counter = el("span", { className: "op-counter mono", attrs: { "aria-live": "polite" } });
    meta.appendChild(preview);
    meta.appendChild(counter);
    body.appendChild(meta);

    const result = el("p", { className: "op-note op-note--result", attrs: { role: "status" } });
    result.hidden = true;
    body.appendChild(result);

    const foot = el("div", { className: "op-dialog__foot" });
    foot.appendChild(
      el("button", { type: "button", className: "btn btn--secondary", text: "Cancel", onClick: close }),
    );
    const sendBtn = opButton({
      className: "btn btn--primary op-btn",
      iconName: "megaphone",
      text: "Send broadcast",
      onClick: send,
    });
    foot.appendChild(sendBtn);
    body.appendChild(foot);

    let sending = false;
    let done = false;
    function paint() {
      const text = box.value.trim();
      setText(counter, `${box.value.length}/${BROADCAST_MAX}`);
      setText(preview, `To ${audienceText(audience)}: ${text || "…"}`);
      sendBtn.disabled = sending || done || !text;
      setText(sendBtn.querySelector("span"), sending ? "Sending…" : "Send broadcast");
    }

    async function send() {
      const text = box.value.trim();
      if (sending || done || !text) return;
      sending = true;
      paint();
      const aud = audience.slice();
      const res = await actions.broadcast({ incidentId, audience: aud, message: text });
      if (openKind !== "broadcast") return;
      sending = false;
      if (res.ok || res.unconfirmed) {
        done = true;
        setText(
          result,
          res.ok
            ? `Broadcast sent to ${audienceText(aud)}.`
            : "Saved to the incident timeline. Pending server confirmation.",
        );
        result.hidden = false;
        paint();
        closeTimer = window.setTimeout(close, res.ok ? 1600 : 2600);
        return;
      }
      if (res.message) {
        setText(result, `Declined by server: ${res.message}`);
        result.hidden = false;
      }
      paint();
    }

    paint();
    audBtns.get("everyone").focus();
  }

  // A click outside the report popover closes it; modals close via Cancel/Esc.
  root.addEventListener("click", (e) => {
    if (e.target === root && openKind === "report") close();
  });

  document.addEventListener(OP_REPORT_EVENT, (e) => openReport(e.detail || {}));
  document.addEventListener(OP_CALL_EVENT, (e) => {
    if (e.detail?.incidentId) openCall(e.detail.incidentId);
  });
  document.addEventListener(OP_BROADCAST_EVENT, (e) => openBroadcast(e.detail?.incidentId || null));

  root._opApi = { close, isOpen: () => Boolean(openKind) };
  close();
  return root._opApi;
}
