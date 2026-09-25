/** Compact active-call card on Live Operations. */

import { DEMO_EPOCH_MS } from "../mock.js";
import {
  classLabel,
  cameraLabel,
  textOr,
  notReported,
} from "../format.js";
import { redactPlaces } from "../site.js";
import { clear, el, setText } from "../dom.js";
import { findCallIncident } from "./call.js";
import { navigate } from "../router.js";

function demoNowMs(state) {
  return DEMO_EPOCH_MS + (state.demo?.t ?? 0) * 1000;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatTimer(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}`;
}

function lastLine(state, incidentId) {
  const lines = (state.call?.transcript || []).filter(
    (t) => t.incident_id === incidentId,
  );
  if (!lines.length) return "Call connected";
  return textOr(lines[lines.length - 1].text, "Call connected");
}

export function mountCallCard(root, store) {
  function render(state) {
    const inc = findCallIncident(state);
    if (!inc) {
      root.hidden = true;
      clear(root);
      return;
    }
    root.hidden = false;
    clear(root);

    const card = el("article", { className: "panel call-card" });
    const head = el("div", { className: "call-card__head" });
    head.appendChild(
      el("span", {
        className: "call-card__title",
        text: `${classLabel(inc.class_token)} call`,
      }),
    );
    head.appendChild(el("span", { className: "sim-tag", text: "SIMULATED" }));

    const timer = el("span", {
      className: "call-card__timer mono metric",
      dataset: { timer: "" },
    });
    const dts = state.call?.dispatchedAt;
    if (dts) {
      setText(timer, formatTimer(demoNowMs(state) - Date.parse(dts)));
    } else {
      setText(timer, "00:00");
    }
    head.appendChild(timer);

    const line = el("p", {
      className: "call-card__line",
      text: redactPlaces(lastLine(state, inc.incident_id)),
    });
    line.title = redactPlaces(lastLine(state, inc.incident_id));

    const meta = el("p", {
      className: "call-card__meta",
      text: cameraLabel(inc.camera_id),
    });

    const btn = el("button", {
      type: "button",
      className: "btn btn--ghost",
      text: "Open call console",
      onClick: () => navigate("call"),
    });

    card.appendChild(head);
    card.appendChild(meta);
    card.appendChild(line);
    card.appendChild(btn);
    root.appendChild(card);
  }

  render(store.getState());
  const unsub = store.subscribe(render);
  const tick = window.setInterval(() => render(store.getState()), 1000);
  return () => {
    unsub();
    window.clearInterval(tick);
  };
}
