/** Call Console — single chat thread + tool cards. No floating overlay. */

import { now, subscribeTick } from "../clock.js";
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
} from "../format.js";
import { redactPlaces } from "../site.js";
import { clear, el, setText } from "../dom.js";

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
function dispatchedTs(inc, state) {
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

function callTimerText(inc, state, nowMs) {
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
  if (value == null) return notReported();
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
  if (!obj || typeof obj !== "object") {
    parent.appendChild(
      el("div", { className: "call-tool__empty", text: notReported() }),
    );
    return;
  }
  const entries = Object.entries(obj);
  if (!entries.length) {
    parent.appendChild(
      el("div", { className: "call-tool__empty", text: notReported() }),
    );
    return;
  }
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
  } else {
    parent.appendChild(
      el("div", { className: "call-tool__empty", text: notReported() }),
    );
  }
  if (rawHost) rawHost.replaceChildren();
}

/**
 * Full Call Console page — white cards on dotted carbon (matches Call tab).
 */
export function mountCallHost(host, store) {
  host.innerHTML = `
    <div class="call-console">
      <header class="card call-head-card" data-head>
        <div class="call-head-card__title-row">
          <h2 class="call-head-card__title" data-class>No active call</h2>
          <span class="card-chip card-chip--dispatch" data-sim hidden>SIMULATED</span>
        </div>
        <span class="call-head-card__timer mono" data-timer>00:00</span>
        <p class="call-head-card__meta" data-meta></p>
      </header>

      <div class="call-console__grid">
        <section class="card chat-card call-console__chat" aria-label="Conversation">
          <h3 class="card__title call-console__section-h">Conversation</h3>
          <div class="call-console__chat-scroll" data-chat></div>
        </section>
        <section class="call-console__tools" aria-label="Live tools" data-tools></section>
      </div>
    </div>
  `;

  const classEl = host.querySelector("[data-class]");
  const simEl = host.querySelector("[data-sim]");
  const metaEl = host.querySelector("[data-meta]");
  const timerEl = host.querySelector("[data-timer]");
  const chatScroll = host.querySelector("[data-chat]");
  const toolsHost = host.querySelector("[data-tools]");

  let lastThreadLen = -1;
  let lastToolCount = -1;
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

  function renderChat(thread) {
    clear(chatScroll);
    if (!thread.length) {
      chatScroll.appendChild(
        el("p", {
          className: "card__meta",
          text: "Awaiting dispatch. The console opens when a severe incident is handed to a unit.",
        }),
      );
      return;
    }
    for (const u of thread) {
      const row = el("div", {
        className: `chat-msg chat-msg--${u.speaker}`,
      });
      row.appendChild(
        el("div", {
          className: "chat-msg__who",
          text: u.speaker === "dispatcher" ? "Dispatcher" : "Sentinel",
        }),
      );
      row.appendChild(
        el("div", {
          className: "chat-msg__bubble",
          text: redactPlaces(u.text),
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
          text: "No tools used yet.",
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
      } else {
        body.appendChild(
          el("p", { className: "card__meta", text: notReported() }),
        );
      }
      card.appendChild(body);
      toolsHost.appendChild(card);
      if (i === tools.length - 1) {
        window.setTimeout(() => card.classList.remove("call-tool--flash"), 600);
      }
    });
  }

  function paintTimes(state, nowMs = now()) {
    const inc = findCallIncident(state);
    setText(timerEl, callTimerText(inc, state, nowMs));
    if (!inc) {
      setText(metaEl, "");
      return;
    }
    const started = formatRel(
      dispatchedTs(inc, state) || inc.created_at || inc.peak_ts,
      nowMs,
    );
    setText(metaEl, `${cameraLabel(inc.camera_id)} · started ${started}`);
  }

  function render(state) {
    const inc = findCallIncident(state);
    paintTimes(state);
    if (!inc) {
      setText(classEl, "No active call");
      simEl.hidden = true;
      if (lastThreadLen !== 0) {
        renderChat([]);
        lastThreadLen = 0;
      }
      if (lastToolCount !== 0) {
        renderTools([]);
        lastToolCount = 0;
      }
      return;
    }

    setText(classEl, `${classLabel(inc.class_token)} call`);
    simEl.hidden = false;

    const all = (state.call?.transcript || []).filter(
      (t) => !state.call.incidentId || t.incident_id === inc.incident_id,
    );
    const tools = (state.call?.tools || []).filter(
      (t) => !state.call.incidentId || t.incident_id === inc.incident_id,
    );

    const thread = buildThread(all);
    if (thread.length !== lastThreadLen) {
      renderChat(thread);
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

  return () => {
    unsub();
    unsubTick();
  };
}

/** @deprecated overlay removed — keep export for autofollow import. */
export function mountCall() {
  return () => {};
}

export function mountCallPage(el, store) {
  return mountCallHost(el, store);
}

/**
 * Compact floating call panel — a second panel beside the incidents
 * sidebar, opened only by its "Call" button or autofollow on DISPATCHED.
 * Same sidebar visual language (.sidebar/.sidebar__head/.sidebar__body,
 * .card, .chat-card, .tool-card). Uses "callpanel-*" for its own bits
 * (brief row, ended state, footer) to avoid the legacy call-page CSS.
 */
export function mountCallPanel(root, store) {
  let open = false;

  root.innerHTML = `
    <div class="sidebar callpanel">
      <header class="sidebar__head">
        <span class="callpanel__label">Call</span>
        <button type="button" class="btn btn--ghost" data-close aria-label="Close call panel">Close</button>
      </header>
      <div class="sidebar__body">
        <div class="sidebar-stack sidebar-stack--scroll">
          <div class="card call-head-card" data-head>
            <div class="call-head-card__title-row">
              <h2 class="call-head-card__title" data-class>No active call</h2>
              <span class="callpanel__cam mono" data-head-cam hidden></span>
              <span class="card-chip card-chip--dispatch" data-sim hidden>SIMULATED</span>
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
  const simEl = root.querySelector("[data-sim]");
  const timerEl = root.querySelector("[data-timer]");
  const briefEl = root.querySelector("[data-brief]");
  const briefCamEl = root.querySelector("[data-brief-cam]");
  const briefPersonEl = root.querySelector("[data-brief-person]");
  const briefElapsedEl = root.querySelector("[data-brief-elapsed]");
  const endedEl = root.querySelector("[data-ended]");
  const chatHost = root.querySelector("[data-chat]");
  const toolsHost = root.querySelector("[data-tools]");
  const scrollEl = root.querySelector(".sidebar-stack--scroll");

  let lastThreadLen = -1;
  let lastToolId = null;
  let stickBottom = true;

  scrollEl.addEventListener("scroll", () => {
    const gap = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    stickBottom = gap < 48;
  });

  root.querySelector("[data-close]").addEventListener("click", () => api.close());

  function renderChat(thread) {
    clear(chatHost);
    if (!thread.length) {
      chatHost.appendChild(
        el("p", {
          className: "card__meta",
          text: "Awaiting dispatch conversation.",
        }),
      );
      return;
    }
    for (const u of thread) {
      const row = el("div", { className: `chat-msg chat-msg--${u.speaker}` });
      row.appendChild(
        el("div", {
          className: "chat-msg__who",
          text: u.speaker === "dispatcher" ? "Dispatcher" : "Sentinel",
        }),
      );
      row.appendChild(
        el("div", {
          className: "chat-msg__bubble",
          text: redactPlaces(u.text),
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
    } else {
      body.appendChild(el("p", { className: "card__meta", text: notReported() }));
    }
    card.appendChild(body);
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
        `Call ended ${formatRel(endIso, nowMs)} · ${cameraLabel(inc.camera_id)} · ${textOr(inc.person_description, notReported())}`,
      );
    }
  }

  function render(state) {
    if (!open) return;
    const inc = findCallIncident(state);
    paintTimes(state);

    if (!inc) {
      setText(classEl, "No active call");
      headCamEl.hidden = true;
      briefEl.hidden = true;
      endedEl.hidden = true;
      simEl.hidden = true;
      if (lastThreadLen !== 0) {
        renderChat([]);
        lastThreadLen = 0;
      }
      if (lastToolId !== null) {
        renderLatestTool([]);
        lastToolId = null;
      }
      return;
    }

    const ended = ENDED_CALL_STATES.has(inc.state);
    setText(classEl, `${classLabel(inc.class_token)} call`);
    headCamEl.hidden = false;
    setText(headCamEl, cameraLabel(inc.camera_id));
    simEl.hidden = false;

    if (ended) {
      briefEl.hidden = true;
      endedEl.hidden = false;
    } else {
      briefEl.hidden = false;
      endedEl.hidden = true;
      setText(briefCamEl, cameraLabel(inc.camera_id));
      setText(briefPersonEl, textOr(inc.person_description, notReported()));
    }

    const all = (state.call?.transcript || []).filter(
      (t) => !state.call.incidentId || t.incident_id === inc.incident_id,
    );
    const tools = (state.call?.tools || []).filter(
      (t) => !state.call.incidentId || t.incident_id === inc.incident_id,
    );

    const thread = buildThread(all);
    if (thread.length !== lastThreadLen) {
      renderChat(thread);
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

  const api = {
    isOpen: () => open,
    open() {
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
