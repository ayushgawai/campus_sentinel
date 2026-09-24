/* Inline SVG icons — static strings, stroke follows currentColor.
 * Used only via the `html` prop on elements this code owns. */

const wrap = (body, opts = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${opts}>${body}</svg>`;

export const icons = {
  shield: wrap('<path d="M12 3l7 3v5.5c0 4.3-2.9 7.6-7 8.5-4.1-.9-7-4.2-7-8.5V6l7-3z"/><path d="M9.2 12.2l2 2 3.6-3.9"/>'),

  signal: wrap('<path d="M4.5 8.5a9 9 0 0 1 15 0"/><path d="M7.5 11.5a5.5 5.5 0 0 1 9 0"/><circle cx="12" cy="15.5" r="1.4"/>'),

  bell: wrap('<path d="M18 15.5V11a6 6 0 1 0-12 0v4.5L4.5 18h15L18 15.5z"/><path d="M9.8 18a2.3 2.3 0 0 0 4.4 0"/>'),

  camera: wrap('<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 10.8l5-2.4v7.2l-5-2.4z"/>'),

  chip: wrap('<rect x="7" y="7" width="10" height="10" rx="1.6"/><path d="M10 3v2M14 3v2M10 19v2M14 19v2M3 10h2M3 14h2M19 10h2M19 14h2"/>'),

  gauge: wrap('<path d="M4.5 16.5a8.5 8.5 0 1 1 15 0"/><path d="M12 12.5l3.5-3"/>'),

  activity: wrap('<path d="M3 12.5h3.6l2.2-6 3.4 11 2.4-7 1.6 2h4.8"/>'),

  scan: wrap('<path d="M4 9V6.5A2.5 2.5 0 0 1 6.5 4H9M15 4h2.5A2.5 2.5 0 0 1 20 6.5V9M20 15v2.5a2.5 2.5 0 0 1-2.5 2.5H15M9 20H6.5A2.5 2.5 0 0 1 4 17.5V15"/><path d="M4 12h16"/>'),

  bolt: wrap('<path d="M13.5 3L6 13.5h4.5L10 21l7.5-10.5H13l.5-7.5z"/>'),

  expand: wrap('<path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5"/>'),

  shrink: wrap('<path d="M9 4v5H4M15 4v5h5M15 20v-5h5M9 20v-5H4"/>'),

  pause: wrap('<path d="M9.5 5v14M14.5 5v14"/>'),

  play: wrap('<path d="M7 4.8v14.4L19 12 7 4.8z"/>'),

  reset: wrap('<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4.5V10h5.2"/>'),

  check: wrap('<path d="M5 12.8l4.2 4.2L19 7.4"/>'),

  alert: wrap('<path d="M12 4.5l8.5 15H3.5L12 4.5z"/><path d="M12 10v4"/><circle cx="12" cy="16.6" r=".9" fill="currentColor" stroke="none"/>'),

  pin: wrap('<path d="M12 21s6.5-6.1 6.5-10.5A6.5 6.5 0 0 0 5.5 10.5C5.5 14.9 12 21 12 21z"/><circle cx="12" cy="10.3" r="2.3"/>'),

  grid: wrap('<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>'),
};
