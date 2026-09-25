/** Auto-follow demo recording story for assist/sidebar layout. */

import { navigate } from "../router.js";
import { findCallIncident } from "./call.js";

/**
 * When autoFollow is on (Demo control):
 * - Live grid → focus Minor → split when Severe arrives
 * - Open sidebar on Severe for ~6s
 * - Call tab during DISPATCHED
 * - Close sidebar on TRACKING (pursuit visible)
 * - Stay on Live after resolve → grid
 */
export function startAutoFollow(store, sidebarApi, layoutCtl) {
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
      if (callInc?.state === "DISPATCHED" && phase !== "call-sidebar") {
        phase = "call-sidebar";
        sidebarApi?.open?.("call");
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
      phase = "call-tab";
      sidebarApi?.open?.("call");
      layoutCtl?.forceAuto?.();
    } else if (st === "TRACKING") {
      go("live");
      phase = "pursuit";
      sidebarApi?.close?.();
      layoutCtl?.forceAuto?.();
    } else if (!severe && !callInc) {
      if (phase && phase !== "done") {
        phase = "done";
        sidebarApi?.close?.();
        layoutCtl?.forceAuto?.();
      }
    }
  });
}
