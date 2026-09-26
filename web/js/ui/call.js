/** Call Console — single chat thread + tool cards. No floating overlay. */

import { now, subscribeTick } from "../clock.js?v=pro4";
import {
  awaiting,
  classLabel,
  cameraLabel,
  notReported,
  personLabel,
  stateLabel,
  textOr,
  formatTimeLocal,
  formatRel,
  toolKeyLabel,
  toolNameLabel,
  LOCATION_TOOL_KEYS,
  HIDDEN_TOOL_KEYS,
  isOpenIncident,
  severityLabel,
  formatClock,
} from "../format.js?v=pro4";
import { redactPlaces, cameraTitle } from "../site.js?v=pro4";
import { clear, el, setText } from "../dom.js?v=pro4";
import { OP_STATUS_EVENT, operatorActions, actionBar } from "./operator.js?v=pro4";
import { isDispatchedOrLater } from "../actions.js?v=pro4";
import { subscribeModelStatus } from "../modelStatus.js?v=pro4";
import { renderConversation } from "./conversation.js?v=pro4";

const STREAM_MERGE_MS = 700;
const CALL_STATES = new Set([
  "DISPATCHED",
  "TRACKING",
  "RESOLVED",
  "DISMISSED",
]);
export const ENDED_CALL_STATES = new Set(["RESOLVED", "DISMISSED"]);

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Stopwatch: "01:28", or "1:02:05" after an hour. */
export function formatCallTimer(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  return hh > 0 ? `${hh}:${pad2(mm)}:${pad2(ss)}` : `${pad2(mm)}:${pad2(ss)}`;
}

function timelineTs(inc, states) {
  for (const ev of Array.isArray(inc?.timeline) ? inc.timeline : []) {
    if (states.has(ev.state) && ev.ts) return ev.ts;
  }
  return null;
}

/** Call start: the incident's DISPATCHED timeline ts, else the backend's call start. */
export function dispatchedTs(inc, state) {
  const fromTimeline = timelineTs(inc, new Set(["DISPATCHED"]));
  if (fromTimeline) return fromTimeline;
  if (state?.call?.dispatchedAt && state.call.incidentId === inc?.incident_id) {
    return state.call.dispatchedAt;
  }
  return null;
}

/**
 * Elapsed call time in ms, shared by the Call Console page, the floating
 * call panel and the incidents-panel Call button so all three agree.
 * Holds at the end time once the call's incident is resolved or dismissed.
 */
export function callElapsedMs(inc, state, nowMs = now()) {
  const start = Date.parse(dispatchedTs(inc, state) || "");
  if (Number.isNaN(start)) return null;
  let end = nowMs;
  if (ENDED_CALL_STATES.has(inc.state)) {
    const endIso = timelineTs(inc, ENDED_CALL_STATES) || inc.updated_at;
    const endMs = Date.parse(endIso || "");
    if (!Number.isNaN(endMs)) end = Math.min(nowMs, endMs);
  }
  return Math.max(0, end - start);
}

export function callTimerText(inc, state, nowMs) {
  const ms = inc ? callElapsedMs(inc, state, nowMs) : null;
  return ms == null ? "00:00" : formatCallTimer(ms);
}

export function findCallIncident(state) {
  const id = state.call?.incidentId;
  if (id && state.incidents[id]) {
    const inc = state.incidents[id];
    if (CALL_STATES.has(inc.state)) return inc;
  }
  for (const iid of state.order) {
    const inc = state.incidents[iid];
    if (!inc) continue;
    if (inc.severity === "SEVERE" && CALL_STATES.has(inc.state)) return inc;
  }
  return null;
}

/**
 * Call provider label: the active call's DISPATCHED note says whether the api
 * placed a SignalWire call; with no call, /voice/status says what it would do.
 */
export function callNoteText(state) {
  const inc = findCallIncident(state);
  if (inc && state.call?.providerError) return "Call not connected";
  return "Connected to on-call responder";
}

/**
 * Build chronological utterances. Merge only tight streaming chunks from the
 * same speaker; never bridge across a speaker change or a long gap.
 */
export function buildThread(transcript) {
  const lines = transcript || [];
  /** @type {{ speaker: string, text: string, ts: string|null, lastMs: number }[]} */
  const out = [];
  for (const line of lines) {
    const ms = line.ts ? Date.parse(line.ts) : NaN;
    const text = line.text == null ? "" : String(line.text);
    const last = out[out.length - 1];
    const canMerge =
      last &&
      last.speaker === line.speaker &&
      !Number.isNaN(ms) &&
      !Number.isNaN(last.lastMs) &&
      ms - last.lastMs <= STREAM_MERGE_MS;

    if (canMerge) {
      const needSpace =
        last.text.length > 0 &&
        text.length > 0 &&
        !/\s$/.test(last.text) &&
        !/^\s/.test(text);
      last.text += (needSpace ? " " : "") + text;
      last.lastMs = ms;
      last.ts = line.ts ?? last.ts;
    } else {
      out.push({
        speaker: line.speaker,
        text,
        ts: line.ts ?? null,
        lastMs: Number.isNaN(ms) ? 0 : ms,
      });
    }
  }
  return out;
}

function formatToolValue(key, value) {
  if (key === "camera_id") return cameraLabel(String(value));
  if (key === "state") return stateLabel(String(value));
  if (key === "track_id") return personLabel(String(value));
  if (key === "peak_ts") return formatTimeLocal(String(value));
  if (key === "elapsed_seconds") return `${value} s`;
  if (key === "in_view") return value ? "Yes" : "No";
  if (typeof value === "string") return redactPlaces(value);
  return String(value);
}

function appendDl(parent, obj, rawHost) {
  // Empty values are hidden, never shown as a placeholder.
  if (!obj || typeof obj !== "object") return;
  const entries = Object.entries(obj).filter(([, v]) => v != null && v !== "");
  if (!entries.length) return;
  const RAW_KEYS = HIDDEN_TOOL_KEYS;
  const visible = entries.filter(
    ([k]) => !RAW_KEYS.has(k) && !LOCATION_TOOL_KEYS.has(k),
  );

  if (visible.length) {
    const dl = el("dl", { className: "call-tool__dl" });
    for (const [k, v] of visible) {
      dl.appendChild(el("dt", { text: toolKeyLabel(k) }));
      const dd = el("dd", { text: formatToolValue(k, v) });
      dd.title = formatToolValue(k, v);
      dl.appendChild(dd);
    }
    parent.appendChild(dl);
  }
  if (rawHost) rawHost.replaceChildren();
}

/**
 * Full Call Console page — white cards on dotted carbon (matches Call tab).
 */
export function mountCallHost(host, store, actions) {
  host.innerHTML = `
    <div class="call-console">
      <header class="card call-head-card lc-headcard" data-head>
        <div class="lc-head">
          <h2 class="lc-title" data-class>Emergency Call</h2>
          <div class="lc-timer" data-timerbox hidden>
            <span class="lc-timer__t mono" data-timer>00:00</span>
            <span class="lc-timer__live mono" data-live><span class="lc-timer__dot" aria-hidden="true"></span>LIVE</span>
          </div>
        </div>
        <p class="lc-meta" data-meta>No active call</p>
        <p class="ochip ochip--state lc-sim">Connected to on-call responder</p>
        <div class="call-head-card__action" data-action hidden></div>
      </header>

      <div class="call-console__grid">
        <section class="card chat-card call-console__chat" aria-label="Conversation">
          <h3 class="card__title call-console__section-h">Conversation</h3>
          <div class="call-console__chat-scroll" data-chat></div>
        </section>
        <section class="call-console__tools" aria-label="Call lookups" data-tools></section>
      </div>
    </div>
  `;

  const classEl = host.querySelector("[data-class]");
  const metaEl = host.querySelector("[data-meta]");
  const timerEl = host.querySelector("[data-timer]");
  const chatScroll = host.querySelector("[data-chat]");
  const toolsHost = host.querySelector("[data-tools]");
  const actionEl = host.querySelector("[data-action]");
  const noteEl = host.querySelector(".lc-sim");
  const timerBox = host.querySelector("[data-timerbox]");
  const liveEl = host.querySelector("[data-live]");
  let metaSig = null;

  let lastThreadLen = -1;
  let lastToolCount = -1;
  let actionKey = "";
  let opVersion = 0;

  /** No call yet: the selected open incident, if it can still be dispatched. */
  function callCandidate(state) {
    const inc = state.selectedId ? state.incidents[state.selectedId] : null;
    return inc && isOpenIncident(inc) && !isDispatchedOrLater(inc) ? inc : null;
  }

  function paintAction(cand) {
    const key = cand && actions ? `${cand.incident_id}|${cand.severity}|${opVersion}` : "";
    actionEl.hidden = !key;
    if (key === actionKey) return;
    actionKey = key;
    clear(actionEl);
    if (!key) return;
    actionEl.appendChild(actionBar(cand, actions, { review: false, card: false }));
  }

  document.addEventListener(OP_STATUS_EVENT, () => {
    opVersion += 1;
    render(store.getState());
  });
  let stickChat = true;
  let stickTools = true;

  chatScroll.addEventListener("scroll", () => {
    const gap =
      chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight;
    stickChat = gap < 48;
  });
  toolsHost.addEventListener("scroll", () => {
    const gap =
      toolsHost.scrollHeight - toolsHost.scrollTop - toolsHost.clientHeight;
    stickTools = gap < 48;
  });

  function renderChat(thread, hasCall = false) {
    clear(chatScroll);
    if (!thread.length) {
      chatScroll.appendChild(
        el("p", {
          className: "card__meta",
          text: hasCall ? "Connecting the call." : "Calls appear here when help is dispatched.",
        }),
      );
      return;
    }
    for (const u of thread) {
      const row = el("div", {
        className: `chat-msg chat-msg--${u.speaker}`,
      });
      const who = el("div", { className: "chat-msg__who mono" });
      who.appendChild(el("span", { text: u.speaker === "dispatcher" ? "Dispatcher" : "Sentinel" }));
      const ms = u.ts ? Date.parse(u.ts) : NaN;
      if (!Number.isNaN(ms)) who.appendChild(el("span", { text: formatClock(ms) }));
      row.appendChild(who);
      row.appendChild(
        el("div", {
          className: "chat-msg__bubble",
          text: maskPhones(redactPlaces(u.text)),
        }),
      );
      chatScroll.appendChild(row);
    }
  }

  function renderTools(tools) {
    clear(toolsHost);
    if (!tools.length) {
      const empty = el("div", { className: "card tool-card" });
      empty.appendChild(
        el("p", {
          className: "card__meta",
          text: "No information requested yet.",
        }),
      );
      toolsHost.appendChild(empty);
      return;
    }
    tools.forEach((t, i) => {
      const card = el("article", {
        className: `card tool-card${i === tools.length - 1 ? " call-tool--flash" : ""}`,
      });
      const head = el("header", { className: "tool-card__head" });
      head.appendChild(
        el("h3", {
          className: "tool-card__name",
          text: toolNameLabel(t.tool),
        }),
      );
      if (t.ts) {
        head.appendChild(
          el("span", {
            className: "card__label mono",
            text: formatTimeLocal(t.ts),
          }),
        );
      }
      card.appendChild(head);

      const body = el("div", { className: "tool-card__body" });
      if (t.result && typeof t.result === "object") {
        appendDl(body, t.result, null);
      } else if (t.args && typeof t.args === "object") {
        appendDl(body, t.args, null);
      }
      if (body.childNodes.length) card.appendChild(body);
      toolsHost.appendChild(card);
      if (i === tools.length - 1) {
        window.setTimeout(() => card.classList.remove("call-tool--flash"), 600);
      }
    });
  }

  function paintTimes(state, nowMs = now()) {
    const inc = findCallIncident(state);
    timerBox.hidden = !inc;
    if (inc) {
      setText(timerEl, callTimerText(inc, state, nowMs));
      liveEl.hidden = ENDED_CALL_STATES.has(inc.state);
    }
    const sig = inc ? `${inc.incident_id}|${callDescription(inc, state)}|${startedText(inc, state)}` : "";
    if (sig !== metaSig) {
      metaSig = sig;
      paintCallMeta(metaEl, inc, state);
    }
  }

  function render(state) {
    const inc = findCallIncident(state);
    setText(noteEl, callNoteText(state));
    paintTimes(state);
    const cand = inc ? null : callCandidate(state);
    paintAction(cand);
    if (!inc) {
      setText(classEl, "Emergency Call");
      // -2 = "no call" empty state, distinct from a call with no lines yet.
      if (lastThreadLen !== -2) {
        renderChat([]);
        lastThreadLen = -2;
      }
      if (lastToolCount !== 0) {
        renderTools([]);
        lastToolCount = 0;
      }
      return;
    }

    setText(classEl, "Emergency Call");

    const all = (state.call?.transcript || []).filter(
      (t) => !state.call.incidentId || t.incident_id === inc.incident_id,
    );
    const tools = (state.call?.tools || []).filter(
      (t) => !state.call.incidentId || t.incident_id === inc.incident_id,
    );

    const thread = buildThread(all);
    if (thread.length !== lastThreadLen) {
      renderChat(thread, true);
      lastThreadLen = thread.length;
    }
    if (tools.length !== lastToolCount) {
      renderTools(tools);
      lastToolCount = tools.length;
    }

    if (stickChat) chatScroll.scrollTop = chatScroll.scrollHeight;
    if (stickTools) toolsHost.scrollTop = toolsHost.scrollHeight;
  }

  render(store.getState());
  const unsub = store.subscribe(render);
  const unsubTick = subscribeTick((nowMs) => paintTimes(store.getState(), nowMs));
  const unsubVoice = subscribeModelStatus(() => render(store.getState()));

  return () => {
    unsub();
    unsubTick();
    unsubVoice();
  };
}

/**
 * "Weapon call · Camera 1, 2, 3": the cameras on this incident's path in
 * order of first appearance, without repeats; one camera → "Camera 1".
 */
export function callDescription(inc, state) {
  const path = Array.isArray(state?.cameraPath?.[inc.incident_id]) ? state.cameraPath[inc.incident_id] : [];
  const ids = [];
  for (const id of [...path, inc.camera_id]) if (id && !ids.includes(id)) ids.push(id);
  const nums = ids.map((id, i) => (i === 0 ? cameraLabel(id) : cameraLabel(id).replace(/^Camera\s+/, "")));
  return nums.length ? `${classLabel(inc.class_token)} call · ${nums.join(", ")}` : `${classLabel(inc.class_token)} call`;
}

/** " · started 14:02:11" for a call, or "" when the start is unknown. */
function startedText(inc, state) {
  const ms = Date.parse(dispatchedTs(inc, state) || "");
  return Number.isNaN(ms) ? "" : ` · started ${formatClock(ms)}`;
}

/** Fill a header description line: plain description + muted mono start. */
function paintCallMeta(metaEl, inc, state) {
  clear(metaEl);
  if (!inc) {
    metaEl.appendChild(document.createTextNode("No active call"));
    return;
  }
  metaEl.appendChild(document.createTextNode(callDescription(inc, state)));
  const started = startedText(inc, state);
  if (started) metaEl.appendChild(el("span", { className: "lc-meta__start mono", text: started }));
}

/** Past-tense line for a tool event chip in the Live transcript. */
const TOOL_CHIP_TEXT = {
  lookup_location: "Looked up location",
  get_person_description: "Checked person description",
  get_elapsed_time: "Checked elapsed time",
  get_suspect_status: "Checked suspect status",
  repeat_last: "Repeated last update",
};

/**
 * Never show a phone number on Live: mask digit runs with 10 or more digits
 * (dates and times have fewer).
 */
export function maskPhones(text) {
  return String(text ?? "").replace(/\+?\d[\d\s().-]{7,}\d/g, (m) =>
    (m.match(/\d/g) || []).length >= 10 ? "[number hidden]" : m,
  );
}

export function toolChipText(tool) {
  return TOOL_CHIP_TEXT[String(tool || "")] || toolNameLabel(tool);
}

/**
 * Live right-column call section: eyebrow + "<Class> call" with the mm:ss
 * timer and a LIVE dot, "Camera N · place · started hh:mm:ss", the call
 * provider pill, then one transcript with tool events as inline chips and
 * the existing call action pinned at the bottom. Same data and actions as
 * mountCallHost (the Call Console page keeps that one).
 */
export function mountLiveCall(host, store, actions) {
  host.innerHTML = `
    <section class="card lc" aria-label="Call">
      <header class="lc-head">
        <h2 class="lc-title" data-title>Emergency Call</h2>
        <div class="lc-timer" data-timerbox hidden>
          <span class="lc-timer__t mono" data-timer>00:00</span>
          <span class="lc-timer__live mono" data-live><span class="lc-timer__dot" aria-hidden="true"></span>LIVE</span>
        </div>
      </header>
      <p class="lc-meta" data-meta>No active call</p>
      <p class="ochip ochip--state lc-sim" data-note>Connected to on-call responder</p>
      <div class="lc-thread" data-thread role="log" aria-live="polite" aria-label="Call transcript"></div>
      <div class="lc-actions is-empty" data-action></div>
    </section>
  `;
  const titleEl = host.querySelector("[data-title]");
  const timerBox = host.querySelector("[data-timerbox]");
  const liveEl = host.querySelector("[data-live]");
  const timerEl = host.querySelector("[data-timer]");
  const metaEl = host.querySelector("[data-meta]");
  const noteEl = host.querySelector("[data-note]");
  const threadEl = host.querySelector("[data-thread]");
  const actionEl = host.querySelector("[data-action]");

  let threadSig = null;
  let metaSig = null;
  let actionKey = "";
  let opVersion = 0;
  let stick = true;

  threadEl.addEventListener("scroll", () => {
    stick = threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight < 48;
  });

  /** No call yet: the selected open incident, if it can still be dispatched. */
  function callCandidate(state) {
    const inc = state.selectedId ? state.incidents[state.selectedId] : null;
    return inc && isOpenIncident(inc) && !isDispatchedOrLater(inc) ? inc : null;
  }

  function paintAction(cand) {
    const key = cand && actions ? `${cand.incident_id}|${cand.severity}|${opVersion}` : "";
    // Never hidden: the row also keeps room for the docked Assist button.
    actionEl.classList.toggle("is-empty", !key);
    if (key === actionKey) return;
    actionKey = key;
    clear(actionEl);
    if (key) actionEl.appendChild(actionBar(cand, actions, { review: false, card: false }));
  }

  function paintTimes(state, nowMs = now()) {
    const inc = findCallIncident(state);
    timerBox.hidden = !inc;
    if (inc) {
      setText(timerEl, callTimerText(inc, state, nowMs));
      liveEl.hidden = ENDED_CALL_STATES.has(inc.state);
    }
    const sig = inc ? `${inc.incident_id}|${callDescription(inc, state)}|${startedText(inc, state)}` : "";
    if (sig !== metaSig) {
      metaSig = sig;
      paintCallMeta(metaEl, inc, state);
    }
  }

  function bubble(u) {
    const who = u.speaker === "dispatcher" ? "dispatcher" : "sentinel";
    const row = el("div", { className: `lc-msg lc-msg--${who}` });
    const head = el("div", { className: "lc-msg__who mono" });
    head.appendChild(el("span", { text: who === "dispatcher" ? "Dispatcher" : "Sentinel" }));
    const ms = u.ts ? Date.parse(u.ts) : NaN;
    if (!Number.isNaN(ms)) head.appendChild(el("span", { text: formatClock(ms) }));
    row.appendChild(head);
    row.appendChild(el("div", { className: "lc-msg__bubble", text: maskPhones(redactPlaces(u.text)) }));
    return row;
  }

  function toolChip(t) {
    return el("div", { className: "lc-tool mono", text: `↳ ${toolChipText(t.tool)}` });
  }

  function renderThread(inc, thread, tools) {
    renderConversation(threadEl, {
      lines: thread,
      tools,
      compact: true,
      live: Boolean(inc) && !ENDED_CALL_STATES.has(inc.state),
      nowMs: now(),
      empty: inc ? "Connecting the call." : "Calls appear here when help is dispatched.",
    });
  }

  function render(state) {
    const inc = findCallIncident(state);
    setText(noteEl, callNoteText(state));
    paintTimes(state);
    const cand = inc ? null : callCandidate(state);
    paintAction(cand);
    setText(titleEl, "Emergency Call");
    const all = inc
      ? (state.call?.transcript || []).filter((t) => !state.call.incidentId || t.incident_id === inc.incident_id)
      : [];
    const tools = inc
      ? (state.call?.tools || []).filter((t) => !state.call.incidentId || t.incident_id === inc.incident_id)
      : [];
    const thread = buildThread(all);
    const last = thread[thread.length - 1];
    const sig = `${inc?.incident_id || ""}|${thread.length}|${last ? last.text.length : 0}|${tools.length}`;
    if (sig !== threadSig) {
      threadSig = sig;
      renderThread(inc, thread, tools);
    }
    if (stick) threadEl.scrollTop = threadEl.scrollHeight;
  }

  const onOp = () => {
    opVersion += 1;
    render(store.getState());
  };
  document.addEventListener(OP_STATUS_EVENT, onOp);
  render(store.getState());
  const unsub = store.subscribe(render);
  const unsubTick = subscribeTick((nowMs) => paintTimes(store.getState(), nowMs));
  const unsubVoice = subscribeModelStatus(() => render(store.getState()));

  return () => {
    unsub();
    unsubTick();
    unsubVoice();
    document.removeEventListener(OP_STATUS_EVENT, onOp);
  };
}

/** @deprecated overlay removed — keep export for autofollow import. */
export function mountCall() {
  return () => {};
}

export function mountCallPage(el, store, actions) {
  return mountCallHost(el, store, actions);
}

/**
 * Compact floating call panel — a second panel beside the incidents
 * sidebar, opened only by its "Call" button or autofollow on DISPATCHED.
 * Same sidebar visual language (.sidebar/.sidebar__head/.sidebar__body,
 * .card, .chat-card, .tool-card). Uses "callpanel-*" for its own bits
 * (brief row, ended state, footer) to avoid the legacy call-page CSS.
 */
export function mountCallPanel(root, store, actions) {
  let open = false;

  root.innerHTML = `
    <div class="sidebar callpanel">
      <header class="sidebar__head">
        <span class="callpanel__label">Call</span>
        <span class="call-sim-note">Connected to on-call responder</span>
        <button type="button" class="btn btn--ghost" data-close aria-label="Close call panel">Close</button>
      </header>
      <div class="sidebar__body">
        <div class="sidebar-stack sidebar-stack--scroll">
          <div class="card call-head-card" data-head>
            <div class="call-head-card__title-row">
              <h2 class="call-head-card__title" data-class>No active call</h2>
              <span class="callpanel__cam mono" data-head-cam hidden></span>
            </div>
            <span class="call-head-card__timer mono" data-timer>00:00</span>
          </div>

          <div class="card callpanel-brief" data-brief hidden>
            <div class="callpanel-brief__cell">
              <span class="callpanel-brief__k">Camera</span>
              <span class="callpanel-brief__v" data-brief-cam></span>
            </div>
            <div class="callpanel-brief__cell">
              <span class="callpanel-brief__k">Person</span>
              <span class="callpanel-brief__v" data-brief-person></span>
            </div>
            <div class="callpanel-brief__cell">
              <span class="callpanel-brief__k">Elapsed</span>
              <span class="callpanel-brief__v mono" data-brief-elapsed></span>
            </div>
          </div>

          <p class="card callpanel-ended" data-ended hidden></p>

          <div class="card chat-card" data-chat></div>

          <div data-tools></div>

          <div class="callpanel-footer" data-footer></div>
        </div>
      </div>
    </div>
  `;

  const classEl = root.querySelector("[data-class]");
  const headCamEl = root.querySelector("[data-head-cam]");
  const timerEl = root.querySelector("[data-timer]");
  const briefEl = root.querySelector("[data-brief]");
  const briefCamEl = root.querySelector("[data-brief-cam]");
  const briefPersonEl = root.querySelector("[data-brief-person]");
  const briefElapsedEl = root.querySelector("[data-brief-elapsed]");
  const endedEl = root.querySelector("[data-ended]");
  const chatHost = root.querySelector("[data-chat]");
  const toolsHost = root.querySelector("[data-tools]");
  const footerEl = root.querySelector("[data-footer]");
  const scrollEl = root.querySelector(".sidebar-stack--scroll");
  const noteEl = root.querySelector(".call-sim-note");

  let lastThreadLen = -1;
  let lastToolId = null;
  let stickBottom = true;
  let footerKey = "";
  let opVersion = 0;

  /** Broadcast for the live call; rebuilt only when its inputs change. */
  function paintFooter(inc) {
    const live = Boolean(inc && actions && !ENDED_CALL_STATES.has(inc.state));
    const key = live ? `${inc.incident_id}|${opVersion}` : "";
    if (key === footerKey) return;
    footerKey = key;
    clear(footerEl);
    if (!live) return;
    const op = operatorActions(inc, actions, { call: false });
    footerEl.appendChild(op.row);
    footerEl.appendChild(op.note);
  }

  document.addEventListener(OP_STATUS_EVENT, () => {
    opVersion += 1;
    if (open) paintFooter(findCallIncident(store.getState()));
  });

  scrollEl.addEventListener("scroll", () => {
    const gap = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    stickBottom = gap < 48;
  });

  root.querySelector("[data-close]").addEventListener("click", () => api.close());

  function renderChat(thread, hasCall = false) {
    clear(chatHost);
    if (!thread.length) {
      chatHost.appendChild(
        el("p", {
          className: "card__meta",
          text: hasCall ? "Connecting the call." : "Calls appear here when help is dispatched.",
        }),
      );
      return;
    }
    for (const u of thread) {
      const row = el("div", { className: `chat-msg chat-msg--${u.speaker}` });
      const who = el("div", { className: "chat-msg__who mono" });
      who.appendChild(el("span", { text: u.speaker === "dispatcher" ? "Dispatcher" : "Sentinel" }));
      const ms = u.ts ? Date.parse(u.ts) : NaN;
      if (!Number.isNaN(ms)) who.appendChild(el("span", { text: formatClock(ms) }));
      row.appendChild(who);
      row.appendChild(
        el("div", {
          className: "chat-msg__bubble",
          text: maskPhones(redactPlaces(u.text)),
        }),
      );
      chatHost.appendChild(row);
    }
  }

  function renderLatestTool(tools) {
    clear(toolsHost);
    if (!tools.length) return;
    const t = tools[tools.length - 1];
    const card = el("article", { className: "card tool-card call-tool--flash" });
    const head = el("header", { className: "tool-card__head" });
    head.appendChild(
      el("h3", { className: "tool-card__name", text: toolNameLabel(t.tool) }),
    );
    if (t.ts) {
      head.appendChild(
        el("span", { className: "card__label mono", text: formatTimeLocal(t.ts) }),
      );
    }
    card.appendChild(head);
    const body = el("div", { className: "tool-card__body" });
    if (t.result && typeof t.result === "object") {
      appendDl(body, t.result, null);
    } else if (t.args && typeof t.args === "object") {
      appendDl(body, t.args, null);
    }
    if (body.childNodes.length) card.appendChild(body);
    toolsHost.appendChild(card);
    window.setTimeout(() => card.classList.remove("call-tool--flash"), 600);
  }

  function paintTimes(state, nowMs = now()) {
    if (!open) return;
    const inc = findCallIncident(state);
    const text = callTimerText(inc, state, nowMs);
    setText(timerEl, text);
    setText(briefElapsedEl, text);
    if (inc && ENDED_CALL_STATES.has(inc.state)) {
      const endIso =
        timelineTs(inc, ENDED_CALL_STATES) || inc.updated_at || inc.created_at || inc.peak_ts;
      setText(
        endedEl,
        [
          `Call ended ${formatRel(endIso, nowMs)}`,
          cameraLabel(inc.camera_id),
          String(inc.person_description || "").trim(),
        ]
          .filter(Boolean)
          .join(" · "),
      );
    }
  }

  function render(state) {
    if (!open) return;
    const inc = findCallIncident(state);
    setText(noteEl, callNoteText(state));
    paintTimes(state);
    paintFooter(inc);

    if (!inc) {
      setText(classEl, "No active call");
      headCamEl.hidden = true;
      briefEl.hidden = true;
      endedEl.hidden = true;
      // -2 = "no call" empty state, distinct from a call with no lines yet.
      if (lastThreadLen !== -2) {
        renderChat([]);
        lastThreadLen = -2;
      }
      if (lastToolId !== null) {
        renderLatestTool([]);
        lastToolId = null;
      }
      return;
    }

    const ended = ENDED_CALL_STATES.has(inc.state);
    setText(classEl, "Emergency Call");
    headCamEl.hidden = false;
    setText(headCamEl, cameraTitle(inc.camera_id));

    if (ended) {
      briefEl.hidden = true;
      endedEl.hidden = false;
    } else {
      briefEl.hidden = false;
      endedEl.hidden = true;
      setText(briefCamEl, cameraTitle(inc.camera_id));
      // The brief grid needs the cell: muted "Pending" until a description arrives.
      const person = String(inc.person_description || "").trim();
      briefPersonEl.classList.toggle("is-pending", !person);
      setText(briefPersonEl, person || notReported());
    }

    const all = (state.call?.transcript || []).filter(
      (t) => !state.call.incidentId || t.incident_id === inc.incident_id,
    );
    const tools = (state.call?.tools || []).filter(
      (t) => !state.call.incidentId || t.incident_id === inc.incident_id,
    );

    const thread = buildThread(all);
    if (thread.length !== lastThreadLen) {
      renderChat(thread, true);
      lastThreadLen = thread.length;
    }
    const lastTool = tools[tools.length - 1];
    const toolId = lastTool ? `${lastTool.tool}:${lastTool.ts}` : null;
    if (toolId !== lastToolId) {
      renderLatestTool(tools);
      lastToolId = toolId;
    }

    if (stickBottom) scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  store.subscribe(render);
  subscribeTick((nowMs) => paintTimes(store.getState(), nowMs));
  subscribeModelStatus(() => render(store.getState()));

  const api = {
    isOpen: () => open,
    open() {
      // Live shows the call in its right column (ui/live.js), so the
      // floating panel and body.call-open are not used there.
      if (document.body.classList.contains("route-live")) return;
      open = true;
      root.hidden = false;
      document.body.classList.add("call-open");
      render(store.getState());
    },
    close() {
      open = false;
      root.hidden = true;
      document.body.classList.remove("call-open");
    },
  };

  root.hidden = true;
  return api;
}
