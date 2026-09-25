/**
 * Assist button — bottom-right on Live. Opens a small menu with the two
 * existing operator actions: Report incident and Broadcast (operator.js
 * dialogs). The I key does the same. It no longer opens a sidebar: the Live
 * page shows incidents, map and call in its own columns.
 */

import { now as clockNow } from "../clock.js?v=live2";
import { isOpenIncident } from "../format.js?v=live2";
import { el } from "../dom.js?v=live2";
import { LOGO_MARK_INVERSE } from "../logo.js?v=live2";
import { OP_BROADCAST_EVENT, OP_REPORT_EVENT } from "./operator.js?v=live2";

function activeCount(state) {
  let n = 0;
  let maxSev = "NONE";
  for (const id of state.order) {
    const inc = state.incidents[id];
    if (!inc || !isOpenIncident(inc)) continue;
    if (inc.severity !== "SEVERE" && inc.severity !== "MINOR") continue;
    n += 1;
    if (inc.severity === "SEVERE") maxSev = "SEVERE";
    else if (maxSev !== "SEVERE") maxSev = "MINOR";
  }
  return { n, maxSev };
}

export function mountAssist(root, store) {
  if (!root) return () => {};

  root.innerHTML = `
    <button type="button" class="assist assist--br" id="assist-btn"
      aria-label="Operator actions" aria-haspopup="menu" aria-expanded="false" aria-controls="assist-menu">
      <span class="assist__mark">${LOGO_MARK_INVERSE}</span>
      <span class="assist__badge" data-badge hidden>0</span>
    </button>
  `;
  const btn = root.querySelector(".assist");
  const badge = root.querySelector("[data-badge]");
  let lastSeverePulse = 0;

  const menu = el("div", {
    className: "assist-menu surface-light",
    id: "assist-menu",
    attrs: { role: "menu", "aria-label": "Operator actions" },
  });
  menu.hidden = true;
  const reportItem = el("button", {
    type: "button",
    className: "assist-menu__item",
    text: "Report incident",
    attrs: { role: "menuitem" },
  });
  const broadcastItem = el("button", {
    type: "button",
    className: "assist-menu__item",
    text: "Broadcast",
    attrs: { role: "menuitem" },
  });
  menu.appendChild(reportItem);
  menu.appendChild(broadcastItem);
  root.appendChild(menu);

  function isMenuOpen() {
    return !menu.hidden;
  }

  function openMenu() {
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    reportItem.focus({ preventScroll: true });
    document.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("keydown", onMenuKey, true);
  }

  function closeMenu(returnFocus = true) {
    if (!isMenuOpen()) return;
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("keydown", onMenuKey, true);
    if (returnFocus) btn.focus({ preventScroll: true });
  }

  function onOutside(e) {
    if (menu.contains(e.target) || btn.contains(e.target)) return;
    closeMenu(false);
  }

  function onMenuKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      (document.activeElement === reportItem ? broadcastItem : reportItem).focus();
    }
  }

  /** Broadcast about the selected open incident, if any (as the action bar does). */
  function selectedOpenIncidentId() {
    const state = store.getState();
    const inc = state.selectedId ? state.incidents[state.selectedId] : null;
    return inc && isOpenIncident(inc) ? inc.incident_id : null;
  }

  reportItem.addEventListener("click", () => {
    closeMenu(false);
    document.dispatchEvent(new CustomEvent(OP_REPORT_EVENT, { detail: { anchor: btn } }));
  });
  broadcastItem.addEventListener("click", () => {
    closeMenu(false);
    document.dispatchEvent(
      new CustomEvent(OP_BROADCAST_EVENT, { detail: { incidentId: selectedOpenIncidentId() } }),
    );
  });

  function toggleMenu() {
    if (isMenuOpen()) closeMenu();
    else openMenu();
  }

  btn.addEventListener("click", () => toggleMenu());

  window.addEventListener("keydown", (e) => {
    if (e.key !== "i" && e.key !== "I") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!document.body.classList.contains("route-live")) return;
    const tag = e.target?.tagName;
    if (tag && ["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
    if (e.target?.isContentEditable) return;
    // Not while a dialog or popover owns the keyboard.
    if (e.target?.closest?.('[role="dialog"]')) return;
    e.preventDefault();
    toggleMenu();
  });

  function paintClasses(maxSev) {
    const pulse = btn.classList.contains("assist--pulse");
    btn.className = "assist assist--br";
    if (maxSev === "SEVERE") btn.classList.add("assist--severe");
    else if (maxSev === "MINOR") btn.classList.add("assist--minor");
    if (pulse) btn.classList.add("assist--pulse");
  }

  function render(state) {
    const { n, maxSev } = activeCount(state);
    badge.hidden = n === 0;
    if (n > 0) badge.textContent = String(n);
    paintClasses(maxSev);

    const severe = store.getActiveSevere?.();
    if (severe) {
      const created = Date.parse(severe.created_at || severe.peak_ts || 0);
      if (created && created !== lastSeverePulse) {
        const age = (clockNow() - created) / 1000;
        if (age >= 0 && age < 4) {
          lastSeverePulse = created;
          btn.classList.add("assist--pulse");
          window.setTimeout(() => btn.classList.remove("assist--pulse"), 1800);
        }
      }
    }
  }

  render(store.getState());
  const unsub = store.subscribe(render);

  return {
    isMenuOpen,
    closeMenu,
    destroy() {
      unsub();
      closeMenu(false);
    },
  };
}
