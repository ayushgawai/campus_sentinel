/**
 * Backend REST route builders. The API base is the ?ws= host over http(s)
 * (ws://host:8080/ws → http://host:8080); ?api= overrides it. Mock mode has
 * no API base and every builder returns null.
 */

function apiBase() {
  if (typeof location === "undefined") return null;
  const params = new URLSearchParams(location.search);
  const raw = params.get("api") || params.get("ws");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === "ws:") url.protocol = "http:";
    if (url.protocol === "wss:") url.protocol = "https:";
    return url.origin;
  } catch {
    return null;
  }
}

const BASE = apiBase();

export const API_TIMEOUT_MS = 5000;

export const routes = {
  manualIncident: () => (BASE ? `${BASE}/api/incidents/manual` : null),
  dispatch: (incidentId) =>
    BASE ? `${BASE}/api/incidents/${encodeURIComponent(incidentId)}/dispatch` : null,
  confirm: (incidentId) =>
    BASE ? `${BASE}/api/incidents/${encodeURIComponent(incidentId)}/confirm` : null,
  dismiss: (incidentId) =>
    BASE ? `${BASE}/api/incidents/${encodeURIComponent(incidentId)}/dismiss` : null,
  broadcast: () => (BASE ? `${BASE}/api/broadcast` : null),
};
