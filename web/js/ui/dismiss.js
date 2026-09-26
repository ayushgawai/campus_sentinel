/** Dismiss reason dialog — preset options. */

import { DISMISS_REASONS } from "../actions.js?v=pro4";
import { clear, el, setText } from "../dom.js?v=pro4";

export function mountDismiss(root, store, actions) {
  let pendingId = null;

  function close() {
    pendingId = null;
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    clear(root);
  }

  function open(id) {
    pendingId = id;
    root.hidden = false;
    root.setAttribute("aria-hidden", "false");
    clear(root);

    const panel = el("article", {
      className: "panel dismiss",
      attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Dismiss incident" },
    });
    const header = el("header", { className: "panel__header" }, [
      el("h2", { className: "panel__title", text: "Dismiss incident" }),
      el("button", {
        type: "button",
        className: "btn btn--secondary",
        text: "Cancel",
        onClick: close,
      }),
    ]);
    const body = el("div", { className: "panel__body dismiss__body" }, [
      el("p", {
        className: "dismiss__lead",
        text: "Choose a reason. This is recorded on the incident timeline.",
      }),
    ]);
    const list = el("div", { className: "dismiss__list" });
    for (const reason of DISMISS_REASONS) {
      list.appendChild(
        el("button", {
          type: "button",
          className: "btn btn--secondary dismiss__opt",
          text: reason.label,
          onClick: () => {
            if (!pendingId) return;
            actions.dismiss(pendingId, reason.label);
            actions.clearSelection();
            close();
          },
        }),
      );
    }
    body.appendChild(list);
    panel.appendChild(header);
    panel.appendChild(body);
    root.appendChild(panel);
    root.className = "dismiss-overlay is-open";
  }

  root._dismissApi = {
    open,
    close,
    isOpen: () => Boolean(pendingId),
  };

  // Allow detail / incidents to request dismiss via custom event
  document.addEventListener("sentinel:dismiss", (e) => {
    const id = e.detail?.incidentId;
    if (id) open(id);
  });

  close();
  return () => {};
}
