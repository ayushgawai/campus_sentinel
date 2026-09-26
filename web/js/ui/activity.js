/**
 * Live pipeline strip on the Live page: every stage from camera to phone,
 * in order, lit while it is working (several at once is normal), with its
 * current count (people tracked, Qwen requests in flight, live calls...).
 * Source: the api `activity.tick` (1 s) and `usage.total` (all-time tokens).
 */

import { clear, el, setText } from "../dom.js?v=pro4";
import { compact } from "../usage.js?v=pro4";

/** Tab title with all-time tokens, e.g. "Sentinel · 1.2M tokens". */
export function tokenTitle(base, total) {
  if (!total || !Number.isFinite(total.tokens)) return base;
  return `${base.split(" · ")[0]} · ${compact(total.tokens)} tokens`;
}

export function mountActivity(root, store) {
  if (!root) return () => {};
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "AI pipeline activity");
  const tokens = el("div", { class: "act-tokens" }, [
    el("span", { class: "act-tokens__label" }, ["Tokens, all time"]),
    el("span", { class: "act-tokens__value" }, ["—"]),
  ]);
  const flow = el("ol", { class: "act-flow" });
  root.append(tokens, flow);
  const valueEl = tokens.querySelector(".act-tokens__value");
  const rows = new Map(); // stage id -> { li, count }
  let lastTs = null;
  let lastTotal = null;

  function row(stage) {
    let r = rows.get(stage.id);
    if (r) return r;
    const count = el("span", { class: "act-stage__count" });
    const li = el("li", { class: "act-stage", title: stage.role }, [
      el("span", { class: "act-stage__dot", "aria-hidden": "true" }),
      el("span", { class: "act-stage__name" }, [stage.name]),
      count,
    ]);
    flow.append(li);
    r = { li, count };
    rows.set(stage.id, r);
    return r;
  }

  function render(state) {
    const total = state.usageTotal;
    if (total && total !== lastTotal) {
      lastTotal = total;
      setText(valueEl, compact(total.tokens));
      tokens.title = `${total.tokens.toLocaleString()} tokens (${total.tokens_in.toLocaleString()} in, ${total.tokens_out.toLocaleString()} out) over ${total.requests.toLocaleString()} Qwen requests`;
    }
    const act = state.activity;
    if (!act || act.ts === lastTs) return;
    lastTs = act.ts;
    if (!act.stages.length) clear(flow);
    for (const s of act.stages) {
      const r = row(s);
      r.li.classList.toggle("is-active", Boolean(s.active));
      setText(r.count, s.count ? `${s.count} ${s.unit}` : s.active ? "working" : "idle");
      r.li.setAttribute("aria-label", `${s.name}: ${s.active ? "active" : "idle"}, ${s.count} ${s.unit}`);
    }
  }

  render(store.getState());
  return store.subscribe(() => render(store.getState()));
}
