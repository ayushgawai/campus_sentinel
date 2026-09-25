/** Auto-follow demo recording story for assist/sidebar layout. */

import { navigate } from "../router.js?v=fix7d";
import { findCallIncident } from "./call.js?v=fix7d";

/**
 * When autoFollow is on (Demo control):
 * - Live grid → focus Minor → split when Severe arrives
 * - Open the incidents sidebar on Severe for ~6s
 * - Open the separate call panel beside it on DISPATCHED
 * - On TRACKING, keep both open but switch incidents to Site plan (pursuit
 *   path + live call both visible while the main camera follows the person)
 * - Close both only on RESOLVED/DISMISSED — grid returns 5s later (Fix 2)
 */
export function startAutoFollow(store, sidebarApi, callPanelApi, layoutCtl) {
  let phase = "";
  let severeOpenedAt = null;
  let lastRoutePush = "";

  function go(route) {
    if (lastRoutePush === route) return;
    lastRoutePush = route;
    navigate(route);
  }

  return store.subscribe((state) => {
    if (!state.demo?.autoFollow) {
      const callInc = findCallIncident(state);
      if (callInc?.state === "DISPATCHED" && phase !== "call-panel") {
        phase = "call-panel";
        sidebarApi?.open?.("incidents");
        callPanelApi?.open?.();
      } else if (!callInc) {
        phase = "";
      }
      severeOpenedAt = null;
      lastRoutePush = "";
      return;
    }

    const t = state.demo?.t ?? 0;
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
      if (phase !== "severe-sidebar") {
        phase = "severe-sidebar";
        severeOpenedAt = t;
        sidebarApi?.open?.("incidents", severe.incident_id);
      } else if (severeOpenedAt != null && t - severeOpenedAt >= 6) {
        // keep open until call, or close if still pending past 6s and not yet dispatched
        if (st !== "DISPATCHED") {
          /* hold open a bit longer until dispatch */
        }
      }
    }

    if (st === "DISPATCHED") {
      go("live");
      phase = "call-panel";
      sidebarApi?.open?.("incidents");
      callPanelApi?.open?.();
      layoutCtl?.forceAuto?.();
    } else if (st === "TRACKING") {
      go("live");
      phase = "pursuit";
      sidebarApi?.open?.("map");
      layoutCtl?.forceAuto?.();
    } else if (st === "RESOLVED" || st === "DISMISSED" || (!severe && !callInc)) {
      if (phase && phase !== "done") {
        phase = "done";
        sidebarApi?.close?.();
        layoutCtl?.forceAuto?.();
      }
    }
  });
}
