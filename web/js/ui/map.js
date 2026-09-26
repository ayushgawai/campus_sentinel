/**
 * Site map — six cameras, adjacency walkways, pursuit path, predicted ring.
 * ViewBox cropped tightly to camera zones + 24px margin.
 */

import {
  CAMERAS,
  EDGES,
  SITE,
  cameraLabel,
  cameraTitle,
  fromCameraMap,
  getCamera,
  mapMode,
} from "../site.js?v=pro7";
import { FOCUS_CAMERA_EVENT } from "./cameras.js?v=pro7";
import { clear, setText } from "../dom.js?v=pro7";
import { themeColors } from "../theme.js?v=pro7";
import { classLabel, formatElapsedPlus } from "../format.js?v=pro7";
import { subscribeTick } from "../clock.js?v=pro7";
import { cameraStatus } from "../cameraStatus.js?v=pro7";
import { followedIncident, pathHops, secondsSinceStart } from "../tracking.js?v=pro7";

const LEVEL_RANK = { none: 0, minor: 1, severe: 2 };

export { FOCUS_CAMERA_EVENT, fromCameraMap, cameraLabel };

const ZONE_W = 200;
const ZONE_H = 140;
const MARGIN = 24;
const PIN_HIT_R = 16; // 32px tap target
const PIN_DOT_R = 12; // 24px pin
const PIN_NUM_FS = 12;

const MODE = mapMode();
const IMAGE = MODE === "image" ? SITE.map : null;
/** Image mode: the view is cropped to the cameras and paths plus this. */
const IMAGE_MARGIN = 56;

/** Pins for this mode: image pixels, or the schematic plan position. */
function pinsForMode() {
  return CAMERAS.map((c) => {
    const at = IMAGE ? c : c.plan || c;
    return { id: c.id, n: c.n, x: at.x, y: at.y, heading: at.heading };
  });
}

let activePins = pinsForMode();
/** Unique ids for each map instance's SVG defs. */
let mapSeq = 0;
/** Working copy of the walkway bends (?mapedit=1 moves them). */
const activeEdges = EDGES.map((e) => ({ a: e.a, b: e.b, via: e.via.map((p) => p.slice()) }));
const pinById = () => new Map(activePins.map((p) => [p.id, p]));

/** Full polyline for an edge, pin to pin (plan mode: straight). */
function edgePoints(edge, by = pinById()) {
  const pa = by.get(edge.a);
  const pb = by.get(edge.b);
  if (!pa || !pb) return null;
  const via = IMAGE ? edge.via : [];
  return [[pa.x, pa.y], ...via, [pb.x, pb.y]];
}

/**
 * Walkway route between two cameras: the edge polyline (reversed when
 * needed), else chained edges via a shortest hop path, else a straight line.
 */
function routeBetween(fromId, toId) {
  const by = pinById();
  const adj = new Map();
  for (const e of activeEdges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a).push(e.b);
    adj.get(e.b).push(e.a);
  }
  const prev = new Map([[fromId, null]]);
  const queue = [fromId];
  while (queue.length && !prev.has(toId)) {
    const cur = queue.shift();
    for (const nb of adj.get(cur) || []) {
      if (prev.has(nb)) continue;
      prev.set(nb, cur);
      queue.push(nb);
    }
  }
  if (!prev.has(toId)) {
    const a = by.get(fromId);
    const b = by.get(toId);
    return a && b ? [[a.x, a.y], [b.x, b.y]] : null;
  }
  const hops = [];
  for (let at = toId; at != null; at = prev.get(at)) hops.unshift(at);
  const pts = [];
  for (let i = 1; i < hops.length; i++) {
    const e = activeEdges.find(
      (x) => (x.a === hops[i - 1] && x.b === hops[i]) || (x.b === hops[i - 1] && x.a === hops[i]),
    );
    let seg = e ? edgePoints(e, by) : null;
    if (!seg) continue;
    if (e.a !== hops[i - 1]) seg = seg.slice().reverse();
    pts.push(...(pts.length ? seg.slice(1) : seg));
  }
  return pts.length >= 2 ? pts : null;
}

function pointsToD(pts) {
  return pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" ");
}

/** Point halfway along a polyline, and the direction there. */
function polylineMid(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  let left = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len >= left && len > 0) {
      const t = left / len;
      return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, dx: x1 - x0, dy: y1 - y0 };
    }
    left -= len;
  }
  const a = pts[0];
  const b = pts[pts.length - 1];
  return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, dx: b[0] - a[0], dy: b[1] - a[1] };
}

/** Margin around the pins for the "pins" fit (map units). */
const PINS_MARGIN = PIN_HIT_R * 2;

/** Tight crop around the pins only (expanded map: pins far enough apart). */
function pinsViewBox() {
  if (!activePins.length) return IMAGE ? imageViewBox() : planViewBox();
  const xs = activePins.map((p) => p.x);
  const ys = activePins.map((p) => p.y);
  const x = Math.min(...xs) - PINS_MARGIN;
  const y = Math.min(...ys) - PINS_MARGIN;
  return {
    x,
    y,
    w: Math.max(...xs) + PINS_MARGIN - x,
    h: Math.max(...ys) + PINS_MARGIN - y,
  };
}

function computeViewBox(fit = "default", aspect = 0, insetLeft = 0, insetTop = 1) {
  if (fit === "circle") return circleViewBox();
  if (fit === "pins") return pinsViewBox();
  const base = IMAGE ? imageViewBox() : planViewBox();
  if (fit === "rect" && aspect > 0) return aspectViewBox(base, aspect, insetLeft, insetTop);
  return base;
}

/**
 * The site crop widened to the container's aspect (width / height), so a
 * rounded-rectangle map fills without an empty band. An overlay card covers
 * the top-left `insetLeft` × `insetTop` share of the view: the site is
 * placed right of it, and the view is kept inside the image where no pin
 * then falls under the card.
 */
function aspectViewBox(base, aspect, insetLeft = 0, insetTop = 1) {
  const f = Math.min(0.6, Math.max(0, insetLeft));
  let w = base.w / (1 - f);
  let h = base.h;
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  const cx = base.x + base.w / 2;
  let x = cx - f * w - ((1 - f) * w) / 2;
  let y = base.y + base.h / 2 - h / 2;
  if (IMAGE) {
    const iw = Number(IMAGE.width);
    const ih = Number(IMAGE.height);
    // Only shift while the site still clears the inset.
    if (w <= iw) {
      const lo = Math.max(0, base.x + base.w - w);
      const hi = Math.min(iw - w, base.x - f * w);
      if (lo <= hi) x = Math.min(Math.max(x, lo), hi);
      else if (x < 0 || x > iw - w) {
        // No empty band at the side if no pin lands under the card.
        const x0 = x < 0 ? 0 : iw - w;
        const cardR = x0 + f * w + PIN_HIT_R;
        const cardB = y + Math.min(1, insetTop) * h + PIN_HIT_R;
        const covered = activePins.some((p) => p.x < cardR && p.y < cardB);
        if (!covered) x = x0;
      }
    }
    if (h <= ih) y = Math.min(Math.max(y, 0), ih - h);
  }
  return { x, y, w, h };
}

/** Room around the pins inside the round Live watch disc (map units). */
const CIRCLE_MARGIN = 28;

/**
 * Square view whose inscribed circle holds every pin plus a margin: for the
 * round site map in the Live watch ring. In image mode the centre is the one
 * giving the smallest circle that stays inside the image (or, if none does,
 * the least spill), so no empty well shows at the disc edge.
 */
function circleViewBox() {
  if (!activePins.length) return computeViewBox();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of activePins) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const reach = (x, y) =>
    Math.max(...activePins.map((p) => Math.hypot(p.x - x, p.y - y))) + CIRCLE_MARGIN;
  let cx = (minX + maxX) / 2;
  let cy = (minY + maxY) / 2;
  let r = reach(cx, cy);
  if (IMAGE) {
    const iw = Number(IMAGE.width);
    const ih = Number(IMAGE.height);
    const spill = (x, y, rr) =>
      Math.max(0, rr - x) + Math.max(0, x + rr - iw) + Math.max(0, rr - y) + Math.max(0, y + rr - ih);
    // Any spill ranks after every circle that fits inside the image.
    const scoreOf = (x, y, rr) => {
      const out = spill(x, y, rr);
      return out > 0.5 ? 1e6 + out : rr;
    };
    let best = scoreOf(cx, cy, r);
    const step = Math.max(2, (maxX - minX + maxY - minY) / 80);
    for (let x = minX; x <= maxX; x += step) {
      for (let y = minY - (maxY - minY); y <= maxY; y += step) {
        const rr = reach(x, y);
        const score = scoreOf(x, y, rr);
        if (score < best) {
          best = score;
          cx = x;
          cy = y;
          r = rr;
        }
      }
    }
  }
  return { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r };
}

/** Crop to cameras + walkway bends + margin, inside the image. */
function imageViewBox() {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x, y) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  for (const p of activePins) add(p.x, p.y);
  for (const e of activeEdges) for (const [x, y] of e.via) add(x, y);
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: IMAGE.width, h: IMAGE.height };
  const x = Math.max(0, minX - IMAGE_MARGIN);
  const y = Math.max(0, minY - IMAGE_MARGIN);
  const w = Math.min(IMAGE.width, maxX + IMAGE_MARGIN) - x;
  const h = Math.min(IMAGE.height, maxY + IMAGE_MARGIN) - y;
  return { x, y, w, h };
}

function planViewBox() {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of activePins) {
    minX = Math.min(minX, p.x - ZONE_W / 2);
    maxX = Math.max(maxX, p.x + ZONE_W / 2);
    minY = Math.min(minY, p.y - ZONE_H / 2);
    maxY = Math.max(maxY, p.y + ZONE_H / 2);
  }
  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, w: 1000, h: 620 };
  }
  return {
    x: minX - MARGIN,
    y: minY - MARGIN,
    w: maxX - minX + MARGIN * 2,
    h: maxY - minY + MARGIN * 2,
  };
}

/** Incident level via the shared camera status (offline shows none). */
function activeSeverityForCamera(state, cameraId) {
  const st = cameraStatus(state, cameraId);
  return st.inc ? { sev: st.inc.severity, inc: st.inc } : null;
}

function headingOf(pin) {
  if (typeof pin.heading === "number") return pin.heading;
  return 180;
}

function fovWedge(cx, cy, headingDeg, range = 40, spread = 48) {
  const h = ((headingDeg - 90) * Math.PI) / 180;
  const half = ((spread / 2) * Math.PI) / 180;
  const a1 = h - half;
  const a2 = h + half;
  const x1 = cx + Math.cos(a1) * range;
  const y1 = cy + Math.sin(a1) * range;
  const x2 = cx + Math.cos(a2) * range;
  const y2 = cy + Math.sin(a2) * range;
  return `M${cx} ${cy} L${x1.toFixed(1)} ${y1.toFixed(1)} A${range} ${range} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`;
}

function zoneRects() {
  if (IMAGE) return "";
  return activePins
    .map((p) => {
      const x = p.x - ZONE_W / 2;
      const y = p.y - ZONE_H / 2;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${ZONE_W}" height="${ZONE_H}" rx="8" ry="8"/>`;
    })
    .join("");
}

function walkPaths() {
  const by = pinById();
  return activeEdges
    .map((e) => {
      const pts = edgePoints(e, by);
      return pts ? `<path d="${pointsToD(pts)}"/>` : "";
    })
    .join("");
}

/** Image mode: the map image plus a shade so pins and paths stand out. */
function imageMarkup() {
  if (!IMAGE) return "";
  const w = Number(IMAGE.width);
  const h = Number(IMAGE.height);
  return `<image class="cmap__img" href="${IMAGE.src}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none"/>
            <rect class="cmap__shade" x="0" y="0" width="${w}" height="${h}"/>`;
}

function chromeMarkup(vb) {
  const nx = vb.x + 28;
  const ny = vb.y + 28;
  const chrome = "var(--map-chrome, rgba(149,163,179,0.8))";
  // Image mode: the export is north-up but its scale is not known here,
  // so show the north arrow only.
  if (IMAGE) {
    return `
  <g class="cmap__chrome cmap__chrome--image" stroke-width="1.5">
    <g transform="translate(${nx} ${ny})">
      <line x1="0" y1="22" x2="0" y2="0"/>
      <polygon points="0,-2 -5,10 5,10" stroke="none"/>
      <text x="0" y="36" text-anchor="middle" font-size="11" font-family="ui-monospace,monospace" stroke="none">N</text>
    </g>
  </g>
`;
  }
  const sx = vb.x + vb.w - 128;
  const sy = vb.y + vb.h - 36;
  return `
  <g class="cmap__chrome" fill="${chrome}" stroke="${chrome}" stroke-width="1.5">
    <g transform="translate(${nx} ${ny})">
      <line x1="0" y1="22" x2="0" y2="0"/>
      <polygon points="0,-2 -5,10 5,10" fill="${chrome}" stroke="none"/>
      <text x="0" y="36" text-anchor="middle" font-size="11" font-family="ui-monospace,monospace" fill="${chrome}" stroke="none">N</text>
    </g>
    <g transform="translate(${sx} ${sy})">
      <line x1="0" y1="0" x2="100" y2="0"/>
      <line x1="0" y1="-4" x2="0" y2="4"/>
      <line x1="100" y1="-4" x2="100" y2="4"/>
      <text x="50" y="18" text-anchor="middle" font-size="11" font-family="ui-monospace,monospace" fill="${chrome}" stroke="none">50 m</text>
    </g>
  </g>
`;
}

function emitMapEvent(name, detail) {
  document.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * @param {HTMLElement} el
 * @param {object} store
 * @param {object} actions
 * @param {{ fillHeight?: boolean, showTip?: boolean, showHeader?: boolean }} [opts]
 */
export function mountMap(el, store, actions, opts = {}) {
  const fillHeight = Boolean(opts.fillHeight);
  const showTip = opts.showTip !== false;
  const showHeader = opts.showHeader !== false;
  const vb = computeViewBox();
  const par = "xMidYMid meet";
  const arrowIdFor = `cmap-arrow-${mapSeq + 1}`;

  el.innerHTML = `
    <article class="panel cmap cmap--fill${fillHeight ? " cmap--grow" : ""}${showHeader ? "" : " cmap--bare"}">
      ${
        showHeader
          ? `<header class="panel__header">
        <h2 class="panel__title">Site plan</h2>
        <div class="panel__slot">
          <span class="metric mono" data-pin-count>${activePins.length} cameras</span>
        </div>
      </header>`
          : `<span class="metric mono" data-pin-count hidden>${activePins.length} cameras</span>`
      }
      <div class="panel__body cmap__body">
        <div class="cmap__stage" data-stage>
          <svg class="cmap__svg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" preserveAspectRatio="${par}" role="img" aria-label="Site camera plan">
            <rect class="cmap__bg" x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="var(--feed-well)"/>
            ${imageMarkup()}
            <g class="cmap__zones" fill="var(--steel-20)" fill-opacity="0.35" stroke="rgba(149,163,179,0.35)" stroke-width="1.5">
              ${zoneRects()}
            </g>
            <g class="cmap__walks${IMAGE ? " cmap__walks--image" : ""}" fill="none" stroke="rgba(149,163,179,0.3)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              ${walkPaths()}
            </g>
            ${chromeMarkup(vb)}
            <g class="cmap__fovs" data-fovs></g>
            <defs>
              <marker id="${arrowIdFor}" class="cmap__arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse" markerUnits="strokeWidth">
                <path d="M0 0 L10 5 L0 10 z"/>
              </marker>
            </defs>
            <g class="cmap__paths" data-paths></g>
            <g class="cmap__predicted" data-predicted></g>
            <g class="cmap__waypoints" data-waypoints></g>
            <g class="cmap__pins" data-pins></g>
            <g class="cmap__edit" data-edit-handles></g>
          </svg>
          ${
            IMAGE
              ? `<span class="cmap__note" data-map-note></span><span class="cmap__attr" data-map-attr></span>`
              : ""
          }
        </div>
        ${showTip ? `<div class="cmap__tip mono" data-tip>Select a camera</div>` : `<div class="cmap__tip mono" data-tip hidden></div>`}
      </div>
    </article>
  `;

  const pinsLayer = el.querySelector("[data-pins]");
  const fovsLayer = el.querySelector("[data-fovs]");
  const pathsLayer = el.querySelector("[data-paths]");
  const predictedLayer = el.querySelector("[data-predicted]");
  const waypointsLayer = el.querySelector("[data-waypoints]");
  const tip = el.querySelector("[data-tip]");
  const countEl = el.querySelector("[data-pin-count]");
  const stage = el.querySelector("[data-stage]");
  if (stage) stage.style.setProperty("--cmap-ar", `${vb.w} / ${vb.h}`);
  if (IMAGE) {
    setText(el.querySelector("[data-map-note]"), IMAGE.note || "");
    setText(el.querySelector("[data-map-attr]"), IMAGE.attribution || "");
  }

  /** Last drawn followed path (incident + hops), so it redraws on change. */
  let pursuitSig = "";
  let pinPx = false;
  let pinScale = 1;
  const arrowId = `cmap-arrow-${++mapSeq}`;
  const pursuitSeq = new Map();
  const pursuitLast = new Map();
  const pursuitStartT = new Map();
  const drawnSeg = new Set();
  let predictedId = null;
  let pinEls = new Map();
  let pulseEls = new Map();
  let labelEls = new Map();
  let prevLevel = new Map();
  let levelSeeded = false;
  let currentVb = vb;
  let focusId = null;
  let hoverId = null;

  function applyPinHighlight() {
    for (const [id, g] of pinEls) {
      g.classList.toggle("is-focus", focusId === id);
      g.classList.toggle("is-hover", hoverId === id);
    }
  }

  function setFocus(id) {
    focusId = id || null;
    applyPinHighlight();
    emitMapEvent("sentinel:map-focus", { cameraId: focusId });
  }

  function setHover(id) {
    hoverId = id || null;
    applyPinHighlight();
    emitMapEvent("sentinel:map-hover", { cameraId: hoverId });
  }

  function renderPinNodes() {
    clear(pinsLayer);
    clear(fovsLayer);
    pinEls = new Map();
    pulseEls = new Map();
    labelEls = new Map();
    prevLevel = new Map();
    levelSeeded = false;
    for (const pin of activePins) {
      const c = themeColors();
      const fov = document.createElementNS("http://www.w3.org/2000/svg", "path");
      fov.setAttribute("d", fovWedge(pin.x, pin.y, headingOf(pin)));
      fov.setAttribute("fill", c.aquaBg);
      fov.setAttribute("stroke", c.aquaBorder);
      fov.setAttribute("stroke-width", "0.75");
      fovsLayer.appendChild(fov);

      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.classList.add("cmap-pin");
      g.dataset.cameraId = pin.id;
      g.setAttribute("transform", pinTransform(pin));
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "button");
      g.setAttribute("aria-label", cameraTitle(pin.id));

      const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      hit.setAttribute("r", String(PIN_HIT_R));
      hit.setAttribute("fill", "transparent");
      hit.setAttribute("class", "cmap-pin__hit");

      const body = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      body.setAttribute("r", String(PIN_DOT_R));
      body.setAttribute("class", "cmap-pin__dot");

      const pulse = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      pulse.setAttribute("r", String(PIN_DOT_R));
      pulse.setAttribute("class", "cmap-pin__pulse");
      pulseEls.set(pin.id, pulse);

      const num = document.createElementNS("http://www.w3.org/2000/svg", "text");
      num.setAttribute("class", "cmap-pin__num");
      num.setAttribute("text-anchor", "middle");
      num.setAttribute("dominant-baseline", "central");
      num.setAttribute("y", "1");
      num.setAttribute("font-size", String(PIN_NUM_FS));
      num.setAttribute("font-weight", "700");
      num.setAttribute("font-family", "ui-monospace,monospace");
      num.setAttribute("fill", c.onAqua);
      const known = pin.n ?? getCamera(pin.id)?.n;
      const camN =
        known != null
          ? known
          : Number(String(pin.id).replace(/\D/g, "")) || "?";
      num.textContent = String(camN);

      g.appendChild(hit);
      g.appendChild(pulse);
      g.appendChild(body);
      g.appendChild(num);

      const activate = () => {
        setFocus(pin.id);
        document.dispatchEvent(
          new CustomEvent(FOCUS_CAMERA_EVENT, {
            detail: { cameraId: pin.id },
          }),
        );
        const hitSev = activeSeverityForCamera(store.getState(), pin.id);
        if (hitSev?.inc) actions.select(hitSev.inc.incident_id);
      };
      g.addEventListener("click", (e) => {
        e.stopPropagation();
        activate();
      });
      g.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      });
      g.addEventListener("pointerenter", () => {
        setHover(pin.id);
        const state = store.getState();
        const cam = state.cameras[pin.id];
        const people = Array.isArray(cam?.boxes) ? cam.boxes.length : 0;
        const status = cameraStatus(state, pin.id).label;
        if (tip && !tip.hidden) {
          setText(
            tip,
            `${cameraTitle(pin.id)} · ${status} · ${people} people tracked`,
          );
        }
      });
      g.addEventListener("pointerleave", () => {
        setHover(null);
        if (tip && !tip.hidden) setText(tip, "Select a camera");
      });

      pinsLayer.appendChild(g);
      pinEls.set(pin.id, g);
    }
    setText(countEl, `${activePins.length} cameras`);
    applyPinHighlight();
  }

  function pinTransform(pin) {
    const k = pinScale !== 1 ? ` scale(${pinScale.toFixed(3)})` : "";
    return `translate(${pin.x} ${pin.y})${k}`;
  }

  /** With setPinPx, counter the view's zoom so pins keep their px size. */
  function refreshPinScale() {
    let next = 1;
    if (pinPx) {
      const ctm = el.querySelector(".cmap__svg")?.getScreenCTM?.();
      if (ctm && ctm.a > 0) next = 1 / ctm.a;
    }
    if (Math.abs(next - pinScale) >= 0.001) {
      pinScale = next;
      const by = pinById();
      for (const [id, g] of pinEls) {
        const p = by.get(id);
        if (p) g.setAttribute("transform", pinTransform(p));
      }
      for (const wp of waypointsLayer.children) placeWaypoint(wp);
    }
    declutterLabels();
  }

  function placeWaypoint(wp) {
    const k = pinScale !== 1 ? ` scale(${pinScale.toFixed(3)})` : "";
    wp.setAttribute("transform", `translate(${wp.dataset.x} ${wp.dataset.y})${k}`);
  }

  /**
   * Hop-time labels: hide any that would collide with a pin or with a label
   * already kept (only where pins have a fixed size, i.e. the expanded view).
   */
  function declutterLabels() {
    const wps = [...waypointsLayer.children];
    for (const wp of wps) wp.removeAttribute("visibility");
    if (!pinPx) return;
    const hit = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    // Pins with a little clearance (their flash pulse grows the dot).
    const pad = 5;
    const taken = [...pinEls.values()]
      .map((g) => g.querySelector(".cmap-pin__dot")?.getBoundingClientRect())
      .filter(Boolean)
      .map((r) => ({ left: r.left - pad, right: r.right + pad, top: r.top - pad, bottom: r.bottom + pad }));
    const stage = el.querySelector(".cmap__svg")?.getBoundingClientRect();
    // Newest hop first: the latest label wins a collision. Each label tries
    // a few spots along its segment's normal (screen px) before hiding.
    const ctm = el.querySelector(".cmap__svg")?.getScreenCTM?.();
    const unit = ctm && ctm.a > 0 ? 1 / ctm.a : 1;
    for (const wp of wps.reverse()) {
      const { mx, my, nx, ny } = wp.dataset;
      const spots = mx == null ? [0] : [22, -22, 40, -40, 58, -58];
      let placed = false;
      for (const d of spots) {
        if (mx != null) {
          wp.dataset.x = String(Number(mx) + Number(nx) * d * unit);
          wp.dataset.y = String(Number(my) + Number(ny) * d * unit);
          placeWaypoint(wp);
        }
        const r = wp.getBoundingClientRect();
        const outside =
          stage && (r.left < stage.left || r.right > stage.right || r.top < stage.top || r.bottom > stage.bottom);
        if (!outside && !taken.some((t) => hit(r, t))) {
          taken.push(r);
          placed = true;
          break;
        }
      }
      if (!placed) wp.setAttribute("visibility", "hidden");
    }
  }

  function pinPoint(id) {
    return pinById().get(id) ?? null;
  }

  function ensureSegment(fromId, toId, elapsedSec) {
    const key = `${fromId}->${toId}`;
    if (drawnSeg.has(key)) return;
    const route = routeBetween(fromId, toId);
    if (!route) return;
    drawnSeg.add(key);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.classList.add("cmap__pursuit", "is-draw");
    path.setAttribute("d", pointsToD(route));
    path.setAttribute("fill", "none");
    path.setAttribute("pathLength", "1");
    path.setAttribute("marker-end", `url(#${arrowId})`);
    pathsLayer.appendChild(path);
    if (elapsedSec == null) return;

    const c = themeColors();
    const mid = polylineMid(route);
    const mx = mid.x;
    const my = mid.y;
    const dx = mid.dx;
    const dy = mid.dy;
    const len = Math.hypot(dx, dy) || 1;
    // Perpendicular offset so the pill clears pin and path
    const ox = (-dy / len) * 20;
    const oy = (dx / len) * 20;
    const wp = document.createElementNS("http://www.w3.org/2000/svg", "g");
    wp.dataset.x = String(mx + ox);
    wp.dataset.y = String(my + oy);
    // Kept for decluttering: the segment midpoint and its unit normal.
    wp.dataset.mx = String(mx);
    wp.dataset.my = String(my);
    wp.dataset.nx = String(-dy / len);
    wp.dataset.ny = String(dx / len);
    placeWaypoint(wp);
    const label = formatElapsedPlus(elapsedSec);
    const pw = Math.max(40, label.length * 7.4);
    const pill = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    pill.setAttribute("x", String(-pw / 2));
    pill.setAttribute("y", "-9");
    pill.setAttribute("rx", "4");
    pill.setAttribute("ry", "4");
    pill.setAttribute("width", String(pw));
    pill.setAttribute("height", "18");
    pill.setAttribute("fill", "rgba(26,26,28,0.94)");
    pill.setAttribute("stroke", c.severe);
    pill.setAttribute("stroke-width", "1");
    const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
    txt.setAttribute("x", "0");
    txt.setAttribute("y", "1");
    txt.setAttribute("text-anchor", "middle");
    txt.setAttribute("dominant-baseline", "central");
    txt.setAttribute("fill", c.severe);
    txt.setAttribute("font-size", "11");
    txt.setAttribute("font-weight", "600");
    txt.setAttribute("font-family", "ui-monospace,monospace");
    txt.textContent = label;
    wp.appendChild(pill);
    wp.appendChild(txt);
    waypointsLayer.appendChild(wp);
  }

  /**
   * The followed incident's recent path (tracking.js), drawn red with an
   * arrowhead per hop. A hop label (time since first seen) only where the
   * data has the hop time.
   */
  function syncPursuit(state) {
    const inc = followedIncident(state);
    const { hops } = pathHops(state, inc);
    const sig = inc
      ? `${inc.incident_id}|${hops.map((h) => `${h.cameraId}@${h.at || ""}`).join(",")}`
      : "";
    if (sig === pursuitSig) return;
    pursuitSig = sig;
    clear(pathsLayer);
    clear(waypointsLayer);
    drawnSeg.clear();
    for (let i = 1; i < hops.length; i++) {
      ensureSegment(hops[i - 1].cameraId, hops[i].cameraId, secondsSinceStart(inc, hops[i].at));
    }
    declutterLabels();
  }

  function levelOf(hit) {
    if (hit?.sev === "SEVERE") return "severe";
    if (hit?.sev === "MINOR") return "minor";
    return "none";
  }

  function triggerPulse(cameraId) {
    const ring = pulseEls.get(cameraId);
    if (!ring) return;
    ring.classList.remove("is-pulsing");
    void ring.getBoundingClientRect(); // restart animation if already running
    ring.classList.add("is-pulsing");
  }

  function labelWidth(text) {
    return Math.max(28, text.length * 6.4);
  }

  function updateLabel(pin, hit) {
    const existing = labelEls.get(pin.id);
    if (!hit) {
      if (existing) {
        existing.remove();
        labelEls.delete(pin.id);
      }
      return;
    }
    const text = classLabel(hit.inc.class_token);
    const w = labelWidth(text);
    const flip = pin.x + PIN_DOT_R + 8 + w > currentVb.x + currentVb.w - 8;
    const lx = flip ? -(PIN_DOT_R + 8) : PIN_DOT_R + 8;
    const anchor = flip ? "end" : "start";
    let node = existing;
    if (!node) {
      node = document.createElementNS("http://www.w3.org/2000/svg", "text");
      node.setAttribute("class", "cmap-pin__label");
      node.setAttribute("dominant-baseline", "central");
      pinEls.get(pin.id)?.appendChild(node);
      labelEls.set(pin.id, node);
    }
    node.setAttribute("x", String(lx));
    node.setAttribute("y", "-18");
    node.setAttribute("text-anchor", anchor);
    node.textContent = text;
  }

  function paintPinStates(state) {
    for (const pin of activePins) {
      const g = pinEls.get(pin.id);
      if (!g) continue;
      const { online } = cameraStatus(state, pin.id);
      const hit = activeSeverityForCamera(state, pin.id);
      const level = levelOf(hit);
      const prev = prevLevel.get(pin.id) ?? "none";
      if (levelSeeded && LEVEL_RANK[level] > LEVEL_RANK[prev]) {
        triggerPulse(pin.id);
      }
      prevLevel.set(pin.id, level);
      g.classList.toggle("is-offline", !online); // offline or connecting
      g.classList.toggle("is-minor", level === "minor");
      g.classList.toggle("is-severe", level === "severe");
      g.classList.toggle("is-predicted", predictedId === pin.id);
      updateLabel(pin, hit);
    }
    levelSeeded = true;
    applyPinHighlight();
  }

  function highlightPredicted(cameraId) {
    predictedId = cameraId || null;
    clear(predictedLayer);
    if (!predictedId) {
      paintPinStates(store.getState());
      return;
    }
    const pin = pinPoint(predictedId);
    if (!pin) return;
    const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    ring.classList.add("cmap__pred-ring");
    ring.setAttribute("cx", String(pin.x));
    ring.setAttribute("cy", String(pin.y));
    ring.setAttribute("r", "22");
    ring.setAttribute("fill", "none");
    predictedLayer.appendChild(ring);
    paintPinStates(store.getState());
  }

  function clearPredicted() {
    highlightPredicted(null);
  }

  function clearPursuit() {
    clear(pathsLayer);
    clear(waypointsLayer);
    drawnSeg.clear();
    pursuitSig = "";
    pursuitSeq.clear();
    pursuitLast.clear();
    pursuitStartT.clear();
  }

  /** "default" (cropped to the site), "circle" or "rect" (aspect-filled). */
  let fit = "default";
  let fitAspect = 0;
  let fitInset = 0;
  let fitInsetTop = 1;

  function refreshViewBox() {
    const next = computeViewBox(fit, fitAspect, fitInset, fitInsetTop);
    currentVb = next;
    const svg = el.querySelector(".cmap__svg");
    if (!svg || !stage) return;
    svg.setAttribute(
      "viewBox",
      `${next.x} ${next.y} ${next.w} ${next.h}`,
    );
    stage.style.setProperty("--cmap-ar", `${next.w} / ${next.h}`);
    const chrome = svg.querySelector(".cmap__chrome");
    if (chrome) {
      const wrap = document.createElement("div");
      wrap.innerHTML = chromeMarkup(next);
      chrome.replaceWith(wrap.firstElementChild);
    }
    const bg = svg.querySelector(".cmap__bg");
    if (bg) {
      bg.setAttribute("x", String(next.x));
      bg.setAttribute("y", String(next.y));
      bg.setAttribute("width", String(next.w));
      bg.setAttribute("height", String(next.h));
    }
  }

  function render(state) {
    syncPursuit(state);
    paintPinStates(state);
  }

  renderPinNodes();
  render(store.getState());
  const stopEdit = IMAGE && editRequested() ? startMapEdit() : () => {};
  const unsub = store.subscribe(render);
  const unsubTick = subscribeTick(() => render(store.getState()));

  const api = {
    highlightPredicted,
    clearPredicted,
    clearPursuit,
    setFocus,
    setHover,
    setFit(next, fitOpts = {}) {
      const kind = next === "circle" || next === "rect" || next === "pins" ? next : "default";
      const aspect = kind === "rect" ? Number(fitOpts.aspect) || 0 : 0;
      const inset = kind === "rect" ? Number(fitOpts.insetLeft) || 0 : 0;
      const insetTop = kind === "rect" ? Number(fitOpts.insetTop) || 1 : 1;
      if (kind === fit && aspect === fitAspect && inset === fitInset && insetTop === fitInsetTop) return;
      fit = kind;
      fitAspect = aspect;
      fitInset = inset;
      fitInsetTop = insetTop;
      refreshViewBox();
      el.querySelector(".cmap")?.classList.toggle("cmap--circle", kind === "circle");
      render(store.getState());
      refreshPinScale();
    },
    /**
     * Fixed on-screen pin size (24 px dot, 32 px hit area) whatever the
     * zoom; off returns pins to map units.
     */
    setPinPx(on) {
      pinPx = Boolean(on);
      refreshPinScale();
    },
    refreshPinScale,
    /** Client (viewport) position of a camera pin, or null. */
    pinClientPoint(id) {
      const pin = pinPoint(id);
      const svg = el.querySelector(".cmap__svg");
      const ctm = svg?.getScreenCTM?.();
      if (!pin || !ctm) return null;
      return new DOMPoint(pin.x, pin.y).matrixTransform(ctm);
    },
    /** The current view box (map units): its aspect sizes a container. */
    getViewBox: () => ({ ...currentVb }),
    getFocus: () => focusId,
    getHover: () => hoverId,
    setPins(pins) {
      activePins = pins.slice();
      clearPursuit();
      refreshViewBox();
      const svg = el.querySelector(".cmap__svg");
      if (svg) {
        const zones = svg.querySelector(".cmap__zones");
        const walks = svg.querySelector(".cmap__walks");
        if (zones) zones.innerHTML = zoneRects();
        if (walks) walks.innerHTML = walkPaths();
      }
      renderPinNodes();
      render(store.getState());
    },
    fromCameraMap,
  };
  window.__map = api;

  /**
   * ?mapedit=1 (image mode): drag pins and walkway bends, rotate a focused
   * pin's view with the arrow keys (Shift for 15°), double-click a walkway
   * to add a bend and a bend to remove it. The panel shows the values to
   * paste into web/js/site.js.
   */
  function startMapEdit() {
    const svg = el.querySelector(".cmap__svg");
    const handles = el.querySelector("[data-edit-handles]");
    const walks = el.querySelector(".cmap__walks");
    const body = el.querySelector(".cmap__body");
    if (!svg || !handles || !walks || !body) return () => {};
    el.classList.add("is-map-edit");

    const panel = document.createElement("div");
    panel.className = "cmap-edit";
    const head = document.createElement("div");
    head.className = "cmap-edit__head";
    const title = document.createElement("span");
    title.textContent = "Map edit · drag pins and bends · arrows rotate · double-click adds or removes a bend";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn btn--secondary btn--sm";
    copyBtn.textContent = "Copy";
    head.appendChild(title);
    head.appendChild(copyBtn);
    const out = document.createElement("pre");
    out.className = "cmap-edit__out mono";
    panel.appendChild(head);
    panel.appendChild(out);
    body.appendChild(panel);

    const round = (v) => Math.round(v);
    function snippet() {
      const cams = activePins
        .map((p) => `  ${p.id}: x ${round(p.x)}, y ${round(p.y)}, heading ${round(p.heading)}`)
        .join("\n");
      const edges = activeEdges
        .map((e) => `  { a: "${e.a}", b: "${e.b}", via: [${e.via.map((v) => `[${round(v[0])}, ${round(v[1])}]`).join(", ")}] },`)
        .join("\n");
      return `CAMERAS (image x, y, heading)\n${cams}\n\nEDGES\n${edges}`;
    }

    function toSvg(e) {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const m = svg.getScreenCTM();
      return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
    }

    function redraw() {
      walks.innerHTML = walkPaths();
      const by = pinById();
      for (const [id, g] of pinEls) {
        const p = by.get(id);
        if (p) g.setAttribute("transform", `translate(${p.x} ${p.y})`);
      }
      const fovs = fovsLayer.querySelectorAll("path");
      activePins.forEach((p, i) => fovs[i]?.setAttribute("d", fovWedge(p.x, p.y, headingOf(p))));
      while (handles.firstChild) handles.removeChild(handles.firstChild);
      activeEdges.forEach((edge, ei) => {
        edge.via.forEach((v, vi) => {
          const h = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          h.setAttribute("class", "cmap-edit__bend");
          h.setAttribute("cx", String(v[0]));
          h.setAttribute("cy", String(v[1]));
          h.setAttribute("r", "5");
          h.dataset.edge = String(ei);
          h.dataset.via = String(vi);
          handles.appendChild(h);
        });
      });
      out.textContent = snippet();
    }

    /** Drag target: { kind: "pin", pin } | { kind: "bend", v } */
    let drag = null;
    let moved = false;
    function onDown(e) {
      const bend = e.target.closest?.(".cmap-edit__bend");
      const pinG = e.target.closest?.(".cmap-pin");
      if (bend) {
        drag = { kind: "bend", v: activeEdges[Number(bend.dataset.edge)].via[Number(bend.dataset.via)] };
      } else if (pinG) {
        drag = { kind: "pin", pin: pinById().get(pinG.dataset.cameraId) };
      } else {
        return;
      }
      moved = false;
      svg.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    }
    function onMove(e) {
      if (!drag) return;
      const p = toSvg(e);
      moved = true;
      if (drag.kind === "pin" && drag.pin) {
        drag.pin.x = p.x;
        drag.pin.y = p.y;
      } else if (drag.kind === "bend") {
        drag.v[0] = p.x;
        drag.v[1] = p.y;
      }
      redraw();
    }
    function onUp(e) {
      if (!drag) return;
      drag = null;
      svg.releasePointerCapture?.(e.pointerId);
    }
    // A drag must not also select the camera.
    function onClickCapture(e) {
      if (moved) {
        e.stopPropagation();
        e.preventDefault();
        moved = false;
      }
    }
    function onDbl(e) {
      const bend = e.target.closest?.(".cmap-edit__bend");
      if (bend) {
        activeEdges[Number(bend.dataset.edge)].via.splice(Number(bend.dataset.via), 1);
        redraw();
        return;
      }
      // Add a bend on the nearest walkway segment.
      const p = toSvg(e);
      let best = null;
      activeEdges.forEach((edge, ei) => {
        const pts = edgePoints(edge);
        if (!pts) return;
        for (let i = 1; i < pts.length; i++) {
          const [x0, y0] = pts[i - 1];
          const [x1, y1] = pts[i];
          const dx = x1 - x0;
          const dy = y1 - y0;
          const t = Math.max(0, Math.min(1, ((p.x - x0) * dx + (p.y - y0) * dy) / (dx * dx + dy * dy || 1)));
          const d = Math.hypot(p.x - (x0 + dx * t), p.y - (y0 + dy * t));
          if (!best || d < best.d) best = { d, ei, at: i - 1 };
        }
      });
      if (best && best.d < 12) {
        activeEdges[best.ei].via.splice(best.at, 0, [p.x, p.y]);
        redraw();
      }
    }
    function onKey(e) {
      const pinG = e.target.closest?.(".cmap-pin");
      if (!pinG || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      const pin = pinById().get(pinG.dataset.cameraId);
      if (!pin) return;
      const step = (e.shiftKey ? 15 : 5) * (e.key === "ArrowLeft" ? -1 : 1);
      pin.heading = (((pin.heading ?? 0) + step) % 360 + 360) % 360;
      e.preventDefault();
      e.stopPropagation();
      redraw();
    }
    copyBtn.addEventListener("click", () => {
      const text = out.textContent || "";
      navigator.clipboard?.writeText(text).then(
        () => setText(copyBtn, "Copied"),
        () => setText(copyBtn, "Select and copy"),
      );
      window.setTimeout(() => setText(copyBtn, "Copy"), 1500);
    });

    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onUp);
    svg.addEventListener("click", onClickCapture, true);
    svg.addEventListener("dblclick", onDbl);
    svg.addEventListener("keydown", onKey, true);
    redraw();

    return () => {
      svg.removeEventListener("pointerdown", onDown);
      svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerup", onUp);
      svg.removeEventListener("pointercancel", onUp);
      svg.removeEventListener("click", onClickCapture, true);
      svg.removeEventListener("dblclick", onDbl);
      svg.removeEventListener("keydown", onKey, true);
      panel.remove();
      el.classList.remove("is-map-edit");
    };
  }

  return () => {
    unsub();
    unsubTick();
    stopEdit();
    if (window.__map === api) delete window.__map;
  };
}

function editRequested() {
  try {
    return new URLSearchParams(location.search).get("mapedit") === "1";
  } catch {
    return false;
  }
}
