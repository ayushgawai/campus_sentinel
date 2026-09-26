/**
 * Per-camera local demo video sources (browser-only blob URLs).
 * Never uploads; never writes into the repo.
 */

import { WALL_CAMERA_IDS } from "./site.js?v=pro7";

const DB_NAME = "sentinel-demo";
const DB_STORE = "camera-sources";
const DB_VERSION = 1;
const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB
const ACCEPT_EXT = /\.(mp4|webm|mov)$/i;
const ACCEPT_MIME = /^(video\/mp4|video\/webm|video\/quicktime)(;.*)?$/i;

/** @typedef {{
 *   cameraId: string,
 *   name: string,
 *   url: string,
 *   blob: Blob,
 *   offset: number,
 *   duration: number|null,
 *   thumbUrl: string|null,
 *   status: 'loading'|'ready'|'error',
 *   error: string|null,
 * }} CameraSource */

/** @type {Map<string, CameraSource>} */
const sources = new Map();
/** @type {Set<() => void>} */
const listeners = new Set();

let showOverlays = true;
let editMode = false;
let storageNote = null; // quiet note when IDB unavailable
let hydrated = false;

function notify() {
  for (const fn of listeners) {
    try {
      fn();
    } catch (err) {
      console.warn("[cameraSources] subscriber error", err);
    }
  }
}

function revokeUrl(url) {
  if (url) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
}

function isAcceptedFile(file) {
  if (!file) return false;
  if (file.type && ACCEPT_MIME.test(file.type)) return true;
  return ACCEPT_EXT.test(file.name || "");
}

function canPlayInBrowser(file) {
  const v = document.createElement("video");
  const type = file.type || guessMime(file.name);
  if (!type) return true; // defer to metadata/error
  const r = v.canPlayType(type);
  return r === "probably" || r === "maybe";
}

function guessMime(name) {
  const n = String(name || "").toLowerCase();
  if (n.endsWith(".mp4")) return "video/mp4";
  if (n.endsWith(".webm")) return "video/webm";
  if (n.endsWith(".mov")) return "video/quicktime";
  return "";
}

function openDb() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error || new Error("idb open failed"));
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE, { keyPath: "cameraId" });
        }
      };
      req.onsuccess = () => resolve(req.result);
    } catch (err) {
      reject(err);
    }
  });
}

async function idbPut(record) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(DB_STORE).put(record);
    });
    db.close();
  } catch (err) {
    storageNote = "Browser storage unavailable. Videos stay for this session only.";
    console.warn("[cameraSources] idb put failed", err);
  }
}

async function idbDelete(cameraId) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(DB_STORE).delete(cameraId);
    });
    db.close();
  } catch (err) {
    storageNote = "Browser storage unavailable. Videos stay for this session only.";
    console.warn("[cameraSources] idb delete failed", err);
  }
}

async function idbClear() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(DB_STORE).clear();
    });
    db.close();
  } catch (err) {
    storageNote = "Browser storage unavailable. Videos stay for this session only.";
    console.warn("[cameraSources] idb clear failed", err);
  }
}

async function idbGetAll() {
  try {
    const db = await openDb();
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows;
  } catch (err) {
    storageNote = "Browser storage unavailable. Videos stay for this session only.";
    console.warn("[cameraSources] idb read failed", err);
    return [];
  }
}

function captureThumb(video) {
  try {
    const w = Math.min(160, video.videoWidth || 160);
    const h = Math.round(
      w * ((video.videoHeight || 90) / (video.videoWidth || 160)),
    );
    const c = document.createElement("canvas");
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    const ctx = c.getContext("2d");
    ctx.drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.72);
  } catch {
    return null;
  }
}

function probeMedia(url, file) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    let settled = false;

    const done = (result) => {
      if (settled) return;
      settled = true;
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const timer = window.setTimeout(() => {
      done({
        ok: false,
        error: "This format can't be played in this browser. Use MP4 (H.264).",
      });
    }, 12000);

    video.addEventListener("loadedmetadata", () => {
      window.clearTimeout(timer);
      const duration =
        Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : null;
      // Seek slightly in for a useful thumb
      const seekTo = Math.min(0.25, Math.max(0, (duration || 1) * 0.05));
      const finish = () => {
        const thumbUrl = captureThumb(video);
        done({ ok: true, duration, thumbUrl });
      };
      if (seekTo > 0) {
        const onSeek = () => {
          video.removeEventListener("seeked", onSeek);
          finish();
        };
        video.addEventListener("seeked", onSeek);
        try {
          video.currentTime = seekTo;
        } catch {
          finish();
        }
      } else {
        finish();
      }
    });

    video.addEventListener("error", () => {
      window.clearTimeout(timer);
      done({
        ok: false,
        error: "This format can't be played in this browser. Use MP4 (H.264).",
      });
    });

    if (!canPlayInBrowser(file)) {
      window.clearTimeout(timer);
      done({
        ok: false,
        error: "This format can't be played in this browser. Use MP4 (H.264).",
      });
      return;
    }

    video.src = url;
  });
}

function removeEntry(cameraId, { persist = true } = {}) {
  const prev = sources.get(cameraId);
  if (!prev) return;
  revokeUrl(prev.url);
  sources.delete(cameraId);
  if (persist) idbDelete(cameraId);
}

/**
 * Assign a local File/Blob to a camera.
 * @param {string} cameraId
 * @param {File|Blob} file
 * @param {{ offset?: number, name?: string, persist?: boolean }} [opts]
 */
export async function assign(cameraId, file, opts = {}) {
  if (!WALL_CAMERA_IDS.includes(cameraId)) {
    return { ok: false, error: "Unknown camera." };
  }
  if (!file) return { ok: false, error: "No file selected." };
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "File is over 1 GB. Choose a smaller video." };
  }
  const name = opts.name || (file instanceof File ? file.name : "video");
  if (!isAcceptedFile({ name, type: file.type })) {
    return {
      ok: false,
      error: "This format can't be played in this browser. Use MP4 (H.264).",
    };
  }

  removeEntry(cameraId, { persist: false });

  const url = URL.createObjectURL(file);
  const offset = Math.max(0, Number(opts.offset) || 0);
  /** @type {CameraSource} */
  const entry = {
    cameraId,
    name,
    url,
    blob: file,
    offset,
    duration: null,
    thumbUrl: null,
    status: "loading",
    error: null,
  };
  sources.set(cameraId, entry);
  notify();

  const probed = await probeMedia(url, file);
  const cur = sources.get(cameraId);
  if (!cur || cur.url !== url) {
    // replaced while probing
    revokeUrl(url);
    return { ok: false, error: "Replaced." };
  }

  if (!probed.ok) {
    revokeUrl(url);
    sources.set(cameraId, {
      ...cur,
      url: "",
      status: "error",
      error: probed.error,
      thumbUrl: null,
      duration: null,
    });
    notify();
    return { ok: false, error: probed.error };
  }

  cur.status = "ready";
  cur.duration = probed.duration;
  cur.thumbUrl = probed.thumbUrl;
  cur.error = null;
  sources.set(cameraId, cur);
  notify();

  if (opts.persist !== false) {
    await idbPut({
      cameraId,
      name,
      offset: cur.offset,
      blob: file,
      mime: file.type || guessMime(name),
    });
  }
  return { ok: true };
}

export function clear(cameraId) {
  removeEntry(cameraId, { persist: true });
  notify();
}

export async function clearAll() {
  for (const id of [...sources.keys()]) {
    removeEntry(id, { persist: false });
  }
  await idbClear();
  notify();
}

export function get(cameraId) {
  return sources.get(cameraId) || null;
}

export function getAll() {
  return WALL_CAMERA_IDS.map((id) => get(id));
}

export function setOffset(cameraId, seconds) {
  const cur = sources.get(cameraId);
  if (!cur || cur.status !== "ready") return;
  cur.offset = Math.max(0, Number(seconds) || 0);
  if (cur.duration != null) {
    cur.offset = Math.min(cur.offset, Math.max(0, cur.duration - 0.05));
  }
  sources.set(cameraId, cur);
  notify();
  idbPut({
    cameraId,
    name: cur.name,
    offset: cur.offset,
    blob: cur.blob,
    mime: cur.blob.type || guessMime(cur.name),
  });
}

export function getShowOverlays() {
  return showOverlays;
}

export function setShowOverlays(on) {
  showOverlays = Boolean(on);
  try {
    localStorage.setItem("sentinel-demo-overlays", showOverlays ? "1" : "0");
  } catch {
    /* ignore */
  }
  notify();
}

export function getEditMode() {
  return editMode;
}

export function setEditMode(on) {
  editMode = Boolean(on);
  notify();
}

export function getStorageNote() {
  return storageNote;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Seek every ready video element to its start offset and play. */
export function restartAll(videoEls) {
  const map = videoEls || window.__cameraVideos;
  if (!map || typeof map.get !== "function") return;
  for (const id of WALL_CAMERA_IDS) {
    const src = sources.get(id);
    const video = map.get(id);
    if (!video) continue;
    try {
      const off = src?.status === "ready" ? src.offset || 0 : 0;
      const apply = () => {
        try {
          video.currentTime = off;
        } catch {
          /* ignore */
        }
        const p = video.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      };
      if (video.readyState >= 1) apply();
      else video.addEventListener("loadedmetadata", apply, { once: true });
    } catch {
      /* ignore */
    }
  }
  const streams = window.__cameraStreams;
  if (!streams || typeof streams.values !== "function") return;
  for (const img of streams.values()) {
    const src = img.getAttribute?.("src") || img.src;
    if (!src) continue;
    img.removeAttribute("src");
    img.setAttribute("src", src);
  }
}

export function pauseAll(videoEls) {
  const map = videoEls || window.__cameraVideos;
  if (!map || typeof map.get !== "function") return;
  for (const video of map.values()) {
    try {
      video.pause();
    } catch {
      /* ignore */
    }
  }
}

export function playAll(videoEls) {
  const map = videoEls || window.__cameraVideos;
  if (!map || typeof map.get !== "function") return;
  for (const id of WALL_CAMERA_IDS) {
    const src = sources.get(id);
    const video = map.get(id);
    if (!src || src.status !== "ready" || !video) continue;
    const p = video.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }
}

export function setPlaybackRate(rate, videoEls) {
  const map = videoEls || window.__cameraVideos;
  if (!map || typeof map.get !== "function") return;
  const r = Number(rate) || 1;
  for (const video of map.values()) {
    try {
      video.playbackRate = r;
    } catch {
      /* ignore */
    }
  }
}

/** Align videos to demo timeline t (seconds from demo start). */
export function seekAllToDemoT(t, videoEls) {
  const map = videoEls || window.__cameraVideos;
  if (!map || typeof map.get !== "function") return;
  const demoT = Math.max(0, Number(t) || 0);
  for (const id of WALL_CAMERA_IDS) {
    const src = sources.get(id);
    const video = map.get(id);
    if (!src || src.status !== "ready" || !video) continue;
    const dur = src.duration;
    let target = (src.offset || 0) + demoT;
    if (dur && dur > 0) {
      const span = dur - (src.offset || 0);
      if (span > 0.05) {
        target = (src.offset || 0) + (demoT % span);
      } else {
        target = src.offset || 0;
      }
    }
    try {
      video.currentTime = Math.max(0, target);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Load six files sorted by name → Camera 1..N.
 * @param {FileList|File[]} files
 */
export async function assignMany(files) {
  const list = [...files].filter(Boolean);
  list.sort((a, b) =>
    String(a.name).localeCompare(String(b.name), undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
  const results = [];
  const n = Math.min(6, list.length);
  for (let i = 0; i < n; i++) {
    results.push(await assign(WALL_CAMERA_IDS[i], list[i]));
  }
  return results;
}

/** Restore from IndexedDB once per session. */
export async function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const flag = localStorage.getItem("sentinel-demo-overlays");
    if (flag === "0") showOverlays = false;
    if (flag === "1") showOverlays = true;
  } catch {
    /* ignore */
  }
  const rows = await idbGetAll();
  for (const row of rows) {
    if (!row?.cameraId || !row.blob) continue;
    if (!WALL_CAMERA_IDS.includes(row.cameraId)) continue;
    await assign(row.cameraId, row.blob, {
      name: row.name || "video",
      offset: row.offset || 0,
      persist: false,
    });
  }
  notify();
}

export const ACCEPT_ATTR = "video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov";
export const MAX_FILE_BYTES = MAX_BYTES;
