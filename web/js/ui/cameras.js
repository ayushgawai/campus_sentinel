/** Camera wall — layout modes, VMS OSD, corner brackets. */

import { WALL_CAMERA_IDS, cameraLabel, SITE, cameraTitle } from "../site.js?v=live2";
import { now, subscribeTick } from "../clock.js?v=live2";
import {
  classLabel,
  formatPct,
  formatRel,
  formatClock,
  personLabel,
  stateLabel,
  severityLabel,
} from "../format.js?v=live2";
import {
  activeIncidentForCamera,
  cameraStatus,
  noteFrame,
  noteStream,
  onlineCount,
} from "../cameraStatus.js?v=live2";
import { clear, el, setText } from "../dom.js?v=live2";
import { createCameraLayout } from "./cameraLayout.js?v=live2";
import { themeColors } from "../theme.js?v=live2";
import * as cameraSources from "../cameraSources.js?v=live2";
import { cameraStream } from "../transport.js?v=live2";
import { icon } from "../icons.js?v=live2";
import { OP_REPORT_EVENT, confidenceShort } from "./operator.js?v=live2";

export const FOCUS_CAMERA_EVENT = "sentinel:focus-camera";
export const OPEN_SIDEBAR_EVENT = "sentinel:open-sidebar";
export const MORE_INCIDENTS_EVENT = "sentinel:more-incidents";
/** #page-live[data-mode] changed ("watch" | "incident"); see ui/live.js. */
export const LIVE_MODE_EVENT = "sentinel:live-mode";
/** Live stage geometry changed: detail { mode, ring, rects, duration }. */
export const LIVE_RING_EVENT = "sentinel:live-ring";

export function toPanePx(bbox, w, h) {
  return {
    x: bbox.x * w,
    y: bbox.y * h,
    w: bbox.w * w,
    h: bbox.h * h,
  };
}

function boxesEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.x !== y.x ||
      x.y !== y.y ||
      x.w !== y.w ||
      x.h !== y.h ||
      x.track_id !== y.track_id ||
      x.score !== y.score
    ) {
      return false;
    }
  }
  return true;
}

function camNum(id) {
  const m = String(id).match(/(\d+)/);
  return m ? String(Number(m[1])) : "?";
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Tile OSD, "2026-09-24 23:08:07" (24 h, site timezone). */
function formatOsdClock(ms) {
  let date;
  try {
    date = new Intl.DateTimeFormat("en-CA", {
      timeZone: SITE.timezone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ms));
  } catch {
    const d = new Date(ms);
    date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  return `${date} ${formatClock(ms)}`;
}

function drawCornerBox(ctx, x, y, bw, bh, color) {
  const len = Math.min(12, Math.max(6, Math.min(bw, bh) * 0.22));
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y + len);
  ctx.lineTo(x, y);
  ctx.lineTo(x + len, y);
  ctx.moveTo(x + bw - len, y);
  ctx.lineTo(x + bw, y);
  ctx.lineTo(x + bw, y + len);
  ctx.moveTo(x + bw, y + bh - len);
  ctx.lineTo(x + bw, y + bh);
  ctx.lineTo(x + bw - len, y + bh);
  ctx.moveTo(x + len, y + bh);
  ctx.lineTo(x, y + bh);
  ctx.lineTo(x, y + bh - len);
  ctx.stroke();
}

function streamFor(cameraId, state) {
  const cam = state?.cameras?.[cameraId];
  const url = cam?.mjpeg_url || cam?.stream_url;
  return url ? { kind: "mjpeg", url } : cameraStream(cameraId);
}

function uploadIconSvg() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS(ns, "path");
  path.setAttribute(
    "d",
    "M8 2.5v7M5 5.5 8 2.5 11 5.5M3.5 10.5v2a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-2",
  );
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.4");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

export function mountCameras(root, store, actions, layout) {
  /** Pending 5 s MJPEG retry per camera. */
  const streamRetry = new Map();
  const STREAM_RETRY_MS = 5000;

  function cancelStreamRetry(id) {
    const t = streamRetry.get(id);
    if (t) window.clearTimeout(t);
    streamRetry.delete(id);
  }

  function scheduleStreamRetry(id, img) {
    cancelStreamRetry(id);
    const src = img.getAttribute("src");
    streamRetry.set(
      id,
      window.setTimeout(() => {
        streamRetry.delete(id);
        // Only if the tile still wants this stream; setting src again
        // (same value) makes the browser fetch it anew.
        if (img.getAttribute("src") === src) img.setAttribute("src", src);
      }, STREAM_RETRY_MS),
    );
  }

  const layoutCtl = layout || createCameraLayout();

  root.innerHTML = `
    <div class="camwall">
      <div class="camwall__toolbar">
        <span class="camwall__title">Cameras</span>
        <span class="camwall__slot metric mono" data-cam-count>0 online</span>
        <button type="button" class="btn btn--secondary btn--sm camwall__all" data-all-cams hidden aria-label="Show all cameras" title="All cameras">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
            <rect x="1" y="1" width="5" height="5" rx="1" fill="currentColor"/>
            <rect x="8" y="1" width="5" height="5" rx="1" fill="currentColor"/>
            <rect x="1" y="8" width="5" height="5" rx="1" fill="currentColor"/>
            <rect x="8" y="8" width="5" height="5" rx="1" fill="currentColor"/>
          </svg>
          <span>All cameras</span>
        </button>
      </div>
      <div class="camwall__stage" data-stage></div>
      <div class="camwall__more" data-more hidden></div>
    </div>
  `;

  const stage = root.querySelector("[data-stage]");
  const countEl = root.querySelector("[data-cam-count]");
  const moreEl = root.querySelector("[data-more]");
  const allCamsBtn = root.querySelector("[data-all-cams]");
  allCamsBtn.addEventListener("click", () => layoutCtl.showAll());
  const tiles = new Map();
  /** @type {Map<string, HTMLVideoElement>} */
  const videos = new Map();
  const streams = new Map();
  const headers = new Map();
  /** cameraId → live "ago" node in that tile's incident bar */
  const headerAgo = new Map();
  let raf = 0;
  let lastPlanKey = "";
  let editMode = false;

  for (const id of WALL_CAMERA_IDS) {
    const wrap = document.createElement("div");
    wrap.className = "cam-slot";
    wrap.dataset.cameraId = id;

    const header = document.createElement("div");
    header.className = "cam-inc-bar";
    header.hidden = true;
    headers.set(id, header);

    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "cam-tile";
    tile.dataset.cameraId = id;
    tile.setAttribute("aria-label", cameraTitle(id));
    tile.title = cameraTitle(id);

    const media = document.createElement("div");
    media.className = "cam-tile__media";

    const video = document.createElement("video");
    video.className = "cam-tile__video";
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.preload = "auto";
    video.setAttribute("aria-hidden", "true");
    video.hidden = true;
    videos.set(id, video);
    video.addEventListener("timeupdate", () => noteFrame(id));

    const streamImg = document.createElement("img");
    streamImg.className = "cam-tile__stream";
    streamImg.alt = "";
    streamImg.decoding = "async";
    streamImg.hidden = true;
    streams.set(id, streamImg);
    // MJPEG status: up once a frame has loaded, and it stays up (a stream
    // fires load only once) until an error or a src change. On error, retry
    // the same src every 5 s; the next load brings it back up.
    streamImg.addEventListener("load", () => {
      if (streamImg.naturalWidth > 0) noteStream(id, true);
    });
    streamImg.addEventListener("error", () => {
      if (!streamImg.getAttribute("src")) return;
      noteStream(id, false);
      scheduleStreamRetry(id, streamImg);
    });

    const canvas = document.createElement("canvas");
    canvas.className = "cam-tile__canvas";
    const noise = document.createElement("div");
    noise.className = "cam-tile__noise";
    noise.setAttribute("aria-hidden", "true");
    const offline = document.createElement("div");
    offline.className = "cam-tile__offline";
    offline.hidden = true;
    offline.textContent = "No signal";
    media.appendChild(video);
    media.appendChild(streamImg);
    media.appendChild(canvas);
    media.appendChild(noise);
    media.appendChild(offline);

    const dropHint = document.createElement("div");
    dropHint.className = "cam-tile__drop";
    dropHint.hidden = true;
    dropHint.setAttribute("aria-hidden", "true");


    const liveRow = document.createElement("div");
    liveRow.className = "cam-tile__live";
    const liveDot = document.createElement("span");
    liveDot.className = "dot dot--ok";
    liveDot.setAttribute("aria-hidden", "true");
    const liveLbl = document.createElement("span");
    liveLbl.className = "cam-tile__live-label";
    liveLbl.textContent = cameraTitle(id);
    liveRow.appendChild(liveDot);
    liveRow.appendChild(liveLbl);

    const osdTr = document.createElement("div");
    osdTr.className = "cam-tile__osd cam-tile__osd--tr";
    const recDot = document.createElement("span");
    recDot.className = "dot dot--rec";
    recDot.setAttribute("aria-hidden", "true");
    const recTxt = document.createElement("span");
    recTxt.textContent = "REC";
    osdTr.appendChild(recDot);
    osdTr.appendChild(recTxt);

    const osdBl = document.createElement("div");
    osdBl.className = "cam-tile__osd cam-tile__osd--bl";
    osdBl.dataset.clock = "";


    const chip = document.createElement("span");
    chip.className = "cam-tile__chip";
    chip.hidden = true;

    const leftNote = document.createElement("div");
    leftNote.className = "cam-tile__left-note";
    leftNote.hidden = true;
    leftNote.textContent = "Person left view";

    tile.appendChild(media);
    tile.appendChild(dropHint);
    tile.appendChild(liveRow);
    tile.appendChild(osdTr);
    tile.appendChild(osdBl);
    tile.appendChild(chip);
    tile.appendChild(leftNote);

    // Report flag: a sibling of the tile (a button cannot hold a button),
    // in the tile header band just left of REC. Shown on hover or focus;
    // always on a main camera without an incident bar.
    const flag = document.createElement("button");
    flag.type = "button";
    flag.className = "btn btn--ghost btn--icon btn--sm cam-flag";
    flag.setAttribute("aria-label", `Report incident on ${cameraLabel(id)}`);
    flag.title = `Report incident on ${cameraLabel(id)}`;
    flag.appendChild(icon("flag"));
    flag.addEventListener("click", (e) => {
      e.stopPropagation();
      document.dispatchEvent(
        new CustomEvent(OP_REPORT_EVENT, { detail: { cameraId: id, anchor: flag } }),
      );
    });

    wrap.appendChild(header);
    wrap.appendChild(tile);
    wrap.appendChild(flag);
    stage.appendChild(wrap);

    tiles.set(id, {
      wrap,
      tile,
      header,
      media,
      video,
      streamImg,
      noise,
      dropHint,
      canvas,
      ctx: canvas.getContext("2d"),
      clockEl: osdBl,
      recDot,
      chipEl: chip,
      offlineEl: offline,
      leftNote,
      uploadBtn: null,
      boxes: [],
      dirty: true,
      highlightTrack: null,
      severity: null,
      hasLocalVideo: false,
      hasStream: false,
    });

    let clickTimer = 0;
    tile.addEventListener("click", (e) => {
      if (e.target?.closest?.("[data-cam-upload]")) return;
      if (clickTimer) {
        window.clearTimeout(clickTimer);
        clickTimer = 0;
        layoutCtl.soloMain(id);
        return;
      }
      clickTimer = window.setTimeout(() => {
        clickTimer = 0;
        const plan = layoutCtl.plan(store.getState());
        if (plan.mode === "grid") {
          const inc = activeIncidentForCamera(store.getState(), id);
          if (inc) actions.select(inc.incident_id);
          layoutCtl.swapMain(id);
        } else if (plan.thumbs.includes(id)) {
          layoutCtl.swapMain(id);
        } else {
          const inc = activeIncidentForCamera(store.getState(), id);
          if (inc) actions.select(inc.incident_id);
        }
      }, 220);
    });

    const onDragOver = (e) => {
      if (!editMode) return;
      if (![...e.dataTransfer.types].includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      tile.classList.add("is-drop-target");
      dropHint.hidden = false;
      setText(dropHint, `Drop to use for ${cameraLabel(id)}`);
    };
    const onDragLeave = (e) => {
      if (!editMode) return;
      if (e.relatedTarget && tile.contains(e.relatedTarget)) return;
      tile.classList.remove("is-drop-target");
      dropHint.hidden = true;
    };
    const onDrop = (e) => {
      if (!editMode) return;
      e.preventDefault();
      tile.classList.remove("is-drop-target");
      dropHint.hidden = true;
      const file = e.dataTransfer?.files?.[0];
      if (file) cameraSources.assign(id, file);
    };
    tile.addEventListener("dragover", onDragOver);
    tile.addEventListener("dragleave", onDragLeave);
    tile.addEventListener("drop", onDrop);
  }

  window.__cameraVideos = videos;
  window.__cameraStreams = streams;

  // Frame monitor for video tiles: a camera counts as active while its video
  // presents frames (requestVideoFrameCallback; timeupdate above as a
  // fallback). MJPEG tiles use their image load event plus backend events.
  const hasRvfc =
    typeof HTMLVideoElement !== "undefined" &&
    "requestVideoFrameCallback" in HTMLVideoElement.prototype;
  if (hasRvfc) {
    for (const [id, video] of videos) {
      const onFrame = () => {
        noteFrame(id);
        video.requestVideoFrameCallback(onFrame);
      };
      video.requestVideoFrameCallback(onFrame);
    }
  }

  function syncVideoSources() {
    const state = store.getState();
    const running = Boolean(state.demo?.running);
    const speed = state.demo?.speed ?? 1;
    for (const id of WALL_CAMERA_IDS) {
      const tile = tiles.get(id);
      const src = cameraSources.get(id);
      const video = tile.video;
      const ready = src && src.status === "ready" && src.url;
      const remote = !ready ? streamFor(id, state) : null;
      const videoUrl = ready ? src.url : remote?.kind === "video" ? remote.url : null;
      tile.hasLocalVideo = Boolean(ready);
      if (videoUrl) {
        if (video.src !== videoUrl) {
          video.src = videoUrl;
          try {
            video.currentTime = ready ? src.offset || 0 : 0;
          } catch {
            /* ignore */
          }
        }
        try {
          video.playbackRate = ready ? speed : 1;
        } catch {
          /* ignore */
        }
        video.hidden = false;
        tile.noise.hidden = true;
        if (!ready || running) {
          const p = video.play();
          if (p && typeof p.catch === "function") p.catch(() => {});
        } else {
          video.pause();
        }
      } else {
        if (video.src) {
          video.removeAttribute("src");
          try {
            video.load();
          } catch {
            /* ignore */
          }
        }
        video.hidden = true;
        if (!tile.hasStream) tile.noise.hidden = false;
      }
      tile.dirty = true;
    }
    scheduleDraw();
  }

  function syncEditChrome() {
    editMode = cameraSources.getEditMode();
    root.classList.toggle("is-edit-sources", editMode);
    for (const id of WALL_CAMERA_IDS) {
      const tile = tiles.get(id);
      if (editMode) {
        if (!tile.uploadBtn) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "btn btn--ghost cam-tile__upload";
          btn.dataset.camUpload = id;
          btn.setAttribute(
            "aria-label",
            `Upload video for ${cameraLabel(id)}`,
          );
          btn.appendChild(uploadIconSvg());
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const input = document.createElement("input");
            input.type = "file";
            input.accept = cameraSources.ACCEPT_ATTR;
            input.hidden = true;
            input.addEventListener("change", () => {
              const file = input.files?.[0];
              if (file) cameraSources.assign(id, file);
              input.remove();
            });
            document.body.appendChild(input);
            input.click();
          });
          tile.tile.appendChild(btn);
          tile.uploadBtn = btn;
        }
      } else {
        if (tile.uploadBtn) {
          tile.uploadBtn.remove();
          tile.uploadBtn = null;
        }
        tile.tile.classList.remove("is-drop-target");
        tile.dropHint.hidden = true;
      }
    }
  }

  function onFocusCamera(e) {
    const id = e.detail?.cameraId;
    if (!id || !WALL_CAMERA_IDS.includes(id)) return;
    layoutCtl.swapMain(id);
    const inc = activeIncidentForCamera(store.getState(), id);
    if (inc) actions.select(inc.incident_id);
  }
  document.addEventListener(FOCUS_CAMERA_EVENT, onFocusCamera);

  function resizeCanvas(tile) {
    const canvas = tile.canvas;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      tile.dirty = true;
    }
  }

  function drawTile(tile) {
    resizeCanvas(tile);
    const { ctx, canvas, boxes, highlightTrack, severity } = tile;
    const c = themeColors();
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const hasFootage = tile.hasLocalVideo || tile.hasStream;
    if (!hasFootage) {
      // Opaque dark feed well — shell behind the wall is white.
      ctx.fillStyle = c.feedWell || c.bgDeep || "#1a1a1c";
      ctx.fillRect(0, 0, w, h);
    }

    const drawBoxes =
      cameraSources.getShowOverlays() && Array.isArray(boxes) && boxes.length;
    if (!drawBoxes) {
      tile.dirty = false;
      return;
    }

    const placed = [];
    for (const box of boxes) {
      const r = toPanePx(box, w, h);
      const severeHit =
        severity === "SEVERE" &&
        highlightTrack &&
        box.track_id === highlightTrack;
      const color = severeHit
        ? c.severe
        : severity === "MINOR"
          ? c.minor
          : c.aqua;

      const x = r.x;
      const y = r.y;
      const bw = Math.max(4, r.w);
      const bh = Math.max(4, r.h);
      drawCornerBox(ctx, x, y, bw, bh, color);

      const label = personLabel(box.track_id);
      ctx.font = "500 10px ui-monospace, Menlo, Consolas, monospace";
      const padX = 4;
      const tw = ctx.measureText(label).width;
      const tagW = tw + padX * 2;
      const tagH = 14;
      let tagX = x;
      let tagY = y - tagH;
      if (tagY < 2) tagY = y;
      let tries = 0;
      while (
        tries < 6 &&
        placed.some(
          (p) =>
            !(
              tagX + tagW < p.x ||
              p.x + p.w < tagX ||
              tagY + tagH < p.y ||
              p.y + p.h < tagY
            ),
        )
      ) {
        tagX += 8;
        tagY += tries % 2 === 0 ? tagH + 1 : -(tagH + 1);
        tries += 1;
      }
      if (tagX + tagW > w - 2) tagX = Math.max(2, w - tagW - 2);
      if (tagY < 2) tagY = 2;
      if (tagY + tagH > h - 2) tagY = h - tagH - 2;
      placed.push({ x: tagX, y: tagY, w: tagW, h: tagH });
      if (severeHit) {
        ctx.fillStyle = c.severe;
        ctx.fillRect(tagX, tagY, tagW, tagH);
        ctx.fillStyle = c.text;
      } else {
        ctx.fillStyle = c.aquaBg;
        ctx.fillRect(tagX, tagY, tagW, tagH);
        ctx.strokeStyle = c.aquaBorder;
        ctx.lineWidth = 1;
        ctx.strokeRect(tagX + 0.5, tagY + 0.5, tagW - 1, tagH - 1);
        ctx.fillStyle = c.aqua;
      }
      ctx.textBaseline = "middle";
      ctx.fillText(label, tagX + padX, tagY + tagH / 2 + 0.5);
    }
    tile.dirty = false;
  }

  function scheduleDraw() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      for (const tile of tiles.values()) {
        if (tile.dirty) drawTile(tile);
      }
    });
  }

  /** Always-visible report flag for a main camera's incident bar. */
  function barFlag(cameraId) {
    const b = el("button", {
      type: "button",
      className: "btn btn--ghost btn--icon btn--sm cam-inc-bar__flag",
      attrs: {
        "aria-label": `Report incident on ${cameraLabel(cameraId)}`,
        title: `Report incident on ${cameraLabel(cameraId)}`,
      },
      onClick: (e) => {
        e.stopPropagation();
        document.dispatchEvent(
          new CustomEvent(OP_REPORT_EVENT, { detail: { cameraId, anchor: b } }),
        );
      },
    });
    b.appendChild(icon("flag"));
    return b;
  }

  /** cameraId → [hold, incident] last painted; applyLayout runs every notify. */
  const headerSig = new Map();

  function paintHeader(cameraId, mainMeta, state) {
    const header = headers.get(cameraId);
    if (!header) return;
    const wrap = tiles.get(cameraId)?.wrap;
    const inc = mainMeta?.incidentId ? state.incidents[mainMeta.incidentId] : null;
    const sig = mainMeta ? [mainMeta.hold || "", inc] : null;
    const prev = headerSig.get(cameraId);
    // Rebuilding every frame would swallow clicks on Details and the flag.
    if (sig && prev && sig[0] === prev[0] && sig[1] === prev[1]) return;
    if (!sig && !prev) return;
    headerSig.set(cameraId, sig);

    if (!mainMeta) {
      header.hidden = true;
      wrap?.classList.remove("has-bar");
      clear(header);
      headerAgo.delete(cameraId);
      return;
    }
    header.hidden = false;
    wrap?.classList.add("has-bar");
    clear(header);
    headerAgo.delete(cameraId);

    if (mainMeta.hold) {
      header.appendChild(
        el("span", {
          className: "cam-inc-bar__chip",
          text: mainMeta.hold === "RESOLVED" ? "Resolved" : "Dismissed",
        }),
      );
      const flag = barFlag(cameraId);
      flag.classList.add("cam-inc-bar__flag--end");
      header.appendChild(flag);
      return;
    }
    if (!inc) {
      header.hidden = true;
      wrap?.classList.remove("has-bar");
      return;
    }

    header.className = `cam-inc-bar cam-inc-bar--${inc.severity || "NONE"}`;
    header.appendChild(
      el("span", {
        className: "cam-inc-bar__type",
        text: classLabel(inc.class_token),
      }),
    );
    header.appendChild(
      el("span", {
        className: "cam-inc-bar__sev",
        text: severityLabel(inc.severity),
      }),
    );
    header.appendChild(
      el("span", {
        className: "cam-inc-bar__state",
        text: stateLabel(inc.state),
      }),
    );
    header.appendChild(
      el("span", {
        className: "cam-inc-bar__cam",
        text: cameraLabel(inc.camera_id),
      }),
    );
    const agoEl = el("span", { className: "cam-inc-bar__ago mono" });
    const agoIso = inc.created_at || inc.peak_ts;
    setText(agoEl, formatRel(agoIso, now()));
    headerAgo.set(cameraId, { node: agoEl, iso: agoIso });
    header.appendChild(agoEl);
    const flag = barFlag(cameraId);
    flag.classList.add("cam-inc-bar__flag--end");
    header.appendChild(flag);
    header.appendChild(
      el("button", {
        type: "button",
        className: "btn btn--ghost cam-inc-bar__details",
        text: "Details",
        onClick: (e) => {
          e.stopPropagation();
          actions.select(inc.incident_id);
          document.dispatchEvent(
            new CustomEvent(OPEN_SIDEBAR_EVENT, {
              detail: { tab: "incidents", incidentId: inc.incident_id },
            }),
          );
        },
      }),
    );
  }

  const livePage = root.closest('[data-page="live"]');

  function applyLayout(state) {
    const plan = layoutCtl.plan(state);
    // The one place the Live mode is set: incident while plan() has a main
    // camera (auto or manual focus), watch otherwise. Set before measuring
    // the stage so the geometry uses the new column layout.
    const liveMode = plan.mains.length ? "incident" : "watch";
    let modeChanged = false;
    if (livePage && livePage.dataset.mode !== liveMode) {
      livePage.dataset.mode = liveMode;
      modeChanged = true;
      document.dispatchEvent(new CustomEvent(LIVE_MODE_EVENT, { detail: { mode: liveMode } }));
    }
    const stageRect = stage.getBoundingClientRect();
    const sw = Math.max(1, stageRect.width);
    const sh = Math.max(1, stageRect.height);
    const geo = layoutCtl.geometry(plan, sw, sh, window.innerWidth, {
      ring: Boolean(livePage),
    });
    const { rects, ease } = geo;
    // Ring ↔ incident is the slower move; other changes keep the default.
    const duration =
      modeChanged && !geo.reduced ? layoutCtl.RING_MOVE_MS : geo.duration;

    const key = `${plan.mode}|${plan.mains.map((m) => m.cameraId).join(",")}|${plan.thumbs.join(",")}|${Math.round(sw)}x${Math.round(sh)}|${layoutCtl.isAuto()}`;
    const animating = key !== lastPlanKey;
    lastPlanKey = key;

    root.dataset.layout = plan.mode;
    // "All cameras" only when the wall is not already the grid.
    allCamsBtn.hidden = plan.mode === "grid";

    const mainByCam = new Map(plan.mains.map((m) => [m.cameraId, m]));

    for (const id of WALL_CAMERA_IDS) {
      const tile = tiles.get(id);
      const r = rects.get(id);
      if (!r) continue;
      const wrap = tile.wrap;
      wrap.style.transition = animating
        ? `left ${duration}ms ${ease}, top ${duration}ms ${ease}, width ${duration}ms ${ease}, height ${duration}ms ${ease}`
        : "none";
      wrap.style.left = `${r.x}px`;
      wrap.style.top = `${Math.max(0, r.y - (r.role === "main" ? r.headerH : 0))}px`;
      wrap.style.width = `${r.w}px`;
      wrap.style.height = `${r.h + (r.role === "main" ? r.headerH : 0)}px`;
      wrap.classList.toggle("cam-slot--main", r.role === "main");
      wrap.classList.toggle("cam-slot--thumb", r.role === "thumb");
      wrap.classList.toggle("cam-slot--grid", r.role === "grid");
      // Too narrow for "Camera N", the flag and REC side by side.
      wrap.classList.toggle("is-narrow", r.w < 200);
      tile.tile.classList.toggle("is-thumb", r.role === "thumb");
      paintHeader(id, mainByCam.get(id) || null, state);
      tile.dirty = true;

      const leftUntil = plan.leftNotes.get(id);
      tile.leftNote.hidden = !(leftUntil && leftUntil > now());
    }
    stage.classList.toggle("is-ring", Boolean(geo.ring));

    if (livePage && animating) {
      document.dispatchEvent(
        new CustomEvent(LIVE_RING_EVENT, {
          detail: { mode: liveMode, ring: geo.ring || null, rects, duration, stage },
        }),
      );
    }

    if (plan.moreCount > 0) {
      moreEl.hidden = false;
      clear(moreEl);
      moreEl.appendChild(
        el("button", {
          type: "button",
          className: "camwall__more-chip",
          text: `+${plan.moreCount} more incident${plan.moreCount === 1 ? "" : "s"}`,
          onClick: () => {
            document.dispatchEvent(
              new CustomEvent(MORE_INCIDENTS_EVENT, { detail: {} }),
            );
          },
        }),
      );
    } else {
      moreEl.hidden = true;
      clear(moreEl);
    }

    scheduleDraw();
  }

  function paintTimes(nowMs = now()) {
    const state = store.getState();
    const clock = formatOsdClock(nowMs);
    for (const id of WALL_CAMERA_IDS) {
      const { online } = cameraStatus(state, id, nowMs);
      setText(tiles.get(id).clockEl, online ? clock : "");
    }
    for (const { node, iso } of headerAgo.values()) {
      setText(node, formatRel(iso, nowMs));
    }
    // Holds, the 5 s return to grid and "left view" notes expire with time,
    // not with events — re-apply the layout only when the plan changes.
    const plan = layoutCtl.plan(state);
    const key = [
      plan.mode,
      plan.mains.map((m) => `${m.cameraId}:${m.hold || ""}`).join(","),
      [...plan.leftNotes.keys()].join(","),
    ].join("|");
    if (key !== lastTickPlanKey) {
      lastTickPlanKey = key;
      applyLayout(state);
    }
  }
  let lastTickPlanKey = "";

  function applyChrome(state) {
    const clock = formatOsdClock(now());

    for (const id of WALL_CAMERA_IDS) {
      const cam = state.cameras[id] || { online: false, boxes: [] };
      const tile = tiles.get(id);
      const st = cameraStatus(state, id);
      const online = st.online;

      const local = cameraSources.get(id);
      const hasLocal = local && local.status === "ready" && local.url;
      const stream = !hasLocal ? streamFor(id, state) : null;
      const mjpeg = stream?.kind === "mjpeg" ? stream.url : null;
      tile.hasLocalVideo = Boolean(hasLocal);
      tile.hasStream = Boolean(stream);
      if (mjpeg) {
        if (tile.streamImg.getAttribute("src") !== mjpeg) {
          // New or replaced stream: down until its first frame loads.
          cancelStreamRetry(id);
          noteStream(id, false);
          tile.streamImg.setAttribute("src", mjpeg);
        }
        tile.streamImg.hidden = false;
        tile.noise.hidden = true;
      } else {
        if (tile.streamImg.hasAttribute("src")) {
          cancelStreamRetry(id);
          noteStream(id, false);
          tile.streamImg.removeAttribute("src");
        }
        tile.streamImg.hidden = true;
        if (!hasLocal) tile.noise.hidden = false;
      }

      tile.tile.classList.toggle("is-offline", !online);
      tile.offlineEl.hidden = online;
      setText(tile.offlineEl, st.key === "connecting" ? "Connecting" : "No signal");
      tile.recDot.hidden = !online;
      // Offline: one centred "No signal"; the footer shows time only when live.
      setText(tile.clockEl, online ? clock : "");

      const boxes = Array.isArray(cam.boxes) ? cam.boxes : [];
      if (!boxesEqual(tile.boxes, boxes)) {
        tile.boxes = boxes;
        tile.dirty = true;
      } else if (!cameraSources.getShowOverlays()) {
        tile.dirty = true;
      }

      const inc = st.inc;
      tile.tile.classList.remove("is-minor", "is-severe");
      if (!online) {
        tile.severity = null;
        tile.highlightTrack = null;
        tile.chipEl.hidden = true;
      } else if (inc?.severity === "SEVERE") {
        tile.tile.classList.add("is-severe");
        tile.severity = "SEVERE";
        tile.highlightTrack = inc.track_id ?? null;
        tile.chipEl.hidden = false;
        setText(
          tile.chipEl,
          `${classLabel(inc.class_token)} ${confidenceShort(inc)}`,
        );
        tile.chipEl.className = "cam-tile__chip cam-tile__chip--severe";
        tile.dirty = true;
      } else if (inc?.severity === "MINOR") {
        tile.tile.classList.add("is-minor");
        tile.severity = "MINOR";
        tile.highlightTrack = null;
        tile.chipEl.hidden = false;
        setText(
          tile.chipEl,
          `${classLabel(inc.class_token)} ${confidenceShort(inc)}`,
        );
        tile.chipEl.className = "cam-tile__chip cam-tile__chip--minor";
        tile.dirty = true;
      } else {
        if (tile.severity != null) tile.dirty = true;
        tile.severity = null;
        tile.highlightTrack = null;
        tile.chipEl.hidden = true;
      }
    }
    setText(countEl, `${onlineCount(state, WALL_CAMERA_IDS)}/${WALL_CAMERA_IDS.length} online`);
    applyLayout(state);
  }

  applyChrome(store.getState());
  const unsub = store.subscribe(applyChrome);
  const unsubLayout = layoutCtl.subscribe(() => applyChrome(store.getState()));
  const unsubTick = subscribeTick(paintTimes);
  // Relayout on the next frame: a Live mode switch inside applyLayout
  // resizes the stage again, which would otherwise loop within one frame.
  let roRaf = 0;
  const ro = new ResizeObserver(() => {
    if (roRaf) return;
    roRaf = requestAnimationFrame(() => {
      roRaf = 0;
      lastPlanKey = "";
      applyLayout(store.getState());
    });
  });
  ro.observe(stage);

  window.__cameraLayout = layoutCtl;

  syncVideoSources();
  syncEditChrome();
  const unsubSources = cameraSources.subscribe(() => {
    syncVideoSources();
    syncEditChrome();
    for (const tile of tiles.values()) tile.dirty = true;
    scheduleDraw();
  });

  return {
    layout: layoutCtl,
    destroy() {
      unsub();
      unsubLayout();
      unsubSources();
      document.removeEventListener(FOCUS_CAMERA_EVENT, onFocusCamera);
      ro.disconnect();
      if (roRaf) cancelAnimationFrame(roRaf);
      if (raf) cancelAnimationFrame(raf);
      unsubTick();
      for (const id of [...streamRetry.keys()]) cancelStreamRetry(id);
    },
  };
}
