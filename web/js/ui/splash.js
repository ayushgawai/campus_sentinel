/**
 * Branded splash. The markup is static in index.html and the reveal is pure
 * CSS (app.css "Splash / intro"), so it starts on first paint, before any
 * JS: logo in, colour sweep over SENTINEL, tagline, Pearl Aqua progress
 * line. It always plays (?nosplash=1 is ignored).
 * This module only times the exit (5.4 s after first paint, then a 0.6 s
 * fade = 6 s total, and never before the app is mounted underneath) and
 * handles skip (click, Space, Enter, Esc).
 */

const EXIT_AT_MS = 5400;
const FADE_MS = 600;
const REDUCED_HOLD_MS = 1500;
const REDUCED_FADE_MS = 350;
const SKIP_ARM_MS = 600;

function prefersReducedMotion() {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function nosplashRequested() {
  // The splash always plays, even on links that carry ?nosplash=1.
  return false;
}

/**
 * Time the splash exit. Measured from first paint, when its CSS started.
 * @param {{ root?: HTMLElement|null, appEl?: HTMLElement|null, ready?: Promise<unknown> }} [opts]
 * @returns {Promise<void>} resolves once the splash has faded out
 */
export function playSplash(opts = {}) {
  const appEl = opts.appEl || document.getElementById("app");
  const root = opts.root || document.getElementById("splash");
  const ready = Promise.resolve(opts.ready);

  if (nosplashRequested()) {
    if (root) root.remove();
    document.body.classList.remove("has-splash");
    document.body.classList.add("splash-done");
    appEl?.classList.add("is-ready");
    return Promise.resolve();
  }

  if (!root) {
    document.body.classList.remove("has-splash");
    appEl?.classList.add("is-ready");
    return Promise.resolve();
  }
  // The static splash's CSS animations begin at first paint.
  const startedAt = performance.getEntriesByType?.("paint")?.[0]?.startTime ?? 0;

  document.body.classList.add("has-splash");
  document.body.classList.remove("splash-done");
  appEl?.classList.remove("is-ready", "splash-reveal");

  const reduced = prefersReducedMotion();
  const holdMs = reduced ? REDUCED_HOLD_MS : EXIT_AT_MS;
  const fadeMs = reduced ? REDUCED_FADE_MS : FADE_MS;
  const exitIn = Math.max(0, startedAt + holdMs - performance.now());
  const armedAt = performance.now() + SKIP_ARM_MS;

  return new Promise((resolve) => {
    let settled = false;
    let exitTimer = 0;

    function cleanupListeners() {
      root.removeEventListener("click", onSkip);
      window.removeEventListener("keydown", onSkip, true);
    }

    function finish() {
      if (settled) return;
      settled = true;
      cleanupListeners();
      if (exitTimer) window.clearTimeout(exitTimer);
      // Never fade into an empty page: wait until the app is mounted.
      ready.then(fadeOut, fadeOut);
    }

    function fadeOut() {
      root.classList.add("is-leaving");
      appEl?.classList.add("splash-reveal");

      window.setTimeout(() => {
        root.remove();
        document.body.classList.remove("has-splash");
        document.body.classList.add("splash-done");
        appEl?.classList.remove("splash-reveal");
        appEl?.classList.add("is-ready");
        const main = document.getElementById("main");
        if (main) {
          try {
            main.focus({ preventScroll: true });
          } catch {
            main.focus();
          }
        }
        resolve();
      }, fadeMs);
    }

    function onSkip(e) {
      if (e.type === "keydown") {
        const k = e.key;
        if (k !== " " && k !== "Enter" && k !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
      }
      if (performance.now() < armedAt) return;
      finish();
    }

    root.addEventListener("click", onSkip);
    window.addEventListener("keydown", onSkip, true);
    exitTimer = window.setTimeout(finish, exitIn);
  });
}

/** True when splash should hold mock playback. */
export function shouldHoldMockForSplash() {
  return !nosplashRequested();
}
