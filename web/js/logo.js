/** Shared Sentinel SC shield mark. */

/** Carbon mark for light surfaces (white header, splash). */
export const LOGO_MARK = `<img class="logo-mark" src="./assets/logo.png" width="28" height="28" alt="" decoding="async" />`;

/** Light mark for dark surfaces (assist). */
export const LOGO_MARK_INVERSE = `<img class="logo-mark logo-mark--inverse" src="./assets/logo-inverse.png" width="28" height="28" alt="" decoding="async" />`;


/** Inline SVG fallback using image href — prefer LOGO_MARK. */
export const LOGO_SVG_INLINE = `<svg class="logo-mark" viewBox="0 0 64 64" width="28" height="28" aria-hidden="true" focusable="false">
  <image href="./assets/logo.png" width="64" height="64" preserveAspectRatio="xMidYMid meet"/>
</svg>`;
