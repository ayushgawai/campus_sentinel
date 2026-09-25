/*
 * Runs before first paint (classic blocking script in <head>, CSP 'self').
 * ?nosplash=1 is a developer skip: hide the static splash before it paints
 * so it never flashes and gets cut off. Everything else lives in main.js.
 */
(function () {
  try {
    if (new URLSearchParams(location.search).get("nosplash") === "1") {
      document.documentElement.classList.add("nosplash");
    }
  } catch (e) {
    /* ignore */
  }
})();
