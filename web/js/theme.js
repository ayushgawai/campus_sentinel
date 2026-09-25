/** Read CSS custom properties from :root for canvas / SVG painting. */

let cache = null;

function rootStyle() {
  return getComputedStyle(document.documentElement);
}

/** @param {string} name token without leading dashes, e.g. "aqua" */
export function token(name, fallback = "") {
  const v = rootStyle().getPropertyValue(`--${name}`).trim();
  return v || fallback;
}

/** Snapshot of colours used by drawing code. Refreshed on demand. */
export function themeColors() {
  if (cache) return cache;
  const t = token;
  cache = {
    bg: t("bg", "#222222"),
    bgDeep: t("bg-deep", "#1a1a1c"),
    surface1: t("surface-1", "#2a2a30"),
    surface2: t("surface-2", "#33344a"),
    surface3: t("surface-3", "#3e4059"),
    grape: t("grape", "#4b4e6d"),
    border: t("border", "rgba(149,163,179,0.16)"),
    borderStrong: t("border-strong", "rgba(149,163,179,0.28)"),
    steel20: t("steel-20", "rgba(149,163,179,0.2)"),
    steel35: t("steel-35", "rgba(149,163,179,0.35)"),
    steel40: t("steel-40", "rgba(149,163,179,0.4)"),
    text: t("text", "#ffffff"),
    textBody: t("text-body", "rgba(255,255,255,0.88)"),
    textMuted: t("text-muted", "#95a3b3"),
    textFaint: t("text-faint", "#a3b0be"),
    aqua: t("aqua", "#84dcc6"),
    aquaStrong: t("aqua-strong", "#a6e8d7"),
    aquaBg: t("aqua-bg", "rgba(132,220,198,0.12)"),
    aquaBorder: t("aqua-border", "rgba(132,220,198,0.35)"),
    onAqua: t("on-aqua", "#222222"),
    ok: t("ok", "#84dcc6"),
    okBg: t("ok-bg", "rgba(132,220,198,0.14)"),
    okBorder: t("ok-border", "rgba(132,220,198,0.35)"),
    info: t("info", "#9db8d9"),
    infoBg: t("info-bg", "rgba(157,184,217,0.14)"),
    infoBorder: t("info-border", "rgba(157,184,217,0.35)"),
    minor: t("minor", "#e8b86d"),
    minorBg: t("minor-bg", "rgba(232,184,109,0.14)"),
    minorBorder: t("minor-border", "rgba(232,184,109,0.35)"),
    severe: t("severe", "#e5646e"),
    severeBg: t("severe-bg", "rgba(229,100,110,0.14)"),
    severeBorder: t("severe-border", "rgba(229,100,110,0.35)"),
    dispatch: t("dispatch", "#a7abd9"),
    dispatchBg: t("dispatch-bg", "rgba(167,171,217,0.14)"),
    dispatchBorder: t("dispatch-border", "rgba(167,171,217,0.35)"),
    scrim: t("scrim", "rgba(26,26,28,0.72)"),
    scrimStrong: t("scrim-strong", "rgba(26,26,28,0.85)"),
    wellTint: t("well-tint", "rgba(26,26,28,0.35)"),
    feedWell: t("feed-well", "#1a1a1c"),
    shadow: t("shadow", "0 10px 30px rgba(0,0,0,0.35)"),
  };
  return cache;
}

/** Clear cache (e.g. after hot-swapping tokens.css). */
export function invalidateTheme() {
  cache = null;
}
