/** User actions — single place to wire REST / demo control later. */

import { atIso } from "./mock.js";
import { navigate } from "./router.js";
import * as cameraSources from "./cameraSources.js";

export const DISMISS_REASONS = [
  { id: "false_alarm", label: "False alarm" },
  { id: "authorised", label: "Authorised activity" },
  { id: "other", label: "Other" },
];

/**
 * @param {{
 *   store: { handle: Function, getState: Function, setSelected: Function },
 *   getMode: () => string,
 *   transport?: object,
 * }} opts
 */
export function createActions({ store, getMode, transport }) {
  function nowIso() {
    const t = store.getState().demo?.t ?? 0;
    return atIso(t);
  }

  function confirm(id) {
    if (getMode() === "WS") {
      console.info("REST endpoint pending", { action: "confirm", id });
      return;
    }
    store.handle({
      type: "incident.state_change",
      incident_id: id,
      state: "RESOLVED",
      severity: null,
      ts: nowIso(),
      note: "Officer confirmed",
    });
  }

  function dismiss(id, reason = "Officer dismissed") {
    if (getMode() === "WS") {
      console.info("REST endpoint pending", { action: "dismiss", id, reason });
      return;
    }
    store.handle({
      type: "incident.state_change",
      incident_id: id,
      state: "DISMISSED",
      severity: null,
      ts: nowIso(),
      note: reason,
    });
  }

  function select(id) {
    store.setSelected(id);
  }

  function clearSelection() {
    store.setSelected(null);
  }

  function viewIncident(id) {
    store.setSelected(id);
    navigate("live");
  }

  function demoReset() {
    transport?.resetDemo?.();
    cameraSources.restartAll();
  }

  function demoScenario(id) {
    transport?.setScenario?.(id);
    cameraSources.restartAll();
  }

  function demoPrewarm() {
    transport?.prewarm?.();
  }

  function demoPlay() {
    transport?.play?.();
    cameraSources.playAll();
  }

  function demoPause() {
    transport?.pause?.();
    cameraSources.pauseAll();
  }

  function demoSpeed(s) {
    transport?.setSpeed?.(s);
    cameraSources.setPlaybackRate(s);
  }

  function demoSeek(t) {
    transport?.seek?.(t);
    cameraSources.seekAllToDemoT(t);
  }

  return {
    confirm,
    dismiss,
    select,
    clearSelection,
    viewIncident,
    demoReset,
    demoScenario,
    demoPrewarm,
    demoPlay,
    demoPause,
    demoSpeed,
    demoSeek,
  };
}
