/**
 * Call page console: a header card across the full width, then
 * Transcript (2/3) | Call details (1/3). Used live (active call) and
 * read-only for a saved call (Call history). Only store data is shown.
 */

import { el, setText } from "../dom.js?v=pro7";
import { now, subscribeTick } from "../clock.js?v=pro7";
import { cameraLabel, classLabel, formatClock, severityLabel, stateLabel } from "../format.js?v=pro7";
import { cameraTitle } from "../site.js?v=pro7";
import { icon } from "../icons.js?v=pro7";
import { pathHops } from "../tracking.js?v=pro7";
import { subscribeModelStatus } from "../modelStatus.js?v=pro7";
import { OP_STATUS_EVENT } from "./operator.js?v=pro7";
import { incidentActions } from "./incidentActions.js?v=pro7";
import { renderConversation, stickToBottom, toolLine } from "./conversation.js?v=pro7";
import {
  ENDED_CALL_STATES,
  buildThread,
  callDescription,
  callNoteText,
  callTimerText,
  dispatchedTs,
  findCallIncident,
  formatCallTimer,
} from "./call.js?v=pro7";

/** Build the console skeleton inside `host`; returns element refs. */
function skeleton(host) {
  host.innerHTML = `
    <div class="cc">
      <header class="card cc-head">
        <div class="cc-head__l">
          <h2 class="cc-title">Emergency Call</h2>
          <p class="cc-desc" data-desc>No active call</p>
          <span class="ochip ochip--state cc-label" data-label hidden></span>
        </div>
        <div class="cc-head__r">
          <span class="ochip cc-status" data-status hidden><span class="cc-status__dot" aria-hidden="true"></span><span data-status-t></span></span>
          <span class="cc-timer mono" data-timer>00:00</span>
          <span class="cc-live mono" data-live hidden><span class="cc-live__dot" aria-hidden="true"></span>LIVE</span>
        </div>
      </header>
      <div class="cc-grid">
        <section class="card cc-chat" aria-label="Transcript">
          <h3 class="cc-sec">Transcript</h3>
          <div class="cc-chat__wrap" data-wrap>
            <div class="cc-chat__scroll" data-scroll role="log" aria-live="polite"></div>
          </div>
        </section>
        <aside class="card cc-det" aria-label="Call details" data-details></aside>
      </div>
    </div>`;
  const q = (s) => host.querySelector(s);
  return {
    desc: q("[data-desc]"),
    label: q("[data-label]"),
    status: q("[data-status]"),
    statusT: q("[data-status-t]"),
    timer: q("[data-timer]"),
    live: q("[data-live]"),
    scroll: q("[data-scroll]"),
    wrap: q("[data-wrap]"),
    details: q("[data-details]"),
  };
}

function paintDesc(node, text, startMs) {
  while (node.firstChild) node.removeChild(node.firstChild);
  node.appendChild(document.createTextNode(text));
  if (Number.isFinite(startMs)) {
    node.appendChild(document.createTextNode(" · started "));
    node.appendChild(el("span", { className: "mono", text: formatClock(startMs) }));
  }
}

function section(title) {
  const s = el("div", { className: "cc-dsec" });
  s.appendChild(el("h4", { className: "cc-dsec__t", text: title }));
  return s;
}

function kvRow(k, v) {
  const r = el("div", { className: "kv__row" });
  r.appendChild(el("dt", { className: "kv__k", text: k }));
  const d = el("dd", { className: "kv__v" });
  if (typeof v === "string") d.textContent = v;
  else d.appendChild(v);
  r.appendChild(d);
  return r;
}

/**
 * Details column content.
 * @param {HTMLElement} root
 * @param {object} d { inc?, rec?, hops, started, duration, status, tools, actionsEl }
 */
function paintDetails(root, d) {
  while (root.firstChild) root.removeChild(root.firstChild);
  root.appendChild(el("h3", { className: "cc-sec", text: "Call details" }));
  if (!d.classToken) {
    root.appendChild(el("p", { className: "cc-muted", text: "No active call" }));
    return;
  }

  const inc = section("Incident");
  const line = el("div", { className: "cc-inc" });
  line.appendChild(el("span", { className: "cc-inc__class", text: classLabel(d.classToken) }));
  if (d.severity) {
    line.appendChild(el("span", { className: `ochip ochip--${d.severity === "SEVERE" ? "severe" : "minor"}`, text: severityLabel(d.severity) }));
  }
  if (d.state) line.appendChild(el("span", { className: "ochip ochip--state", text: stateLabel(d.state) }));
  inc.appendChild(line);
  if (d.incidentId) inc.appendChild(el("p", { className: "cc-id mono", text: `INC-${d.incidentId}` }));
  root.appendChild(inc);

  const kv = el("dl", { className: "kv cc-kv" });
  if (d.location) kv.appendChild(kvRow("Location", d.location));
  if (d.hops?.length) {
    const path = el("div", { className: "cc-path" });
    d.hops.forEach((h, i) => {
      if (i) path.appendChild(el("span", { className: "cc-path__arrow", text: "→", attrs: { "aria-hidden": "true" } }));
      const chip = el("span", { className: "ochip ochip--state cc-path__chip" });
      chip.appendChild(el("span", { text: cameraLabel(h.cameraId).replace(/^Camera\s+/, "Cam ") }));
      const ms = Date.parse(h.at || "");
      if (Number.isFinite(ms)) chip.appendChild(el("span", { className: "mono cc-path__t", text: formatClock(ms) }));
      path.appendChild(chip);
    });
    kv.appendChild(kvRow("Path", path));
  }
  if (d.started) kv.appendChild(kvRow("Started", el("span", { className: "mono", text: d.started })));
  kv.appendChild(kvRow("Duration", el("span", { className: "mono", text: d.duration || "00:00" })));
  kv.appendChild(kvRow("Status", d.status || ""));
  root.appendChild(kv);

  const info = section("Information shared");
  if (d.tools?.length) {
    const ul = el("ul", { className: "cc-info" });
    for (const t of d.tools) {
      const li = el("li", { className: "cc-info__row" });
      li.appendChild(icon("check"));
      li.appendChild(el("span", { className: "cc-info__label", text: toolLine(t.tool) }));
      const ms = Date.parse(t.ts || "");
      li.appendChild(el("span", { className: "cc-info__t mono", text: Number.isFinite(ms) ? formatClock(ms) : "" }));
      ul.appendChild(li);
    }
    info.appendChild(ul);
  } else {
    info.appendChild(el("p", { className: "cc-muted", text: "Nothing requested yet" }));
  }
  root.appendChild(info);

  if (d.actionsEl) {
    const act = section("Actions");
    act.appendChild(d.actionsEl);
    root.appendChild(act);
  }
}

function paintStatus(v, statusKey) {
  v.status.hidden = !statusKey;
  if (!statusKey) return;
  v.status.className = `ochip cc-status cc-status--${statusKey}`;
  setText(v.statusT, statusKey === "live" ? "Connected" : "Ended");
}

/** Active call console (Call page, "Active call" tab). */
export function mountCallConsole(host, store, actions) {
  const v = skeleton(host);
  const stick = stickToBottom(v.scroll, v.wrap);
  let threadSig = "";
  let detailSig = "";
  let opVersion = 0;

  function render(state, nowMs = now()) {
    const inc = findCallIncident(state);
    const ended = inc ? ENDED_CALL_STATES.has(inc.state) : false;
    // Header.
    const startMs = inc ? Date.parse(dispatchedTs(inc, state) || "") : NaN;
    paintDesc(v.desc, inc ? callDescription(inc, state) : "No active call", inc ? startMs : NaN);
    v.label.hidden = !inc;
    setText(v.label, callNoteText(state));
    paintStatus(v, inc ? (ended ? "ended" : "live") : null);
    setText(v.timer, callTimerText(inc, state, nowMs));
    v.live.hidden = !inc || ended;

    // Transcript.
    const all = inc
      ? (state.call?.transcript || []).filter((t) => !state.call.incidentId || t.incident_id === inc.incident_id)
      : [];
    const tools = inc
      ? (state.call?.tools || []).filter((t) => !state.call.incidentId || t.incident_id === inc.incident_id)
      : [];
    const thread = buildThread(all);
    const last = thread[thread.length - 1];
    const lastMs = last ? Date.parse(last.ts || "") || 0 : 0;
    const speaking = last && last.speaker !== "dispatcher" && nowMs - lastMs < 1500;
    const sig = `${inc?.incident_id || ""}|${thread.length}|${last ? last.text.length : 0}|${tools.length}|${speaking}`;
    if (sig !== threadSig) {
      const grew = threadSig !== "" && sig.split("|")[1] !== threadSig.split("|")[1];
      threadSig = sig;
      renderConversation(v.scroll, {
        lines: thread,
        tools,
        live: !ended,
        nowMs,
        empty: inc ? "Connecting the call." : "Calls appear here when help is dispatched.",
      });
      stick.afterRender(grew);
    }

    // Details.
    const dsig = inc
      ? `${inc.incident_id}|${inc.state}|${inc.camera_id}|${tools.length}|${(state.cameraPath?.[inc.incident_id] || []).length}|${opVersion}|${ended}`
      : "none";
    if (dsig !== detailSig) {
      detailSig = dsig;
      paintDetails(v.details, inc
        ? {
            classToken: inc.class_token,
            severity: inc.severity,
            state: inc.state,
            incidentId: inc.incident_id,
            location: cameraTitle(inc.camera_id),
            hops: pathHops(state, inc, Infinity).hops,
            started: Number.isFinite(startMs) ? formatClock(startMs) : "",
            duration: callTimerText(inc, state, nowMs),
            status: ended ? "Ended" : "Connected",
            tools,
            actionsEl: !ended && actions ? incidentActions(inc, actions, store) : null,
          }
        : {});
    } else if (inc) {
      const dur = v.details.querySelectorAll(".cc-kv .mono");
      // Duration ticks without rebuilding the card.
      for (const n of dur) if (n.parentNode?.previousSibling?.textContent === "Duration") setText(n, callTimerText(inc, state, nowMs));
    }
  }

  const onOp = () => {
    opVersion += 1;
    render(store.getState());
  };
  document.addEventListener(OP_STATUS_EVENT, onOp);
  render(store.getState());
  const unsub = store.subscribe((s) => render(s));
  const unsubTick = subscribeTick((ms) => render(store.getState(), ms));
  const unsubVoice = subscribeModelStatus(() => render(store.getState()));
  return () => {
    unsub();
    unsubTick();
    unsubVoice();
    document.removeEventListener(OP_STATUS_EVENT, onOp);
  };
}

/** Read-only console for a saved call (Call history). */
export function renderSavedCall(host, rec) {
  const v = skeleton(host);
  if (!rec) {
    paintDetails(v.details, {});
    renderConversation(v.scroll, { lines: [], empty: "Select a call to read its transcript." });
    v.timer.hidden = true;
    return;
  }
  const startMs = Date.parse(rec.startedAt || "");
  paintDesc(v.desc, rec.description || `${classLabel(rec.classToken)} call · ${rec.camera}`, startMs);
  v.label.hidden = false;
  setText(v.label, /not connected/i.test(rec.label || "") ? "Call not connected" : "Connected to on-call responder");
  paintStatus(v, "ended");
  setText(v.timer, formatCallTimer(rec.durationMs || 0));
  renderConversation(v.scroll, {
    lines: rec.lines || [],
    tools: rec.tools || [],
    empty: "No transcript was recorded for this call.",
  });
  paintDetails(v.details, {
    classToken: rec.classToken,
    severity: rec.severity,
    state: null,
    incidentId: rec.incidentId,
    location: rec.place ? `${rec.camera} · ${rec.place}` : rec.camera,
    hops: [],
    started: Number.isFinite(startMs) ? formatClock(startMs) : "",
    duration: formatCallTimer(rec.durationMs || 0),
    status: rec.endedAt ? "Ended" : "Not finished",
    tools: rec.tools || [],
    actionsEl: null,
  });
}
