/**
 * System page: "AI usage" — KPI tiles and a hand-drawn stacked bar chart of
 * REAL tokens per bucket (SVG, no library) with tooltip, keyboard focus and
 * a toggle legend. Data rules live in usage.js; this file only draws.
 * Missing values read "—"; dollar tiles appear only when every price is set.
 */

import { el, setText } from "../dom.js?v=pro7";
import { formatClock, formatInt } from "../format.js?v=pro7";
import {
  PERIODS,
  compact,
  subscribeUsage,
  usageView,
  usd,
} from "../usage.js?v=pro7";

const SVG = "http://www.w3.org/2000/svg";
const CHART_H = 300;
const M = { l: 56, r: 12, t: 16, b: 28 };
const GAP = 1.5;
const RADIUS = 4;

function svg(tag, attrs = {}, cls = "") {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (cls) n.setAttribute("class", cls);
  return n;
}

/** 4–5 "nice" ticks from 0 to at least `max`. */
function niceTicks(max) {
  const top = max > 0 ? max : 1;
  const raw = top / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => top / s <= 5) || 10 * mag;
  const out = [];
  for (let v = 0; v <= top + step * 1e-9; v += step) out.push(v);
  if (out[out.length - 1] < top) out.push(out[out.length - 1] + step);
  return out;
}

/** Path for a bar with only its top corners rounded. */
function topRounded(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, h, w / 2));
  return [
    `M${x},${y + h}`,
    `V${y + rr}`,
    `Q${x},${y} ${x + rr},${y}`,
    `H${x + w - rr}`,
    `Q${x + w},${y} ${x + w},${y + rr}`,
    `V${y + h}`,
    "Z",
  ].join(" ");
}

// Buckets are in this browser's local time, so labels are too.
const hhmm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function slotLabel(period, ms) {
  if (period === "week") {
    return new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
  }
  return hhmm(ms);
}

function slotTitle(period, b) {
  if (period === "week") {
    return new Date(b.start).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
  }
  return `${hhmm(b.start)}–${hhmm(b.end)}`;
}

export function mountUsageCard(host, store) {
  const card = el("article", {
    className: "panel system__usage",
    attrs: { "aria-labelledby": "usage-title" },
  });
  card.innerHTML = `
    <header class="panel__header uc-head">
      <div class="uc-head__l">
        <h2 class="panel__title" id="usage-title">AI usage</h2>
      </div>
      <span class="uc-updated mono" data-updated></span>
    </header>
    <div class="panel__body uc-body">
      <div class="uc-controls">
        <div class="uc-controls__l">
          <label class="uc-field"><span>Period</span>
            <select class="uc-select" data-period>
              <option value="hour">Last hour</option>
              <option value="today">Today</option>
              <option value="week">Last 7 days</option>
            </select>
          </label>
        </div>
        <div class="uc-seg" role="group" aria-label="Chart values">
          <button type="button" class="uc-seg__btn is-active" data-mode="period" aria-pressed="true">Per period</button>
          <button type="button" class="uc-seg__btn" data-mode="cumulative" aria-pressed="false">Cumulative</button>
        </div>
      </div>
      <div class="uc-kpis" data-kpis></div>
      <div class="uc-chart" data-chart>
        <p class="uc-empty" data-empty hidden>No AI activity in this period yet</p>
        <div class="uc-tip" data-tip role="status" hidden></div>
      </div>
      <ul class="uc-legend" data-legend aria-label="Series"></ul>
      <p class="uc-foot">Per browser</p>
    </div>
  `;
  host.appendChild(card);
  const $ = (s) => card.querySelector(s);
  const chartEl = $("[data-chart]");
  const tip = $("[data-tip]");

  const ui = { period: "hour", cumulative: false, hidden: new Set() };
  let view = null;
  let focusIdx = -1;
  let hotIdx = -1;
  let grow = true;

  // KPI tiles, built once.
  const kpis = {};
  for (const [id, label] of [
    ["tokens", "Tokens today"],
    ["requests", "Requests"],
    ["tpr", "Tokens / request"],
    ["frames", "Frames analysed"],
    ["voice", "Voice (min)"],
    ["saved", "Saved vs cloud"],
    ["spend", "Cloud spend"],
  ]) {
    const t = el("div", { className: `uc-kpi${id === "tokens" ? " uc-kpi--key" : ""}` });
    const k = el("span", { className: "uc-kpi__k", text: label });
    t.appendChild(k);
    const v = el("span", { className: "uc-kpi__v mono" });
    const sub = el("span", { className: "uc-kpi__sub" });
    t.appendChild(v);
    t.appendChild(sub);
    $("[data-kpis]").appendChild(t);
    kpis[id] = { t, k, v, sub };
  }

  function setKpi(id, value, { muted = false, sub = "" } = {}) {
    const k = kpis[id];
    setText(k.v, value);
    k.v.classList.toggle("is-muted", muted);
    setText(k.sub, sub);
    k.sub.hidden = !sub;
  }

  $("[data-period]").addEventListener("change", (e) => {
    ui.period = e.target.value;
    grow = true;
    render();
  });
  for (const b of card.querySelectorAll("[data-mode]")) {
    b.addEventListener("click", () => {
      ui.cumulative = b.dataset.mode === "cumulative";
      for (const x of card.querySelectorAll("[data-mode]")) {
        const on = x === b;
        x.classList.toggle("is-active", on);
        x.setAttribute("aria-pressed", on ? "true" : "false");
      }
      render();
    });
  }

  const DASH = "—";
  const PERIOD_WORD = { hour: "last hour", today: "today", week: "7 days" };

  function paintKpis(v) {
    const k = v.kpi;
    setText(kpis.tokens.k, `Tokens ${PERIOD_WORD[v.period] || ""}`.trim());
    setKpi("tokens", k.tokens != null ? compact(k.tokens) : DASH, { muted: k.tokens == null });
    setKpi("requests", k.requests != null ? formatInt(k.requests) : DASH, { muted: k.requests == null });
    setKpi("tpr", k.tokPerReq != null ? formatInt(Math.round(k.tokPerReq)) : DASH, { muted: k.tokPerReq == null });
    setKpi("frames", k.frames != null ? compact(k.frames) : DASH, { muted: k.frames == null });
    setKpi("voice", k.voiceMin != null ? String(Math.round(k.voiceMin * 10) / 10) : DASH, { muted: k.voiceMin == null });
    // Dollar tiles only when every visible model has a price.
    const d = k.dollars;
    kpis.saved.t.hidden = !d;
    kpis.spend.t.hidden = !d;
    if (d) {
      setKpi("saved", usd(d.saved));
      setKpi("spend", usd(d.spend));
    }
    $("[data-kpis]").classList.toggle("has-dollars", Boolean(d));
  }

  function paintLegend(v) {
    const ul = $("[data-legend]");
    while (ul.firstChild) ul.removeChild(ul.firstChild);
    for (const s of v.series) {
      const li = el("li");
      const b = el("button", {
        type: "button",
        className: `uc-leg${s.hidden ? " is-off" : ""}`,
        attrs: { "aria-pressed": s.hidden ? "false" : "true", title: s.hidden ? `Show ${s.name}` : `Hide ${s.name}` },
        onClick: () => {
          if (ui.hidden.has(s.key)) ui.hidden.delete(s.key);
          else ui.hidden.add(s.key);
          render();
        },
      });
      b.appendChild(el("span", { className: `uc-sq uc-c${s.color}${s.cloud ? " is-hatch" : ""}`, attrs: { "aria-hidden": "true" } }));
      b.appendChild(el("span", { text: s.name }));
      li.appendChild(b);
      ul.appendChild(li);
    }
  }

  let svgEl = null;
  let barEls = [];

  function drawChart(v) {
    const W = Math.max(280, chartEl.clientWidth);
    const H = CHART_H;
    const pw = W - M.l - M.r;
    const ph = H - M.t - M.b;
    const maxTotal = Math.max(0, ...v.bars.map((b) => b.total));
    const ticks = niceTicks(Math.max(maxTotal, 4));
    const top = ticks[ticks.length - 1];
    const y = (val) => M.t + ph - (val / top) * ph;
    const base = y(0);

    const s = svg("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "group", "aria-label": "AI usage by period" }, "uc-svg");
    // Hatch for the cloud series (colour from its token class).
    const defs = svg("defs");
    const pat = svg("pattern", { id: "uc-hatch", patternUnits: "userSpaceOnUse", width: 6, height: 6, patternTransform: "rotate(45)" });
    const cloud = v.series.find((x) => x.cloud);
    const cc = cloud ? cloud.color : 6;
    pat.appendChild(svg("rect", { width: 6, height: 6 }, `uc-hatch-bg uc-f${cc}`));
    pat.appendChild(svg("rect", { width: 2.5, height: 6 }, `uc-f${cc}`));
    defs.appendChild(pat);
    s.appendChild(defs);

    // Y grid + labels.
    for (const t of ticks) {
      s.appendChild(svg("line", { x1: M.l, x2: W - M.r, y1: y(t), y2: y(t) }, "uc-grid"));
      const lab = svg("text", { x: M.l - 8, y: y(t), "text-anchor": "end", "dominant-baseline": "middle" }, "uc-axis");
      lab.textContent = compact(t);
      s.appendChild(lab);
    }

    // X labels, thinned so they never overlap.
    const n = v.bars.length;
    const slot = pw / n;
    const labels = v.bars.map((b) => slotLabel(v.period, b.start));
    const labW = Math.max(...labels.map((l) => l.length)) * 6.8 + 10;
    const every = Math.max(1, Math.ceil(labW / slot));
    v.bars.forEach((b, i) => {
      if (i % every !== 0 && i !== n - 1) return;
      if (i === n - 1 && i % every !== 0 && (i % every) * slot < labW) return;
      const t = svg("text", { x: M.l + slot * (i + 0.5), y: H - 8, "text-anchor": "middle" }, "uc-axis");
      t.textContent = labels[i];
      s.appendChild(t);
    });

    // Bars.
    const g = svg("g", {}, "uc-bars");
    g.style.transformOrigin = `0px ${base}px`;
    if (grow && !reduced()) g.classList.add("is-grow");
    grow = false;
    const bw = slot * 0.62;
    barEls = [];
    const tops = [];
    v.bars.forEach((b, i) => {
      const x = M.l + slot * i + (slot - bw) / 2;
      const bar = svg("g", { tabindex: -1, role: "img", "data-i": i }, "uc-bar");
      const title = slotTitle(v.period, b);
      bar.setAttribute(
        "aria-label",
        b.future ? `${title}: not yet` : `${title}: total ${compact(b.total)} tokens`,
      );
      bar.appendChild(svg("rect", { x: M.l + slot * i, y: M.t, width: slot, height: ph }, "uc-hit"));
      const segs = v.series.map((se, k) => ({ se, val: se.hidden ? 0 : b.values[k] })).filter((x) => x.val > 0);
      let acc = 0;
      segs.forEach((sg, k) => {
        const y0 = y(acc);
        acc += sg.val;
        const y1 = y(acc);
        const isTop = k === segs.length - 1;
        let h = y0 - y1 - (isTop ? 0 : GAP);
        if (h < 0.75) h = 0.75;
        const cls = `uc-seg-${sg.se.cloud ? "hatch" : "fill"} uc-f${sg.se.color}`;
        const node = isTop
          ? svg("path", { d: topRounded(x, y1, bw, h, RADIUS) }, cls)
          : svg("rect", { x, y: y1 + GAP, width: bw, height: Math.max(0.75, y0 - y1 - GAP) }, cls);
        if (sg.se.cloud) node.setAttribute("fill", "url(#uc-hatch)");
        bar.appendChild(node);
      });
      if (!segs.length && !b.future) {
        bar.appendChild(svg("rect", { x, y: base - 2, width: bw, height: 2 }, "uc-stub"));
      }
      tops.push({ x: x + bw / 2, y: y(b.total), future: b.future });
      g.appendChild(bar);
      barEls.push(bar);
    });
    s.appendChild(g);

    // Cumulative: a thin aqua line along the bar tops, dot on the last.
    if (ui.cumulative) {
      const pts = tops.filter((p) => !p.future);
      if (pts.length) {
        s.appendChild(svg("polyline", { points: pts.map((p) => `${p.x},${p.y}`).join(" ") }, "uc-cum"));
        const last = pts[pts.length - 1];
        s.appendChild(svg("circle", { cx: last.x, cy: last.y, r: 3.5 }, "uc-cum-dot"));
      }
    }

    // Roving tabindex: one bar in the tab order.
    const firstReal = v.bars.findIndex((b) => !b.future);
    let entry = focusIdx >= 0 && focusIdx < n && !v.bars[focusIdx].future ? focusIdx : lastReal(v);
    if (entry < 0) entry = firstReal;
    if (entry >= 0) barEls[entry].setAttribute("tabindex", "0");

    for (const bar of barEls) {
      const i = Number(bar.dataset.i);
      bar.addEventListener("mouseenter", () => setHot(i));
      bar.addEventListener("mouseleave", () => setHot(-1));
      bar.addEventListener("focus", () => {
        focusIdx = i;
        setHot(i);
      });
      bar.addEventListener("blur", () => setHot(-1));
      bar.addEventListener("keydown", (e) => onKey(e, i));
    }

    const refocus = svgEl && svgEl.contains(document.activeElement) ? focusIdx : -1;
    if (svgEl) svgEl.remove();
    svgEl = s;
    chartEl.insertBefore(s, chartEl.firstChild);
    if (refocus >= 0 && barEls[refocus]) {
      for (const b of barEls) b.setAttribute("tabindex", "-1");
      barEls[refocus].setAttribute("tabindex", "0");
      barEls[refocus].focus({ preventScroll: true });
    }
  }

  function lastReal(v) {
    for (let i = v.bars.length - 1; i >= 0; i--) if (!v.bars[i].future) return i;
    return -1;
  }

  function onKey(e, i) {
    const n = view.bars.length;
    let next = i;
    if (e.key === "ArrowRight") next = i + 1;
    else if (e.key === "ArrowLeft") next = i - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = lastReal(view);
    else return;
    e.preventDefault();
    next = Math.max(0, Math.min(n - 1, next));
    while (next > 0 && view.bars[next].future) next -= 1;
    if (next === i) return;
    barEls[i].setAttribute("tabindex", "-1");
    barEls[next].setAttribute("tabindex", "0");
    barEls[next].focus();
  }

  function setHot(i) {
    hotIdx = i;
    if (!svgEl) return;
    svgEl.classList.toggle("has-hot", i >= 0);
    barEls.forEach((b, k) => b.classList.toggle("is-hot", k === i));
    paintTip();
  }

  function paintTip() {
    const b = hotIdx >= 0 ? view?.bars[hotIdx] : null;
    if (!b || b.future) {
      tip.hidden = true;
      return;
    }
    while (tip.firstChild) tip.removeChild(tip.firstChild);
    tip.appendChild(el("p", { className: "uc-tip__t mono", text: slotTitle(view.period, b) + (ui.cumulative ? " · running total" : "") }));
    // One row per model with a real value; rows without data are hidden.
    for (let k = 0; k < view.series.length; k++) {
      const se = view.series[k];
      const val = b.values[k];
      if (se.hidden || !val) continue;
      const row = el("div", { className: "uc-tip__row" });
      row.appendChild(el("span", { className: `uc-sq uc-c${se.color}`, attrs: { "aria-hidden": "true" } }));
      row.appendChild(el("span", { className: "uc-tip__name", text: se.name }));
      row.appendChild(el("span", { className: "uc-tip__v mono", text: `${compact(val)} tokens` }));
      tip.appendChild(row);
    }
    const total = el("div", { className: "uc-tip__row uc-tip__total" });
    total.appendChild(el("span", { className: "uc-tip__name", text: "Total" }));
    total.appendChild(el("span", { className: "uc-tip__v mono", text: `${compact(b.total)} tokens` }));
    tip.appendChild(total);
    tip.hidden = false;
    // Place beside the bar, inside the chart bounds.
    const cw = chartEl.clientWidth;
    const ch = chartEl.clientHeight;
    const bar = barEls[hotIdx].getBoundingClientRect();
    const box = chartEl.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = bar.left - box.left + bar.width / 2 + 12;
    if (left + tw > cw - 4) left = bar.left - box.left + bar.width / 2 - tw - 12;
    left = Math.max(4, Math.min(cw - tw - 4, left));
    const top = Math.max(4, Math.min(ch - th - 4, 24));
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  }

  let lastSig = "";
  function render() {
    const state = store.getState();
    view = usageView(ui, state);
    setText($("[data-updated]"), view.updatedMs ? `Updated ${formatClock(view.updatedMs)}` : "Updated —");
    const emptyEl = $("[data-empty]");
    emptyEl.hidden = !view.empty;
    setText(emptyEl, view.noTicks ? "Token data starts when the backend sends usage" : "No AI activity in this period yet");
    paintKpis(view);
    const sig = JSON.stringify([ui.period, ui.cumulative, [...ui.hidden], view.series.map((s) => s.key), view.bars.map((b) => [b.values, b.sampled, b.future])]);
    if (sig !== lastSig || !svgEl) {
      lastSig = sig;
      paintLegend(view);
      drawChart(view);
      if (hotIdx >= 0) setHot(hotIdx);
    }
  }

  // Redraw on width change.
  let lastW = 0;
  const ro = new ResizeObserver(() => {
    const w = chartEl.clientWidth;
    if (w === lastW) return;
    lastW = w;
    lastSig = "";
    if (store.getState().route === "system") render();
  });
  ro.observe(chartEl);

  const unsubUsage = subscribeUsage(() => {
    if (store.getState().route === "system") render();
  });
  let lastRoute = null;
  const unsubStore = store.subscribe((state) => {
    // Entering the page re-renders (and grows the bars once).
    if (state.route === "system" && lastRoute !== "system") {
      grow = true;
      lastSig = "";
      render();
    }
    lastRoute = state.route;
  });
  // "Last hour" slots move with the clock: refresh once a minute.
  const timer = window.setInterval(() => {
    if (store.getState().route === "system") render();
  }, 60000);
  render();

  return () => {
    ro.disconnect();
    unsubUsage();
    unsubStore();
    window.clearInterval(timer);
  };
}

function reduced() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
