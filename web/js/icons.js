/** Inline 16px stroke icons, same drawing style as the camera upload icon. */

import { svgEl } from "./dom.js?v=pro3";

const PATHS = {
  flag: "M4 14V2.5M4 3h7.5l-1.6 2.7L11.5 8.5H4",
  phone:
    "M5.2 2.5 3.4 2.6c-.6 0-1 .6-.9 1.2.6 4.9 4.5 8.9 9.5 9.6.6.1 1.2-.4 1.2-1l.1-1.8-2.6-1.1-1.3 1.3c-1.6-.8-2.9-2.1-3.7-3.7L7 5.8Z",
  megaphone: "M2.5 6.5v3h2l5 3v-9l-5 3h-2ZM11.5 6a2.5 2.5 0 0 1 0 4M5 9.5l1 3.5",
  check: "M3.5 8.5 6.5 11.5 12.5 4.5",
  chevron: "M4.5 6 8 9.5 11.5 6",
  shield: "M8 1.5 13 3.5v4c0 3.2-2.2 5.6-5 7-2.8-1.4-5-3.8-5-7v-4Z",
  close: "M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5",
  camera: "M2.5 5.5h7.5v6H2.5ZM10 7.5l3.5-2v6l-3.5-2",
  expand: "M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9",
  grid: "M2.5 2.5h4.5v4.5H2.5ZM9 2.5h4.5v4.5H9ZM2.5 9h4.5v4.5H2.5ZM9 9h4.5v4.5H9Z",
  info: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM8 7.2v4.3M8 4.6v.3",
};

/** @param {"flag"|"phone"|"megaphone"|"check"|"close"|"camera"} name */
export function icon(name) {
  const svg = svgEl("svg", {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    "aria-hidden": "true",
    focusable: "false",
    class: "icon",
  });
  svg.appendChild(
    svgEl("path", {
      d: PATHS[name],
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.4",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  );
  return svg;
}
