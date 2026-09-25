/** System page — site info, health, cameras. */

import { SITE, CAMERAS } from "../site.js?v=fix7d";
import {
  awaiting,
  formatInt,
  formatMs,
  formatPct,
  cameraLabel,
} from "../format.js?v=fix7d";
import { clear, el, setText } from "../dom.js?v=fix7d";

export function mountSystem(root, store) {
  root.innerHTML = `
    <div class="system-grid">
      <article class="panel">
        <header class="panel__header">
          <h2 class="panel__title">Site</h2>
        </header>
        <div class="panel__body system__body" data-site></div>
      </article>
      <article class="panel">
        <header class="panel__header">
          <h2 class="panel__title">System health</h2>
        </header>
        <div class="panel__body system__body" data-health></div>
      </article>
      <article class="panel system__cams">
        <header class="panel__header">
          <h2 class="panel__title">Cameras</h2>
          <div class="panel__slot"><span class="metric mono" data-cam-n></span></div>
        </header>
        <div class="panel__body system__body" data-cams></div>
      </article>
    </div>
  `;

  const siteEl = root.querySelector("[data-site]");
  const healthEl = root.querySelector("[data-health]");
  const camsEl = root.querySelector("[data-cams]");
  const camN = root.querySelector("[data-cam-n]");

  /** `pending` renders the value as a muted "Pending". */
  function row(label, value, pending = false) {
    const r = el("div", { className: "system__row" });
    r.appendChild(el("span", { className: "system__k", text: label }));
    const v = el("span", {
      className: `system__v metric${pending ? " is-pending" : ""}`,
      text: pending ? awaiting() : value,
    });
    if (value) v.title = value;
    r.appendChild(v);
    return r;
  }

  function render(state) {
    clear(siteEl);
    siteEl.appendChild(row("Name", SITE.name));
    siteEl.appendChild(row("Type", SITE.type));
    siteEl.appendChild(row("Timezone", SITE.timezone));
    siteEl.appendChild(row("Product", "Sentinel"));

    const h = state.health || {};
    clear(healthEl);
    healthEl.appendChild(
      row(
        "Cameras online",
        `${h.cameras_online} / ${h.cameras_total}`,
        h.cameras_online == null,
      ),
    );
    healthEl.appendChild(row("Models", h.models_resident ? "Ready" : "Loading"));
    healthEl.appendChild(row("GPU", formatPct(h.gpu_util), h.gpu_util == null));
    healthEl.appendChild(row("Latency (p95)", formatMs(h.p95_ms), h.p95_ms == null));
    healthEl.appendChild(
      row("Frames analyzed", formatInt(h.frames_screened), h.frames_screened == null),
    );
    healthEl.appendChild(
      row("Frames flagged", formatInt(h.frames_escalated), h.frames_escalated == null),
    );
    // Connection: "Live" / "Reconnecting"; hidden in mock (never "Mock").
    const conn = state.connection?.status;
    if (conn === "LIVE" || conn === "RECONNECTING") {
      healthEl.appendChild(row("Connection", conn === "LIVE" ? "Live" : "Reconnecting"));
    }

    clear(camsEl);
    camsEl.className = "system__cam-grid";
    setText(camN, String(CAMERAS.length));
    for (const cam of CAMERAS) {
      const st = state.cameras[cam.id];
      const online = st ? Boolean(st.online) : false;
      const tracks = Array.isArray(st?.boxes) ? st.boxes.length : 0;
      const r = el("div", { className: "system__cam" });
      r.appendChild(
        el("span", {
          className: `dot ${online ? "dot--ok" : "dot--off"}`,
          attrs: { "aria-hidden": "true" },
        }),
      );
      const label = el("span", {
        className: "system__cam-name",
        text: cameraLabel(cam.id),
      });
      label.title = cameraLabel(cam.id);
      r.appendChild(label);
      r.appendChild(
        el("span", {
          className: "system__cam-meta mono metric",
          text: online ? `Online · ${tracks} in view` : "Offline",
        }),
      );
      camsEl.appendChild(r);
    }
  }

  render(store.getState());
  return store.subscribe(render);
}
