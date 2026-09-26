/** Auto-follow demo recording story for assist/sidebar layout. */

import { navigate } from "../router.js?v=pro4";
import { findCallIncident } from "./call.js?v=pro4";

/**
 * When autoFollow is on (Demo control): stay on Live through the severe
 * story, select the severe incident, and keep the camera layout on auto
 * (focus follows plan(); grid returns 5 s after RESOLVED/DISMISSED).
 * It no longer opens or closes panels: the Live page shows incidents, map
 * and call in its own columns whenever plan() has a main camera.
 * `sidebarApi` and `callPanelApi` are kept in the signature for callers.
 */
export function startAutoFollow(store, sidebarApi, callPanelApi, layoutCtl) {
  let phase = "";
  let lastRoutePush = "";

  function go(route) {
    if (lastRoutePush === route) return;
    lastRoutePush = route;
    navigate(route);
  }

  return store.subscribe((state) => {
    if (!state.demo?.autoFollow) {
      phase = "";
      lastRoutePush = "";
      return;
    }

    const severe = store.getActiveSevere?.();
    const callInc = findCallIncident(state);
    const st = callInc?.state || severe?.state || null;

    // Ensure live during pre-call story
    if (!callInc || st === "TRACKING" || st === "ALERTED" || st === "DISPATCH_PENDING" || st === "NEW") {
      go("live");
    }

    if (severe && (st === "NEW" || st === "ALERTED" || st === "DISPATCH_PENDING")) {
      if (severe.incident_id !== state.selectedId) {
        store.setSelected(severe.incident_id);
      }
      layoutCtl?.forceAuto?.();
      phase = "severe";
    }

    if (st === "DISPATCHED") {
      go("live");
      phase = "call";
      layoutCtl?.forceAuto?.();
    } else if (st === "TRACKING") {
      go("live");
      phase = "pursuit";
      layoutCtl?.forceAuto?.();
    } else if (st === "RESOLVED" || st === "DISMISSED" || (!severe && !callInc)) {
      if (phase && phase !== "done") {
        phase = "done";
        layoutCtl?.forceAuto?.();
      }
    }
  });
}
