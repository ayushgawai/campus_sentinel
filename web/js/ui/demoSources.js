/**
 * Demo control — Camera sources rows (local blob videos).
 */

import { WALL_CAMERA_IDS, cameraLabel } from "../site.js";
import { clear, el, setText } from "../dom.js";
import * as cameraSources from "../cameraSources.js";

function formatDur(sec) {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "—";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * @param {HTMLElement} host
 * @param {{ onEditModeChange?: (on: boolean) => void }} [opts]
 */
export function mountDemoCameraSources(host, opts = {}) {
  clear(host);
  host.className = "demo__section demo__sources";

  host.appendChild(
    el("div", { className: "demo__label", text: "Camera sources" }),
  );
  host.appendChild(
    el("p", {
      className: "demo__hint",
      text: "Local playback for demo recording. Not processed by the pipeline.",
    }),
  );
  host.appendChild(
    el("p", {
      className: "demo__hint",
      text: "Stored in this browser only.",
    }),
  );

  const noteEl = el("p", { className: "demo__hint demo__sources-note" });
  noteEl.hidden = true;
  host.appendChild(noteEl);

  const tools = el("div", { className: "demo__sources-tools" });
  const loadSixBtn = el("button", {
    type: "button",
    className: "btn btn--secondary",
    text: "Load six videos",
  });
  const removeAllBtn = el("button", {
    type: "button",
    className: "btn btn--secondary",
    text: "Remove all",
  });
  const confirmAllBtn = el("button", {
    type: "button",
    className: "btn btn--danger",
    text: "Confirm remove all",
  });
  confirmAllBtn.hidden = true;
  tools.appendChild(loadSixBtn);
  tools.appendChild(removeAllBtn);
  tools.appendChild(confirmAllBtn);
  host.appendChild(tools);

  const editRow = el("label", { className: "demo__toggle" });
  const editCk = document.createElement("input");
  editCk.type = "checkbox";
  editCk.dataset.editSources = "1";
  editRow.appendChild(editCk);
  editRow.appendChild(document.createTextNode(" Edit camera sources"));
  host.appendChild(editRow);

  const overlayRow = el("label", { className: "demo__toggle" });
  const overlayCk = document.createElement("input");
  overlayCk.type = "checkbox";
  overlayCk.checked = cameraSources.getShowOverlays();
  overlayRow.appendChild(overlayCk);
  overlayRow.appendChild(
    document.createTextNode(" Show detection overlays on loaded videos"),
  );
  host.appendChild(overlayRow);

  const list = el("div", { className: "demo__sources-list" });
  host.appendChild(list);

  /** @type {Map<string, HTMLElement>} */
  const rows = new Map();

  for (const id of WALL_CAMERA_IDS) {
    const row = el("div", { className: "demo-src" });
    row.dataset.cameraId = id;

    const thumb = el("div", { className: "demo-src__thumb" });
    const img = document.createElement("img");
    img.alt = "";
    img.hidden = true;
    thumb.appendChild(img);
    const thumbEmpty = el("span", {
      className: "demo-src__thumb-empty",
      text: "—",
    });
    thumb.appendChild(thumbEmpty);

    const meta = el("div", { className: "demo-src__meta" });
    meta.appendChild(
      el("div", { className: "demo-src__cam", text: cameraLabel(id) }),
    );
    const nameEl = el("div", { className: "demo-src__name" });
    nameEl.textContent = "No video";
    meta.appendChild(nameEl);
    const durEl = el("div", { className: "demo-src__dur mono", text: "—" });
    meta.appendChild(durEl);

    const offsetWrap = el("label", { className: "demo-src__offset" });
    offsetWrap.appendChild(document.createTextNode("Start "));
    const offsetInput = document.createElement("input");
    offsetInput.type = "number";
    offsetInput.min = "0";
    offsetInput.step = "0.1";
    offsetInput.value = "0";
    offsetInput.className = "demo-src__offset-input";
    offsetInput.setAttribute("aria-label", `Start offset for ${cameraLabel(id)}`);
    offsetWrap.appendChild(offsetInput);
    offsetWrap.appendChild(document.createTextNode(" s"));

    const msg = el("div", { className: "demo-src__msg" });
    msg.hidden = true;

    const actions = el("div", { className: "demo-src__actions" });
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = cameraSources.ACCEPT_ATTR;
    fileInput.hidden = true;
    const upBtn = el("button", {
      type: "button",
      className: "btn btn--secondary",
      text: "Upload",
    });
    const rmBtn = el("button", {
      type: "button",
      className: "btn btn--ghost",
      text: "Remove",
    });
    actions.appendChild(fileInput);
    actions.appendChild(upBtn);
    actions.appendChild(rmBtn);

    row.appendChild(thumb);
    row.appendChild(meta);
    row.appendChild(offsetWrap);
    row.appendChild(actions);
    row.appendChild(msg);
    list.appendChild(row);
    rows.set(id, row);

    upBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (!file) return;
      setText(msg, "Loading…");
      msg.hidden = false;
      msg.classList.remove("is-error");
      const res = await cameraSources.assign(id, file);
      if (!res.ok && res.error !== "Replaced.") {
        setText(msg, res.error || "Could not load video.");
        msg.classList.add("is-error");
        msg.hidden = false;
      }
    });
    rmBtn.addEventListener("click", () => cameraSources.clear(id));
    offsetInput.addEventListener("change", () => {
      cameraSources.setOffset(id, Number(offsetInput.value));
    });
  }

  const multiInput = document.createElement("input");
  multiInput.type = "file";
  multiInput.accept = cameraSources.ACCEPT_ATTR;
  multiInput.multiple = true;
  multiInput.hidden = true;
  host.appendChild(multiInput);

  loadSixBtn.addEventListener("click", () => multiInput.click());
  multiInput.addEventListener("change", async () => {
    const files = multiInput.files;
    multiInput.value = "";
    if (!files?.length) return;
    await cameraSources.assignMany(files);
  });

  removeAllBtn.addEventListener("click", () => {
    confirmAllBtn.hidden = false;
    removeAllBtn.hidden = true;
  });
  confirmAllBtn.addEventListener("click", async () => {
    await cameraSources.clearAll();
    confirmAllBtn.hidden = true;
    removeAllBtn.hidden = false;
  });

  editCk.addEventListener("change", () => {
    cameraSources.setEditMode(editCk.checked);
    opts.onEditModeChange?.(editCk.checked);
  });
  overlayCk.addEventListener("change", () => {
    cameraSources.setShowOverlays(overlayCk.checked);
  });

  function paintRow(id) {
    const row = rows.get(id);
    if (!row) return;
    const src = cameraSources.get(id);
    const img = row.querySelector(".demo-src__thumb img");
    const empty = row.querySelector(".demo-src__thumb-empty");
    const nameEl = row.querySelector(".demo-src__name");
    const durEl = row.querySelector(".demo-src__dur");
    const offsetInput = row.querySelector(".demo-src__offset-input");
    const upBtn = row.querySelector(".demo-src__actions .btn--secondary");
    const msg = row.querySelector(".demo-src__msg");
    const rmBtn = row.querySelector(".demo-src__actions .btn--ghost");

    if (!src) {
      img.hidden = true;
      img.removeAttribute("src");
      empty.hidden = false;
      setText(nameEl, "No video");
      nameEl.removeAttribute("title");
      setText(durEl, "—");
      offsetInput.value = "0";
      offsetInput.disabled = true;
      setText(upBtn, "Upload");
      rmBtn.disabled = true;
      if (!msg.classList.contains("is-error") || !msg.textContent) {
        msg.hidden = true;
      }
      return;
    }

    rmBtn.disabled = false;
    offsetInput.disabled = src.status !== "ready";
    offsetInput.value = String(src.offset ?? 0);
    setText(upBtn, "Replace");
    setText(nameEl, src.name || "video");
    nameEl.title = src.name || "";

    if (src.status === "loading") {
      setText(msg, "Loading…");
      msg.classList.remove("is-error");
      msg.hidden = false;
      empty.hidden = false;
      img.hidden = true;
      setText(durEl, "—");
      return;
    }

    if (src.status === "error") {
      setText(msg, src.error || "Could not load video.");
      msg.classList.add("is-error");
      msg.hidden = false;
      empty.hidden = false;
      img.hidden = true;
      setText(durEl, "—");
      return;
    }

    msg.hidden = true;
    msg.classList.remove("is-error");
    setText(durEl, formatDur(src.duration));
    if (src.thumbUrl) {
      img.src = src.thumbUrl;
      img.hidden = false;
      empty.hidden = true;
    } else {
      img.hidden = true;
      empty.hidden = false;
    }
  }

  function paint() {
    for (const id of WALL_CAMERA_IDS) paintRow(id);
    const note = cameraSources.getStorageNote();
    if (note) {
      setText(noteEl, note);
      noteEl.hidden = false;
    }
    overlayCk.checked = cameraSources.getShowOverlays();
    editCk.checked = cameraSources.getEditMode();
  }

  paint();
  const unsub = cameraSources.subscribe(paint);

  return {
    paint,
    destroy: () => unsub(),
    turnOffEditMode() {
      if (editCk.checked) {
        editCk.checked = false;
        cameraSources.setEditMode(false);
      }
    },
  };
}
