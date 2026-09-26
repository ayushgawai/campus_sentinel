/**
 * Mock-only: looping 8s clip ending at incident time from a loaded camera video.
 */

import * as cameraSources from "../cameraSources.js?v=pro3";
import { mockSecondsFromIso } from "../clock.js?v=pro3";

/**
 * @param {HTMLElement} host
 * @param {{ cameraId: string, endTs: string|number|null, demoT?: number }} opts
 * @returns {() => void} cleanup
 */
export function mountIncidentClip(host, opts) {
  const { cameraId, endTs, demoT } = opts;
  host.replaceChildren();
  host.classList.add("detail__clip");

  const src = cameraSources.get(cameraId);
  if (!src || src.status !== "ready" || !src.url) {
    return () => {};
  }

  let endDemoSec = Number(demoT);
  if (!Number.isFinite(endDemoSec)) {
    const iso = typeof endTs === "number" ? new Date(endTs).toISOString() : String(endTs || "");
    endDemoSec = mockSecondsFromIso(iso);
  }

  const offset = src.offset || 0;
  const dur = src.duration;
  let end = offset + endDemoSec;
  if (dur != null && Number.isFinite(dur)) {
    end = Math.min(Math.max(offset, end), dur);
  }
  let start = Math.max(offset, end - 8);
  if (end - start < 0.4) {
    start = Math.max(offset, end - 0.4);
  }

  const video = document.createElement("video");
  video.className = "detail__clip-video";
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.preload = "auto";
  video.loop = false;
  video.src = src.url;

  const onMeta = () => {
    try {
      video.currentTime = start;
    } catch {
      /* ignore */
    }
    const p = video.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  };
  video.addEventListener("loadedmetadata", onMeta, { once: true });

  const onTime = () => {
    if (video.currentTime >= end - 0.05 || video.ended) {
      try {
        video.currentTime = start;
      } catch {
        /* ignore */
      }
      const p = video.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
  };
  video.addEventListener("timeupdate", onTime);
  video.addEventListener("ended", onTime);

  host.appendChild(video);

  return () => {
    video.removeEventListener("timeupdate", onTime);
    video.removeEventListener("ended", onTime);
    video.removeAttribute("src");
    try {
      video.load();
    } catch {
      /* ignore */
    }
    host.replaceChildren();
  };
}
