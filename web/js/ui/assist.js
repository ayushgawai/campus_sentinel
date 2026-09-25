/**
 * Assist button — bottom-right. Hides while the sidebar is open;
 * returns when the sidebar is closed.
 */

import { now as clockNow } from "../clock.js";
import { isOpenIncident } from "../format.js";
import { OPEN_SIDEBAR_EVENT, MORE_INCIDENTS_EVENT } from "./cameras.js";
import { LOGO_MARK_INVERSE } from "../logo.js";

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

export function mountAssist(root, store, sidebarApi) {
  if (!root) return () => {};

  root.innerHTML = `
    <button type="button" class="assist assist--br" id="assist-btn"
      aria-label="Open incident panel" aria-expanded="false" aria-controls="sidebar">
      <span class="assist__mark">${LOGO_MARK_INVERSE}</span>
      <span class="assist__badge" data-badge hidden>0</span>
    </button>
  `;
  const btn = root.querySelector(".assist");
  const badge = root.querySelector("[data-badge]");
  let lastSeverePulse = 0;

  function paintClasses(maxSev) {
    const pulse = btn.classList.contains("assist--pulse");
    btn.className = "assist assist--br";
    if (maxSev === "SEVERE") btn.classList.add("assist--severe");
    else if (maxSev === "MINOR") btn.classList.add("assist--minor");
    if (pulse) btn.classList.add("assist--pulse");
  }

  function setVisible(show) {
    root.hidden = !show;
    btn.hidden = !show;
    root.setAttribute("aria-hidden", show ? "false" : "true");
  }

  function toggle() {
    if (sidebarApi.isOpen()) {
      sidebarApi.close();
    } else {
      setVisible(false);
      sidebarApi.open("incidents");
    }
  }

  btn.addEventListener("click", () => toggle());

  window.addEventListener("keydown", (e) => {
    if (e.key !== "i" && e.key !== "I") return;
    const tag = e.target?.tagName;
    if (tag && ["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
    e.preventDefault();
    toggle();
  });

  document.addEventListener(OPEN_SIDEBAR_EVENT, (e) => {
    setVisible(false);
    sidebarApi.open(e.detail?.tab || "incidents", e.detail?.incidentId);
  });
  document.addEventListener(MORE_INCIDENTS_EVENT, () => {
    setVisible(false);
    sidebarApi.open("incidents");
  });

  function render(state) {
    const { n, maxSev } = activeCount(state);
    const open = sidebarApi.isOpen();

    setVisible(!open);

    badge.hidden = n === 0 || open;
    if (n > 0) badge.textContent = String(n);

    paintClasses(maxSev);

    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.setAttribute(
      "aria-label",
      open ? "Close incident panel" : "Open incident panel",
    );

    if (open) return;

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
  const onSide = () => render(store.getState());
  document.addEventListener("sentinel:sidebar", onSide);

  return () => {
    unsub();
    document.removeEventListener("sentinel:sidebar", onSide);
  };
}
