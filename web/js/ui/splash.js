/**
 * Branded splash — DiaTextReveal-style color band sweep on SENTINEL,
 * then crossfade into the app.
 */

import { LOGO_MARK } from "../logo.js";

const WORD = "SENTINEL";
const TAGLINE = "Where AI Meets Security.";
const EXIT_AT_MS = 6200;
const REDUCED_HOLD_MS = 2200;
const REDUCED_FADE_MS = 350;
const SKIP_ARM_MS = 600;

/** Magic UI DiaTextReveal demo palette */
const DIA_COLORS = ["#A97CF8", "#F38CB8", "#FDCC92"];
const DIA_DURATION_S = 1.5;
const DIA_DELAY_S = 0.35;
const BAND_HALF = 17;
const SWEEP_START = -BAND_HALF;
const SWEEP_END = 100 + BAND_HALF;

const LOGO_HTML = LOGO_MARK.replace(
  'class="logo-mark"',
  'class="logo-mark splash__logo"',
).replace('width="28" height="28"', 'width="56" height="56"');

function prefersReducedMotion() {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function nosplashRequested() {
  return new URLSearchParams(location.search).get("nosplash") === "1";
}

/** easeInOutCubic — same curve as Magic UI DiaTextReveal */
function sweepEase(t) {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
}

function buildGradient(pos, colors, textColor) {
  const bandStart = pos - BAND_HALF;
  const bandEnd = pos + BAND_HALF;

  if (bandStart >= 100) {
    return `linear-gradient(90deg, ${textColor}, ${textColor})`;
  }

  const n = colors.length;
  const parts = [];

  if (bandStart > 0) {
    parts.push(`${textColor} 0%`, `${textColor} ${bandStart.toFixed(2)}%`);
  }

  colors.forEach((c, i) => {
    const pct = n === 1 ? pos : bandStart + (i / (n - 1)) * BAND_HALF * 2;
    parts.push(`${c} ${pct.toFixed(2)}%`);
  });

  if (bandEnd < 100) {
    parts.push(`transparent ${bandEnd.toFixed(2)}%`, `transparent 100%`);
  }

  return `linear-gradient(90deg, ${parts.join(", ")})`;
}

/**
 * Drive DiaTextReveal sweep on the brand word element.
 * @returns {() => void} cancel
 */
function playDiaReveal(el, { colors, textColor, durationS, delayS }) {
  let raf = 0;
  let cancelled = false;
  const startAt = performance.now() + delayS * 1000;
  const durationMs = durationS * 1000;

  el.style.backgroundImage = buildGradient(SWEEP_START, colors, textColor);

  function frame(now) {
    if (cancelled) return;
    if (now < startAt) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const t = Math.min(1, (now - startAt) / durationMs);
    const pos = SWEEP_START + (SWEEP_END - SWEEP_START) * sweepEase(t);
    el.style.backgroundImage = buildGradient(pos, colors, textColor);
    if (t < 1) {
      raf = requestAnimationFrame(frame);
    } else {
      el.style.backgroundImage = `linear-gradient(90deg, ${textColor}, ${textColor})`;
      el.style.webkitTextFillColor = textColor;
      el.style.color = textColor;
    }
  }

  raf = requestAnimationFrame(frame);

  return () => {
    cancelled = true;
    if (raf) cancelAnimationFrame(raf);
  };
}

/** Build a fresh splash element (for Replay intro). */
export function createSplashElement() {
  const root = document.createElement("div");
  root.id = "splash";
  root.className = "splash";
  root.setAttribute("role", "status");
  root.setAttribute("aria-label", "Sentinel loading");
  root.setAttribute("aria-live", "polite");
  root.innerHTML = `
    <div class="splash__inner">
      ${LOGO_HTML}
      <p class="splash__word" aria-label="SENTINEL">
        <span class="splash__dia">${WORD}</span>
      </p>
      <p class="splash__tagline">${TAGLINE}</p>
      <div class="splash__progress" aria-hidden="true">
        <div class="splash__progress-fill"></div>
      </div>
    </div>
  `;
  return root;
}

/**
 * Play the splash over the already-mounted app.
 * Always restarts so a reload reliably shows the intro.
 * @param {{ root?: HTMLElement|null, appEl?: HTMLElement|null }} [opts]
 * @returns {Promise<void>}
 */
export function playSplash(opts = {}) {
  const appEl = opts.appEl || document.getElementById("app");
  let root = opts.root || document.getElementById("splash");

  if (nosplashRequested()) {
    if (root) root.remove();
    document.body.classList.remove("has-splash");
    document.body.classList.add("splash-done");
    appEl?.classList.add("is-ready");
    return Promise.resolve();
  }

  if (!root) {
    root = createSplashElement();
    document.body.insertBefore(root, document.body.firstChild);
  }

  document.body.classList.add("has-splash");
  document.body.classList.remove("splash-done");
  appEl?.classList.remove("is-ready", "splash-reveal");

  const reduced = prefersReducedMotion();
  if (reduced) root.classList.add("splash--reduced");
  else root.classList.remove("splash--reduced");

  root.classList.remove("is-leaving", "is-playing");
  void root.offsetWidth;
  root.classList.add("is-playing");

  const diaEl = root.querySelector(".splash__dia");
  const ink =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--splash-ink")
      .trim() || "#000000";

  let cancelDia = () => {};
  if (diaEl) {
    diaEl.style.webkitTextFillColor = "transparent";
    diaEl.style.color = "transparent";
    if (reduced) {
      diaEl.style.backgroundImage = "none";
      diaEl.style.webkitTextFillColor = ink;
      diaEl.style.color = ink;
    } else {
      cancelDia = playDiaReveal(diaEl, {
        colors: DIA_COLORS,
        textColor: ink,
        durationS: DIA_DURATION_S,
        delayS: DIA_DELAY_S,
      });
    }
  }

  const armedAt = performance.now() + SKIP_ARM_MS;

  return new Promise((resolve) => {
    let settled = false;
    let exitTimer = 0;
    let doneTimer = 0;

    function cleanupListeners() {
      root.removeEventListener("click", onSkip);
      window.removeEventListener("keydown", onKey, true);
    }

    function finish() {
      if (settled) return;
      settled = true;
      cancelDia();
      cleanupListeners();
      if (exitTimer) window.clearTimeout(exitTimer);
      if (doneTimer) window.clearTimeout(doneTimer);

      root.classList.add("is-leaving");
      appEl?.classList.add("splash-reveal");

      const fadeMs = reduced ? REDUCED_FADE_MS : 700;
      doneTimer = window.setTimeout(() => {
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
      if (performance.now() < armedAt) {
        if (e.type === "keydown") {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (e.type === "keydown") {
        const k = e.key;
        if (k !== " " && k !== "Enter" && k !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
      }
      finish();
    }

    function onKey(e) {
      onSkip(e);
    }

    root.addEventListener("click", onSkip);
    window.addEventListener("keydown", onKey, true);

    if (reduced) {
      exitTimer = window.setTimeout(finish, REDUCED_HOLD_MS);
    } else {
      exitTimer = window.setTimeout(finish, EXIT_AT_MS);
    }
  });
}

/** True when splash should hold mock playback. */
export function shouldHoldMockForSplash() {
  return !nosplashRequested();
}
