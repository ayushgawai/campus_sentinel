/**
 * Site map — six cameras, adjacency walkways, pursuit path, predicted ring.
 * ViewBox cropped tightly to camera zones + 24px margin.
 */

import {
  CAMERAS,
  ADJACENCY,
  cameraLabel,
  fromCameraMap,
  getCamera,
} from "../site.js";
import { FOCUS_CAMERA_EVENT } from "./cameras.js";
import { clear, setText } from "../dom.js";
import { themeColors } from "../theme.js";

export { FOCUS_CAMERA_EVENT, fromCameraMap, cameraLabel };

const ZONE_W = 200;
const ZONE_H = 140;
const MARGIN = 24;
const PIN_HIT_R = 16; // 32px tap target
const PIN_DOT_R = 12; // 24px pin
const PIN_NUM_FS = 12;

let activePins = CAMERAS.slice();
const pinById = () => new Map(activePins.map((p) => [p.id, p]));

function computeViewBox() {
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

function activeSeverityForCamera(state, cameraId) {
  for (const id of state.order) {
    const inc = state.incidents[id];
    if (!inc || inc.camera_id !== cameraId) continue;
    if (inc.state === "RESOLVED" || inc.state === "DISMISSED") continue;
    if (inc.severity === "SEVERE" || inc.severity === "MINOR")
      return { sev: inc.severity, inc };
  }
  return null;
}

function trackingIncidents(state) {
  return state.order
    .map((id) => state.incidents[id])
    .filter((inc) => inc && inc.state === "TRACKING");
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
  return ADJACENCY.map(([a, b]) => {
    const pa = by.get(a);
    const pb = by.get(b);
    if (!pa || !pb) return "";
    return `<path d="M${pa.x} ${pa.y} L${pb.x} ${pb.y}"/>`;
  }).join("");
}

function chromeMarkup(vb) {
  const nx = vb.x + 28;
  const ny = vb.y + 28;
  const sx = vb.x + vb.w - 128;
  const sy = vb.y + vb.h - 36;
  const chrome = "var(--map-chrome, rgba(149,163,179,0.8))";
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
            <rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="var(--feed-well)"/>
            <g class="cmap__zones" fill="var(--steel-20)" fill-opacity="0.35" stroke="rgba(149,163,179,0.35)" stroke-width="1.5">
              ${zoneRects()}
            </g>
            <g class="cmap__walks" fill="none" stroke="rgba(149,163,179,0.3)" stroke-width="1.5" stroke-linecap="round">
              ${walkPaths()}
            </g>
            ${chromeMarkup(vb)}
            <g class="cmap__fovs" data-fovs></g>
            <g class="cmap__paths" data-paths></g>
            <g class="cmap__predicted" data-predicted></g>
            <g class="cmap__waypoints" data-waypoints></g>
            <g class="cmap__pins" data-pins></g>
          </svg>
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

  const pursuitSeq = new Map();
  const pursuitLast = new Map();
  const pursuitStartT = new Map();
  const drawnSeg = new Set();
  let predictedId = null;
  let pinEls = new Map();
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
      g.setAttribute("transform", `translate(${pin.x} ${pin.y})`);
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "button");
      g.setAttribute("aria-label", cameraLabel(pin.id));

      const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      hit.setAttribute("r", String(PIN_HIT_R));
      hit.setAttribute("fill", "transparent");
      hit.setAttribute("class", "cmap-pin__hit");

      const body = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      body.setAttribute("r", String(PIN_DOT_R));
      body.setAttribute("class", "cmap-pin__dot");

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
        const online = cam ? Boolean(cam.online) : true;
        const people = Array.isArray(cam?.boxes) ? cam.boxes.length : 0;
        const hitSev = activeSeverityForCamera(state, pin.id);
        const status = hitSev
          ? hitSev.sev === "SEVERE"
            ? "Severe"
            : "Minor"
          : online
            ? "Online"
            : "Offline";
        if (tip && !tip.hidden) {
          setText(
            tip,
            `${cameraLabel(pin.id)} · ${status} · ${people} people tracked`,
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

  function pinPoint(id) {
    return pinById().get(id) ?? null;
  }

  function formatPlus(sec) {
    const s = Math.max(0, Math.floor(sec));
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `+${mm}:${String(ss).padStart(2, "0")}`;
  }

  function ensureSegment(fromId, toId, elapsedSec) {
    const key = `${fromId}->${toId}`;
    if (drawnSeg.has(key)) return;
    const a = pinPoint(fromId);
    const b = pinPoint(toId);
    if (!a || !b) return;
    drawnSeg.add(key);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.classList.add("cmap__pursuit", "is-draw");
    path.setAttribute("d", `M${a.x} ${a.y} L${b.x} ${b.y}`);
    path.setAttribute("fill", "none");
    path.setAttribute("pathLength", "1");
    pathsLayer.appendChild(path);

    const c = themeColors();
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // Perpendicular offset so the pill clears pin and path
    const ox = (-dy / len) * 20;
    const oy = (dx / len) * 20;
    const wp = document.createElementNS("http://www.w3.org/2000/svg", "g");
    wp.setAttribute("transform", `translate(${mx + ox} ${my + oy})`);
    const label = formatPlus(elapsedSec);
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

  function syncPursuit(state) {
    const t = state.demo?.t ?? 0;
    for (const inc of trackingIncidents(state)) {
      const path = state.cameraPath?.[inc.incident_id];
      if (Array.isArray(path) && path.length >= 2) {
        if (!pursuitStartT.has(inc.incident_id)) {
          pursuitStartT.set(inc.incident_id, Math.max(0, t - 12));
        }
        const start = pursuitStartT.get(inc.incident_id) ?? t;
        for (let i = 1; i < path.length; i++) {
          ensureSegment(
            path[i - 1],
            path[i],
            (t - start) * (i / (path.length - 1)),
          );
        }
        pursuitLast.set(inc.incident_id, path[path.length - 1]);
        pursuitSeq.set(inc.incident_id, path.slice());
        continue;
      }
      const cam = inc.camera_id;
      if (!cam) continue;
      const last = pursuitLast.get(inc.incident_id);
      if (!last) {
        pursuitLast.set(inc.incident_id, cam);
        pursuitSeq.set(inc.incident_id, [cam]);
        pursuitStartT.set(inc.incident_id, t);
        continue;
      }
      if (last === cam) continue;
      const seq = pursuitSeq.get(inc.incident_id) ?? [last];
      seq.push(cam);
      pursuitSeq.set(inc.incident_id, seq);
      pursuitLast.set(inc.incident_id, cam);
      const start = pursuitStartT.get(inc.incident_id) ?? t;
      ensureSegment(last, cam, t - start);
    }
  }

  function paintPinStates(state) {
    for (const pin of activePins) {
      const g = pinEls.get(pin.id);
      if (!g) continue;
      const cam = state.cameras[pin.id];
      const online = cam ? Boolean(cam.online) : true;
      const hit = activeSeverityForCamera(state, pin.id);
      g.classList.toggle("is-offline", !online);
      g.classList.toggle("is-minor", hit?.sev === "MINOR");
      g.classList.toggle("is-severe", hit?.sev === "SEVERE");
      g.classList.toggle("is-predicted", predictedId === pin.id);
    }
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
    pursuitSeq.clear();
    pursuitLast.clear();
    pursuitStartT.clear();
  }

  function refreshViewBox() {
    const next = computeViewBox();
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
    const bg = svg.querySelector("rect");
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
  const unsub = store.subscribe(render);

  const api = {
    highlightPredicted,
    clearPredicted,
    clearPursuit,
    setFocus,
    setHover,
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

  return () => {
    unsub();
    if (window.__map === api) delete window.__map;
  };
}
