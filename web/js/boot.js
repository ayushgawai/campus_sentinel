/*
 * Runs before first paint (classic blocking script in <head>, CSP 'self').
 * ?nosplash=1 used to skip the splash; it is now ignored.
 * Everything else lives in main.js.
 */
(function () {
  try {
    // ?nosplash=1 no longer skips the splash (it always plays).
  } catch (e) {
    /* ignore */
  }
})();
