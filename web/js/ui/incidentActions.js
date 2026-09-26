/**
 * The one incident action layout, used everywhere an incident can be acted
 * on (Live focus card and detail, expanded list rows, Incidents page):
 *   [status row when dispatched] [server note]
 *   row 1: Call for help (Confirm once dispatched), full width, primary
 *   row 2: Broadcast | Dismiss
 *   row 3: Confirm, full width (before dispatch only)
 * Same handlers and events as the operator action bar.
 */

import { el } from "../dom.js?v=pro4";
import { now } from "../clock.js?v=pro4";
import { isDispatchedOrLater } from "../actions.js?v=pro4";
import { OP_BROADCAST_EVENT, OP_CALL_EVENT, dispatchedText, opButton } from "./operator.js?v=pro4";

function actionBtn({ text, iconName, cls, onClick, disabled, key }) {
  const b = opButton({
    className: `btn lp-act ${cls}`,
    iconName,
    text,
    attrs: { "data-focus-key": key },
    onClick,
  });
  b.disabled = Boolean(disabled);
  return b;
}

/**
 * @param {object} inc open incident
 * @param {object} actions store actions (getOpStatus, confirm)
 * @param {object} store
 */
export function incidentActions(inc, actions, store) {
  const id = inc.incident_id;
  const dispatchSt = actions.getOpStatus("dispatch", id);
  const broadcastSt = actions.getOpStatus("broadcast", id);
  const confirmSt = actions.getOpStatus("confirm", id);
  const dismissSt = actions.getOpStatus("dismiss", id);
  const dispatched = isDispatchedOrLater(inc);
  const box = el("div", { className: "lp-actions" });

  if (dispatched) {
    const st = el("p", { className: "lp-actions__status", attrs: { role: "status" } });
    st.appendChild(el("span", { className: "lp-actions__dot", attrs: { "aria-hidden": "true" } }));
    st.appendChild(
      el("span", {
        className: "mono",
        dataset: { opDispatched: id },
        text: dispatchedText(inc, store.getState(), now()),
      }),
    );
    box.appendChild(st);
  }
  let note = "";
  for (const st of [dispatchSt, broadcastSt, confirmSt, dismissSt]) {
    if (st?.state === "unconfirmed") note = "Pending server confirmation";
    if (st?.state === "declined") note = `Declined by server: ${st.message || "request refused"}`;
  }
  if (note) box.appendChild(el("p", { className: "lp-actions__note", text: note, attrs: { role: "status" } }));

  const confirm = () =>
    actionBtn({
      text: confirmSt?.state === "pending" ? "Confirming…" : "Confirm",
      iconName: "check",
      cls: dispatched ? "lp-act--primary" : "lp-act--secondary",
      key: "confirm",
      disabled: confirmSt?.state === "pending",
      onClick: () => actions.confirm(id),
    });
  // Row 1: the primary action, full width.
  const row1 = el("div", { className: "lp-actions__row lp-actions__row--one" });
  if (dispatched) {
    row1.appendChild(confirm());
  } else {
    const pending = dispatchSt?.state === "pending";
    row1.appendChild(
      actionBtn({
        text: pending ? "Calling…" : "Call for help",
        iconName: "phone",
        cls: "lp-act--primary",
        key: "call",
        disabled: pending,
        onClick: () =>
          document.dispatchEvent(new CustomEvent(OP_CALL_EVENT, { detail: { incidentId: id } })),
      }),
    );
  }
  box.appendChild(row1);
  // Row 2: Broadcast | Dismiss.
  const row2 = el("div", { className: "lp-actions__row" });
  row2.appendChild(
    actionBtn({
      text: "Broadcast",
      iconName: "megaphone",
      cls: "lp-act--secondary",
      key: "broadcast",
      disabled: broadcastSt?.state === "pending",
      onClick: () =>
        document.dispatchEvent(new CustomEvent(OP_BROADCAST_EVENT, { detail: { incidentId: id } })),
    }),
  );
  row2.appendChild(
    actionBtn({
      text: dismissSt?.state === "pending" ? "Dismissing…" : "Dismiss",
      iconName: "close",
      cls: "lp-act--danger",
      key: "dismiss",
      disabled: dismissSt?.state === "pending",
      onClick: () =>
        document.dispatchEvent(new CustomEvent("sentinel:dismiss", { detail: { incidentId: id } })),
    }),
  );
  box.appendChild(row2);
  // Before dispatch, Confirm stays available on its own row.
  if (!dispatched) {
    const row3 = el("div", { className: "lp-actions__row lp-actions__row--one" });
    row3.appendChild(confirm());
    box.appendChild(row3);
  }
  return box;
}
