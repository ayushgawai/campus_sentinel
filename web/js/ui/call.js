/** Call Console — single chat thread + tool cards. No floating overlay. */

import { DEMO_EPOCH_MS } from "../mock.js";
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

function demoNowMs(state) {
  return DEMO_EPOCH_MS + (state.demo?.t ?? 0) * 1000;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function formatCallTimer(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}`;
}

function dispatchedTs(inc, state) {
  if (state?.call?.dispatchedAt) return state.call.dispatchedAt;
  if (!inc?.timeline) return null;
  for (const ev of inc.timeline) {
    if (ev.state === "DISPATCHED" && ev.ts) return ev.ts;
  }
  return null;
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

  function updateTimer(inc, state) {
    const dts = dispatchedTs(inc, state);
    if (!dts) {
      setText(timerEl, "00:00");
      return;
    }
    setText(timerEl, formatCallTimer(demoNowMs(state) - Date.parse(dts)));
  }

  function render(state) {
    const inc = findCallIncident(state);
    if (!inc) {
      setText(classEl, "No active call");
      setText(metaEl, "");
      setText(timerEl, "00:00");
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
    const dts = dispatchedTs(inc, state);
    const started = formatRel(
      dts || inc.created_at || inc.peak_ts,
      demoNowMs(state),
    );
    setText(
      metaEl,
      `${cameraLabel(inc.camera_id)} · started ${started}`,
    );
    updateTimer(inc, state);

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
  const tick = window.setInterval(() => {
    const state = store.getState();
    const inc = findCallIncident(state);
    if (inc) updateTimer(inc, state);
  }, 1000);

  return () => {
    unsub();
    window.clearInterval(tick);
  };
}

/** @deprecated overlay removed — keep export for autofollow import. */
export function mountCall() {
  return () => {};
}

export function mountCallPage(el, store) {
  return mountCallHost(el, store);
}
