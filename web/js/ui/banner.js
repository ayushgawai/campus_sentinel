/**
 * Severe banner — notifies when a severe incident is on a camera
 * you are not currently viewing as main. Hidden while that camera
 * is already in the live main view (or full grid).
 */

import {
  classLabel,
  cameraLabel,
  severityLabel,
  stateLabel,
} from "../format.js?v=fix7d";
import { clear, el } from "../dom.js?v=fix7d";

/**
 * @param {HTMLElement} root
 * @param {object} store
 * @param {object} actions
 * @param {object} [layoutCtl]
 */
export function mountBanner(root, store, actions, layoutCtl) {
  function isViewingIncidentCamera(inc, state) {
    const layout = layoutCtl || window.__cameraLayout;
    if (!layout?.plan) return false;
    if ((state.route || "live") !== "live") return false;
    const plan = layout.plan(state);
    // Full grid: every camera is on screen — no off-camera notify.
    if (plan.mode === "grid") return true;
    return plan.mains.some((m) => m.cameraId === inc.camera_id);
  }

  function render() {
    const state = store.getState();
    const inc = store.getActiveSevere?.() || null;

    if (!inc || isViewingIncidentCamera(inc, state)) {
      root.hidden = true;
      clear(root);
      document.body.classList.remove("has-banner");
      return;
    }

    document.body.classList.add("has-banner");
    root.hidden = false;
    clear(root);
    root.className = "severe-banner";

    root.appendChild(
      el("span", {
        className: "banner__mark",
        attrs: { "aria-hidden": "true" },
      }),
    );
    const body = el("div", { className: "banner__body" });
    body.appendChild(
      el("strong", {
        className: "banner__title",
        text: `${severityLabel(inc.severity)} · ${classLabel(inc.class_token)}`,
      }),
    );
    body.appendChild(
      el("span", {
        className: "banner__meta",
        text: `${cameraLabel(inc.camera_id)} · ${stateLabel(inc.state)}`,
      }),
    );
    root.appendChild(body);
    root.appendChild(
      el("button", {
        type: "button",
        className: "btn btn--primary banner__btn",
        text: "Open incident",
        onClick: () => {
          actions.viewIncident(inc.incident_id);
          const layout = layoutCtl || window.__cameraLayout;
          if (inc.camera_id && layout?.soloMain) {
            layout.soloMain(inc.camera_id);
          } else if (inc.camera_id && layout?.swapMain) {
            layout.swapMain(inc.camera_id);
          }
        },
      }),
    );
  }

  render();
  const unsubStore = store.subscribe(render);
  const unsubLayout =
    typeof layoutCtl?.subscribe === "function"
      ? layoutCtl.subscribe(render)
      : () => {};

  return () => {
    unsubStore();
    unsubLayout();
  };
}
