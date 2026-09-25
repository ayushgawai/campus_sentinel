/**
 * Demo control, Camera sources section: local blob videos for recording.
 * Top row (help + Remove all / Load six videos), two switches, then a 3×2
 * grid of camera cards.
 */

import { WALL_CAMERA_IDS, cameraLabel } from "../site.js?v=fix7d";
import { clear, el, setText, svgEl } from "../dom.js?v=fix7d";
import * as cameraSources from "../cameraSources.js?v=fix7d";

function formatDur(sec) {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "";
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const ICONS = {
  upload: "M8 10.5V2.5M5 5.5 8 2.5 11 5.5M3 10.5v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2",
  remove: "M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.6 8.5h4.8l.6-8.5",
  camera: "M2.5 5.5h7.5v6H2.5ZM10 7.5l3.5-2v6l-3.5-2",
};

function svgIcon(name, size = 16) {
  const svg = svgEl("svg", {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    "aria-hidden": "true",
    focusable: "false",
  });
  svg.appendChild(
    svgEl("path", {
      d: ICONS[name],
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.4",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  );
  return svg;
}

/** Switch: a real checkbox with role="switch" under a styled track. */
function switchRow(text) {
  const label = el("label", { className: "switch switch--labelled" });
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "switch__input";
  input.setAttribute("role", "switch");
  label.appendChild(input);
  label.appendChild(el("span", { className: "switch__track", attrs: { "aria-hidden": "true" } }));
  label.appendChild(el("span", { className: "switch__text", text }));
  return { label, input };
}

/**
 * @param {HTMLElement} host
 * @param {{ onEditModeChange?: (on: boolean) => void }} [opts]
 */
export function mountDemoCameraSources(host, opts = {}) {
  clear(host);
  host.className = "dsrc";

  // Top row: help on the left, actions on the right.
  const top = el("div", { className: "dsrc__top" });
  const help = el("div", { className: "dsrc__help" });
  help.appendChild(
    el("p", {
      text: "Local playback for recording. Not processed by the pipeline. Stored in this browser only.",
    }),
  );
  const noteEl = el("p", { className: "dsrc__note" });
  noteEl.hidden = true;
  help.appendChild(noteEl);
  top.appendChild(help);

  const tools = el("div", { className: "dsrc__tools" });
  const removeAllBtn = el("button", { type: "button", className: "btn btn--secondary", text: "Remove all" });
  const confirmAllBtn = el("button", { type: "button", className: "btn btn--danger", text: "Confirm remove all" });
  confirmAllBtn.hidden = true;
  const loadSixBtn = el("button", { type: "button", className: "btn btn--primary", text: "Load six videos" });
  tools.appendChild(removeAllBtn);
  tools.appendChild(confirmAllBtn);
  tools.appendChild(loadSixBtn);
  top.appendChild(tools);
  host.appendChild(top);

  const switches = el("div", { className: "dsrc__switches" });
  const edit = switchRow("Edit camera sources on the wall");
  const overlay = switchRow("Show detection overlays on loaded videos");
  overlay.input.checked = cameraSources.getShowOverlays();
  switches.appendChild(edit.label);
  switches.appendChild(overlay.label);
  host.appendChild(switches);

  const grid = el("div", { className: "dsrc__grid" });
  host.appendChild(grid);

  /** @type {Map<string, object>} */
  const cards = new Map();

  for (const id of WALL_CAMERA_IDS) {
    const label = cameraLabel(id);
    const card = el("article", { className: "dsrc-card", dataset: { cameraId: id } });

    const preview = el("div", { className: "dsrc-card__preview" });
    const img = document.createElement("img");
    img.alt = "";
    img.hidden = true;
    preview.appendChild(img);
    const empty = el("div", { className: "dsrc-card__empty" });
    empty.appendChild(svgIcon("camera", 20));
    empty.appendChild(el("span", { text: "No video" }));
    preview.appendChild(empty);
    const msg = el("div", { className: "dsrc-card__msg", attrs: { role: "status" } });
    msg.hidden = true;
    preview.appendChild(msg);

    const body = el("div", { className: "dsrc-card__body" });
    const head = el("div", { className: "dsrc-card__head" });
    head.appendChild(el("h3", { className: "dsrc-card__title", text: label }));
    const btns = el("div", { className: "dsrc-card__btns" });
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = cameraSources.ACCEPT_ATTR;
    fileInput.hidden = true;
    const upBtn = el("button", {
      type: "button",
      className: "btn btn--secondary btn--icon btn--sm",
      attrs: { "aria-label": `Upload video for ${label}`, title: "Upload video" },
    });
    upBtn.appendChild(svgIcon("upload"));
    const rmBtn = el("button", {
      type: "button",
      className: "btn btn--secondary btn--icon btn--sm",
      attrs: { "aria-label": `Remove video from ${label}`, title: "Remove video" },
    });
    rmBtn.appendChild(svgIcon("remove"));
    btns.appendChild(fileInput);
    btns.appendChild(upBtn);
    btns.appendChild(rmBtn);
    head.appendChild(btns);
    body.appendChild(head);

    const meta = el("div", { className: "dsrc-card__meta" });
    const nameEl = el("span", { className: "dsrc-card__name", text: "No video loaded" });
    meta.appendChild(nameEl);
    const offsetWrap = el("label", { className: "dsrc-card__offset" });
    offsetWrap.appendChild(document.createTextNode("Start at"));
    const offsetInput = document.createElement("input");
    offsetInput.type = "number";
    offsetInput.min = "0";
    offsetInput.step = "0.1";
    offsetInput.value = "0";
    offsetInput.className = "dsrc-card__offset-input";
    offsetInput.setAttribute("aria-label", `Start offset in seconds for ${label}`);
    offsetWrap.appendChild(offsetInput);
    offsetWrap.appendChild(document.createTextNode("s"));
    meta.appendChild(offsetWrap);
    body.appendChild(meta);

    card.appendChild(preview);
    card.appendChild(body);
    grid.appendChild(card);
    cards.set(id, { img, empty, msg, nameEl, offsetInput, upBtn, rmBtn, label });

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
    confirmAllBtn.focus();
  });
  confirmAllBtn.addEventListener("click", async () => {
    await cameraSources.clearAll();
    confirmAllBtn.hidden = true;
    removeAllBtn.hidden = false;
  });

  edit.input.addEventListener("change", () => {
    cameraSources.setEditMode(edit.input.checked);
    opts.onEditModeChange?.(edit.input.checked);
  });
  overlay.input.addEventListener("change", () => {
    cameraSources.setShowOverlays(overlay.input.checked);
  });

  function paintCard(id) {
    const c = cards.get(id);
    if (!c) return;
    const src = cameraSources.get(id);

    if (!src) {
      c.img.hidden = true;
      c.img.removeAttribute("src");
      c.empty.hidden = false;
      setText(c.nameEl, "No video loaded");
      c.nameEl.removeAttribute("title");
      c.offsetInput.value = "0";
      c.offsetInput.disabled = true;
      c.upBtn.setAttribute("aria-label", `Upload video for ${c.label}`);
      c.upBtn.title = "Upload video";
      c.rmBtn.disabled = true;
      if (!c.msg.classList.contains("is-error") || !c.msg.textContent) c.msg.hidden = true;
      return;
    }

    c.rmBtn.disabled = false;
    c.offsetInput.disabled = src.status !== "ready";
    c.offsetInput.value = String(src.offset ?? 0);
    c.upBtn.setAttribute("aria-label", `Replace video for ${c.label}`);
    c.upBtn.title = "Replace video";
    const dur = formatDur(src.duration);
    setText(c.nameEl, dur ? `${src.name || "Video"} · ${dur}` : src.name || "Video");
    c.nameEl.title = src.name || "";

    if (src.status === "loading" || src.status === "error") {
      setText(c.msg, src.status === "loading" ? "Loading…" : src.error || "Could not load video.");
      c.msg.classList.toggle("is-error", src.status === "error");
      c.msg.hidden = false;
      c.empty.hidden = false;
      c.img.hidden = true;
      return;
    }

    c.msg.hidden = true;
    c.msg.classList.remove("is-error");
    if (src.thumbUrl) {
      c.img.src = src.thumbUrl;
      c.img.hidden = false;
      c.empty.hidden = true;
    } else {
      c.img.hidden = true;
      c.empty.hidden = false;
    }
  }

  function paint() {
    for (const id of WALL_CAMERA_IDS) paintCard(id);
    const note = cameraSources.getStorageNote();
    if (note) {
      setText(noteEl, note);
      noteEl.hidden = false;
    }
    overlay.input.checked = cameraSources.getShowOverlays();
    edit.input.checked = cameraSources.getEditMode();
  }

  paint();
  const unsub = cameraSources.subscribe(paint);

  return {
    paint,
    destroy: () => unsub(),
    turnOffEditMode() {
      if (edit.input.checked) {
        edit.input.checked = false;
        cameraSources.setEditMode(false);
      }
    },
  };
}
