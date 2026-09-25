/** Hash router — no reloads; state stays in the store. */

export const ROUTES = [
  { id: "live", path: "#/live", label: "Live Operations" },
  { id: "incidents", path: "#/incidents", label: "Incidents" },
  { id: "call", path: "#/call", label: "Call Console" },
  { id: "system", path: "#/system", label: "System" },
];

const listeners = new Set();

function normalize(hash) {
  const h = (hash || "").replace(/^#\/?/, "").split("?")[0] || "live";
  if (ROUTES.some((r) => r.id === h)) return h;
  return "live";
}

export function getRoute() {
  return normalize(location.hash);
}

export function navigate(id) {
  const route = ROUTES.find((r) => r.id === id) || ROUTES[0];
  const target = `#/${route.id}`;
  if (location.hash !== target) {
    location.hash = `/${route.id}`;
  }
  notify();
}

function notify() {
  const id = getRoute();
  for (const fn of listeners) fn(id);
}

export function startRouter(onChange) {
  if (onChange) listeners.add(onChange);
  if (!location.hash || location.hash === "#") {
    location.replace("#/live");
  }
  const handler = () => notify();
  window.addEventListener("hashchange", handler);
  notify();
  return () => {
    window.removeEventListener("hashchange", handler);
    if (onChange) listeners.delete(onChange);
  };
}

export function subscribeRoute(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
