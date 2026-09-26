/** System page — site info, health stats, AI models, camera status grid. */

import { SITE, WALL_CAMERA_IDS, cameraTitle, getCamera } from "../site.js?v=pro7";
import {
  cameraLabel,
  classLabel,
  formatClock,
  formatInt,
  formatMs,
  formatPct,
  stateLabel,
} from "../format.js?v=pro7";
import { el, setText } from "../dom.js?v=pro7";
import { icon } from "../icons.js?v=pro7";
import { navigate } from "../router.js?v=pro7";
import { now, subscribeTick } from "../clock.js?v=pro7";
import { cameraStatus, onlineCount } from "../cameraStatus.js?v=pro7";
import { STATUS_DOT, STATUS_LABEL, subscribeModelStatus } from "../modelStatus.js?v=pro7";
import { createModelsTable } from "./modelsTable.js?v=pro7";
import { FOCUS_CAMERA_EVENT } from "./cameras.js?v=pro7";
import { mountUsageCard } from "./usageCard.js?v=pro7";

const STATUS_DOT_CLASS = {
  online: "dot--ok",
  offline: "dot--off",
  connecting: "dot--off",
  minor: "dot--warn",
  severe: "dot--severe",
};

export function mountSystem(root, store) {
  root.innerHTML = `
    <div class="system-grid">
      <article class="panel system__site">
        <header class="panel__header">
          <h2 class="panel__title">Site</h2>
        </header>
        <div class="panel__body" data-site></div>
      </article>
      <article class="panel system__health">
        <header class="panel__header">
          <h2 class="panel__title">System health</h2>
        </header>
        <div class="panel__body" data-health></div>
      </article>
      <div class="system__usage-slot" data-usage></div>
      <article class="panel system__models" aria-labelledby="system-models-title">
        <header class="panel__header">
          <h2 class="panel__title" id="system-models-title">AI models</h2>
          <div class="panel__slot mtable-sum">
            <span class="mono" data-models-sub></span>
            <span class="mtable-live"><span class="mdot mdot--active" aria-hidden="true"></span>Live</span>
          </div>
        </header>
        <div class="panel__body" data-models></div>
      </article>
      <article class="panel system__cams">
        <header class="panel__header">
          <h2 class="panel__title">Cameras</h2>
          <div class="panel__slot"><span class="metric mono" data-cam-summary></span></div>
        </header>
        <div class="panel__body" data-cams></div>
      </article>
    </div>
  `;

  const $ = (sel) => root.querySelector(sel);
  // Cloud cost avoided: right after the health row.
  const usageSlot = $("[data-usage]");
  const unmountUsage = mountUsageCard(usageSlot.parentNode, store);
  usageSlot.replaceWith(root.querySelector(".system__usage"));
  const models = createModelsTable({ className: "mtable--page", store });
  const modelsSub = $("[data-models-sub]");
  models.onChange(() => setText(modelsSub, models.summary()));
  $("[data-models]").appendChild(models.el);

  // Site: static key/value list.
  const siteEl = $("[data-site]");
  siteEl.className = "panel__body sys-kv";
  for (const [k, v] of [
    ["Name", SITE.name],
    ["Type", SITE.type],
    ["Timezone", SITE.timezone],
    ["Product", "Sentinel"],
  ]) {
    if (!v) continue;
    const row = el("div", { className: "sys-kv__row" });
    row.appendChild(el("span", { className: "sys-kv__k", text: k }));
    row.appendChild(el("span", { className: "sys-kv__v", text: v }));
    siteEl.appendChild(row);
  }

  // System health: one row of equal stat cards, built once, hidden when
  // the value does not exist.
  const healthEl = $("[data-health]");
  healthEl.className = "panel__body sys-stats";
  const stats = new Map();
  for (const [id, label] of [
    ["cams", "Cameras online"],
    ["models", "Models"],
    ["gpu", "GPU"],
    ["p95", "Latency (p95)"],
    ["screened", "Frames analyzed"],
    ["flagged", "Frames flagged"],
    ["conn", "Connection"],
  ]) {
    const card = el("div", { className: "sys-stat" });
    card.appendChild(el("span", { className: "sys-stat__k", text: label }));
    const v = el("span", { className: "sys-stat__v" });
    const dot = el("span", { className: "dot", attrs: { "aria-hidden": "true" } });
    dot.hidden = true;
    const text = el("span", { className: "metric" });
    v.appendChild(dot);
    v.appendChild(text);
    card.appendChild(v);
    card.hidden = true;
    healthEl.appendChild(card);
    stats.set(id, { card, dot, text });
  }

  function setStat(id, value, dotClass = null, mono = true) {
    const s = stats.get(id);
    const has = value != null && value !== "";
    s.card.hidden = !has;
    if (!has) return;
    setText(s.text, value);
    s.text.classList.toggle("mono", mono);
    s.dot.hidden = !dotClass;
    if (dotClass) s.dot.className = `dot ${dotClass}`;
  }

  // Cameras: 3 x 2 grid of status cards in wall order, built once.
  const camsEl = $("[data-cams]");
  camsEl.className = "panel__body sys-cams";
  const summaryEl = $("[data-cam-summary]");
  const cards = new Map();
  for (const id of WALL_CAMERA_IDS) {
    const label = cameraLabel(id);
    const card = el("button", { type: "button", className: "sys-cam" });

    const top = el("span", { className: "sys-cam__top" });
    top.appendChild(el("span", { className: "sys-cam__name", text: label }));
    const status = el("span", { className: "sys-cam__status" });
    const statusDot = el("span", { className: "dot", attrs: { "aria-hidden": "true" } });
    const statusText = el("span");
    status.appendChild(statusDot);
    status.appendChild(statusText);
    top.appendChild(status);
    card.appendChild(top);
    const place = getCamera(id)?.name;
    if (place) card.appendChild(el("span", { className: "sys-cam__place", text: place }));

    const preview = el("span", { className: "sys-cam__preview" });
    const canvas = document.createElement("canvas");
    canvas.className = "sys-cam__frame";
    canvas.hidden = true;
    const empty = el("span", { className: "sys-cam__empty" });
    empty.appendChild(icon("camera"));
    const emptyText = el("span");
    empty.appendChild(emptyText);
    preview.appendChild(canvas);
    preview.appendChild(empty);
    card.appendChild(preview);

    // Spans only: a button may hold phrasing content, not a <dl>.
    const dl = el("span", { className: "sys-cam__rows" });
    const mkRow = (k) => {
      const wrap = el("span", { className: "sys-cam__row" });
      wrap.appendChild(el("span", { className: "sys-cam__k", text: k }));
      const dd = el("span", { className: "sys-cam__v" });
      wrap.appendChild(dd);
      wrap.hidden = true;
      dl.appendChild(wrap);
      return { wrap, dd };
    };
    const people = mkRow("People in view");
    const last = mkRow("Last frame");
    const incident = mkRow("Incident");
    people.dd.classList.add("mono");
    last.dd.classList.add("mono");
    const chip = el("span", { className: "sys-cam__chip" });
    incident.dd.appendChild(chip);
    card.appendChild(dl);

    card.addEventListener("click", () => {
      navigate("live");
      document.dispatchEvent(new CustomEvent(FOCUS_CAMERA_EVENT, { detail: { cameraId: id } }));
      window.__map?.setFocus?.(id);
    });

    camsEl.appendChild(card);
    cards.set(id, {
      card,
      statusDot,
      statusText,
      canvas,
      preview,
      ctx: canvas.getContext("2d"),
      empty,
      emptyText,
      people,
      last,
      incident,
      chip,
      hasFrame: false,
    });
  }

  /** The wall's current media element for this camera, if it shows one. */
  function wallMedia(id) {
    const video = window.__cameraVideos?.get?.(id);
    if (video && !video.hidden && video.readyState >= 2 && video.videoWidth > 0) return video;
    const img = window.__cameraStreams?.get?.(id);
    if (img && !img.hidden && img.getAttribute("src") && img.complete && img.naturalWidth > 0) {
      return img;
    }
    return null;
  }

  /** Draw `media` to fill the preview at its size, cropped, not stretched. */
  function drawCover(c, media) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(c.preview.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.preview.clientHeight * dpr));
    if (c.canvas.width !== w) c.canvas.width = w;
    if (c.canvas.height !== h) c.canvas.height = h;
    const sw = media.videoWidth || media.naturalWidth;
    const sh = media.videoHeight || media.naturalHeight;
    const scale = Math.max(w / sw, h / sh);
    const cw = w / scale;
    const ch = h / scale;
    c.ctx.drawImage(media, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, w, h);
  }

  /** Copy one frame from the wall (no second stream is opened). */
  function drawPreviews(state) {
    for (const id of WALL_CAMERA_IDS) {
      const c = cards.get(id);
      // Online cameras only, so an offline card never shows a stale frame.
      const media = cameraStatus(state, id).online ? wallMedia(id) : null;
      let drawn = false;
      if (media) {
        try {
          drawCover(c, media);
          drawn = true;
        } catch {
          drawn = false;
        }
      }
      c.hasFrame = drawn;
      c.canvas.hidden = !drawn;
      c.empty.hidden = drawn;
    }
  }

  function paintCameras(state, nowMs = now()) {
    let online = 0;
    for (const id of WALL_CAMERA_IDS) {
      const c = cards.get(id);
      const st = cameraStatus(state, id);
      const cam = state.cameras?.[id];
      if (st.online) online += 1;

      c.card.dataset.status = st.key;
      const aria = `${cameraTitle(id)}, ${st.label}. Open in Live Operations`;
      if (c.card.getAttribute("aria-label") !== aria) c.card.setAttribute("aria-label", aria);
      c.statusDot.className = `dot ${STATUS_DOT_CLASS[st.key]}`;
      setText(c.statusText, st.label);
      setText(
        c.emptyText,
        st.online ? "No preview" : st.key === "connecting" ? "Connecting" : "No signal",
      );

      const boxes = Array.isArray(cam?.boxes) ? cam.boxes : null;
      c.people.wrap.hidden = !(st.online && boxes);
      if (st.online && boxes) setText(c.people.dd, String(boxes.length));

      // Last frame: now while a live frame is on screen, else the last
      // camera event time; hidden when neither exists.
      let lastMs = null;
      if (st.online && c.hasFrame) lastMs = nowMs;
      else if (cam?.lastTs) {
        const t = Date.parse(cam.lastTs);
        if (Number.isFinite(t)) lastMs = t;
      }
      c.last.wrap.hidden = lastMs == null;
      if (lastMs != null) setText(c.last.dd, formatClock(lastMs, SITE.timezone));

      c.incident.wrap.hidden = !st.inc;
      if (st.inc) {
        setText(c.chip, `${classLabel(st.inc.class_token)} · ${stateLabel(st.inc.state)}`);
        c.chip.className = `sys-cam__chip sys-cam__chip--${st.key}`;
      }
    }
    const total = WALL_CAMERA_IDS.length;
    setText(summaryEl, `${total} cameras · ${online} online`);
  }

  function paintHealth(state) {
    const h = state.health || {};
    const got = Boolean(h.received);
    // Same count as the header and camera wall (cameraStatus.js).
    setStat("cams", `${onlineCount(state, WALL_CAMERA_IDS)} / ${WALL_CAMERA_IDS.length}`);
    const { overall } = models.update(state);
    setStat("models", STATUS_LABEL[overall], STATUS_DOT[overall], false);
    setStat("gpu", got && h.gpu_util != null ? formatPct(h.gpu_util) : null);
    setStat("p95", got && h.p95_ms != null ? formatMs(h.p95_ms) : null);
    setStat("screened", got && h.frames_screened != null ? formatInt(h.frames_screened) : null);
    setStat("flagged", got && h.frames_escalated != null ? formatInt(h.frames_escalated) : null);
    // Connection: "Live" / "Reconnecting"; hidden in mock (never "Mock").
    const conn = state.connection?.status;
    setStat(
      "conn",
      conn === "LIVE" ? "Live" : conn === "RECONNECTING" ? "Reconnecting" : null,
      conn === "LIVE" ? "dot--ok" : conn === "RECONNECTING" ? "dot--warn" : null,
      false,
    );
  }

  let lastRoute = null;
  function render(state) {
    // Entering the page: show previews now rather than on the next tick.
    if (state.route === "system" && lastRoute !== "system") drawPreviews(state);
    lastRoute = state.route;
    paintHealth(state);
    paintCameras(state);
  }

  // Previews and "Last frame" refresh once a second, only while visible.
  const unsubTick = subscribeTick((ms) => {
    const state = store.getState();
    if (state.route !== "system") return;
    drawPreviews(state);
    paintCameras(state, ms);
  });

  render(store.getState());
  const unsubModels = subscribeModelStatus(() => render(store.getState()));
  const unsub = store.subscribe(render);
  return () => {
    unmountUsage();
    unsub();
    unsubModels();
    unsubTick();
  };
}
