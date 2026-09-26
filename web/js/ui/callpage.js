/**
 * Call Console page: the active call (unchanged, mountCallHost) and a
 * "Call history" tab with past calls saved in this browser
 * (callHistory.js) — a list on the left, the selected call's read-only
 * transcript on the right in the same bubble style as the live call.
 */

import { formatCallTimer } from "./call.js?v=pro4";
import { mountCallConsole, renderSavedCall } from "./callConsole.js?v=pro4";
import {
  KEEP_CALLS,
  clearCalls,
  historyUnavailable,
  listCalls,
  subscribeHistory,
} from "../callHistory.js?v=pro4";
import { classLabel, formatClock } from "../format.js?v=pro4";
import { clear, el } from "../dom.js?v=pro4";

function dateTime(iso) {
  const ms = Date.parse(iso || "");
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms);
  const day = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return `${day} · ${formatClock(ms)}`;
}

export function mountCallPage(root, store, actions) {
  root.classList.add("callpage");
  root.innerHTML = `
    <div class="callpage__tabs" role="tablist" aria-label="Call Console">
      <button type="button" role="tab" class="callpage__tab is-active" data-tab="active" aria-selected="true" aria-controls="callpage-active">Active call</button>
      <button type="button" role="tab" class="callpage__tab" data-tab="history" aria-selected="false" aria-controls="callpage-history">Call history</button>
    </div>
    <div class="callpage__panel" id="callpage-active" role="tabpanel" data-panel="active"></div>
    <div class="callpage__panel" id="callpage-history" role="tabpanel" data-panel="history" hidden>
      <div class="ch-layout">
        <section class="card ch" aria-label="Call history">
          <header class="ch__head">
            <div>
              <h2 class="ch__title">Call history</h2>
              <p class="ch__note">Saved on this browser · last ${KEEP_CALLS} calls</p>
            </div>
            <div class="ch__clear" data-clear-box>
              <button type="button" class="btn btn--sm ch__btn ch__btn--danger" data-clear>Clear history</button>
            </div>
          </header>
          <ol class="ch__list" data-list aria-label="Past calls"></ol>
        </section>
        <div class="ch-view" data-detail></div>
      </div>
    </div>
  `;

  const tabs = [...root.querySelectorAll("[data-tab]")];
  const panels = {
    active: root.querySelector('[data-panel="active"]'),
    history: root.querySelector('[data-panel="history"]'),
  };
  const listEl = root.querySelector("[data-list]");
  const detailEl = root.querySelector("[data-detail]");
  const clearBox = root.querySelector("[data-clear-box]");

  const unmountActive = mountCallConsole(panels.active, store, actions);

  let tab = "active";
  let calls = [];
  let selectedId = null;

  function setTab(next) {
    tab = next;
    for (const b of tabs) {
      const on = b.dataset.tab === tab;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    }
    panels.active.hidden = tab !== "active";
    panels.history.hidden = tab !== "history";
    if (tab === "history") refresh();
  }
  for (const b of tabs) b.addEventListener("click", () => setTab(b.dataset.tab));

  function renderList() {
    clear(listEl);
    if (!calls.length) {
      listEl.appendChild(
        el("li", {
          className: "ch__empty",
          text: historyUnavailable() ? "This browser can't save calls." : "No saved calls yet",
        }),
      );
      return;
    }
    for (const c of calls) {
      const li = el("li", {});
      const b = el("button", {
        type: "button",
        className: `ch__row ch__row--${c.severity === "SEVERE" ? "severe" : "minor"}${c.id === selectedId ? " is-selected" : ""}`,
        attrs: { "aria-current": c.id === selectedId ? "true" : "false" },
        onClick: () => {
          selectedId = c.id;
          renderList();
          renderDetail();
        },
      });
      const l1 = el("span", { className: "ch__row-l1" });
      l1.appendChild(el("span", { className: "ch__row-class", text: classLabel(c.classToken) }));
      l1.appendChild(el("span", { className: "ochip ochip--state", text: c.endedAt ? "Ended" : "Not finished" }));
      l1.appendChild(el("span", { className: "ch__row-dur mono", text: formatCallTimer(c.durationMs) }));
      b.appendChild(l1);
      const cams = String(c.description || c.camera || "").replace(/^[^·]*·\s*/, "");
      b.appendChild(el("span", { className: "ch__row-meta", text: `${cams} · ${dateTime(c.startedAt)}` }));
      li.appendChild(b);
      listEl.appendChild(li);
    }
  }

  function renderDetail() {
    renderSavedCall(detailEl, calls.find((x) => x.id === selectedId) || null);
  }

  // Clear history: an in-page confirmation, never confirm().
  function showClear(confirming) {
    clear(clearBox);
    if (!confirming) {
      clearBox.appendChild(
        el("button", {
          type: "button",
          className: "btn btn--sm ch__btn ch__btn--danger",
          text: "Clear history",
          attrs: { "data-clear": "" },
          disabled: !calls.length,
          onClick: () => showClear(true),
        }),
      );
      return;
    }
    const msg = el("span", { className: "ch__confirm", text: "Delete all saved calls on this browser?", attrs: { role: "alert" } });
    const cancel = el("button", {
      type: "button",
      className: "btn btn--sm ch__btn",
      text: "Cancel",
      onClick: () => showClear(false),
    });
    const yes = el("button", {
      type: "button",
      className: "btn btn--sm ch__btn ch__btn--danger-fill",
      text: "Delete",
      attrs: { "data-clear-yes": "" },
      onClick: async () => {
        await clearCalls();
        selectedId = null;
        showClear(false);
      },
    });
    clearBox.appendChild(msg);
    clearBox.appendChild(cancel);
    clearBox.appendChild(yes);
    cancel.focus();
  }

  async function refresh() {
    calls = await listCalls();
    if (!calls.some((c) => c.id === selectedId)) selectedId = calls[0]?.id || null;
    renderList();
    renderDetail();
    if (!clearBox.querySelector(".ch__confirm")) showClear(false);
  }

  const unsubHistory = subscribeHistory(() => {
    if (tab === "history") refresh();
  });
  showClear(false);

  return () => {
    unsubHistory();
    if (typeof unmountActive === "function") unmountActive();
  };
}

