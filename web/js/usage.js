/**
 * AI usage for the System page "Cloud cost avoided" card.
 *
 * Source (live): the api's `usage.tick` events — per-window counts keyed by
 * the model ids in config.js CLOUD_EQUIV — plus health.strip running totals
 * (frames_screened → "frames sampled" by the router, frames_escalated →
 * escalations), turned into per-bucket deltas; a drop means a demo reset.
 * Nothing is estimated: a model with no counts stays "Pending".
 *
 * Kept in 5-minute buckets in memory, and in live mode also in this
 * browser's IndexedDB (its own small database) so a reload keeps today's
 * numbers. PER BROWSER ONLY: another browser starts empty.
 *
 * Mock mode (no ?ws=): the mock timeline sends usage.tick like the api
 * would, and a deterministic generator fills the earlier 7 days so every
 * period has bars. Mock data is never written to IndexedDB.
 */

import { CLOUD_EQUIV } from "./config.js?v=pro4";
import { now } from "./clock.js?v=pro4";
import { subscribeModelStatus, ttsProvider } from "./modelStatus.js?v=pro4";

export const BUCKET_MS = 5 * 60 * 1000;
const KEEP_MS = 8 * 24 * 60 * 60 * 1000;
const DB_NAME = "sentinel-usage";
const DB_VERSION = 1;
const SAVE_DELAY_MS = 2000;
const FIELDS = ["requests", "tokens_in", "tokens_out", "audio_s", "chars", "frames", "live"];

export const PERIODS = {
  hour: { label: "Last hour" },
  today: { label: "Today" },
  week: { label: "Last 7 days" },
};

/** Models that can appear as series (category "none" never does). */
export const BILLABLE = CLOUD_EQUIV.filter((m) => m.category !== "none" && m.units.length);

/** bucket start ms → { t, by: {id: counts}, sampled, escalated, ticks: [ts] } */
let buckets = new Map();
let lastHealth = null; // { ts, screened, escalated }
let tickSeen = false; // a usage.tick arrived this session
let lastSeq = 0;
let updatedMs = null;
let mode = null; // "MOCK" | "LIVE" …
let mockSeededFor = null;
let testEmpty = false;
let testPrices = null; // test-only { [id]: [price per unit row] }
const dirty = new Set();
let saveTimer = 0;
const listeners = new Set();

function notify() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

export function subscribeUsage(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function bucketOf(ms) {
  return Math.floor(ms / BUCKET_MS) * BUCKET_MS;
}

function ensureBucket(t) {
  let b = buckets.get(t);
  if (!b) {
    b = { t, by: {}, sampled: 0, escalated: 0, ticks: [] };
    buckets.set(t, b);
  }
  return b;
}

function addCounts(b, id, row) {
  const cur = b.by[id] || (b.by[id] = {});
  for (const f of FIELDS) if (Number.isFinite(row[f])) cur[f] = (cur[f] || 0) + row[f];
}

// ---------- IndexedDB (live only) ----------

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("buckets")) db.createObjectStore("buckets", { keyPath: "t" });
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

async function loadPersisted() {
  try {
    const db = await openDb();
    const [rows, health] = await new Promise((resolve, reject) => {
      const tx = db.transaction(["buckets", "meta"], "readonly");
      const a = tx.objectStore("buckets").getAll();
      const h = tx.objectStore("meta").get("health");
      tx.oncomplete = () => resolve([a.result || [], h.result || null]);
      tx.onerror = () => reject(tx.error);
    });
    const cutoff = now() - KEEP_MS;
    for (const r of rows) {
      if (!r || !Number.isFinite(r.t) || r.t < cutoff) continue;
      const b = ensureBucket(r.t);
      for (const [id, c] of Object.entries(r.by || {})) addCounts(b, id, c);
      b.sampled += r.sampled || 0;
      b.escalated += r.escalated || 0;
      for (const ts of r.ticks || []) if (!b.ticks.includes(ts)) b.ticks.push(ts);
    }
    if (!lastHealth && health && Number.isFinite(health.screened)) lastHealth = health;
    notify();
  } catch {
    /* storage unavailable: session only */
  }
}

function scheduleSave() {
  if (mode !== "LIVE" || saveTimer) return;
  saveTimer = window.setTimeout(flushSave, SAVE_DELAY_MS);
}

async function flushSave() {
  saveTimer = 0;
  if (mode !== "LIVE") return;
  const ts = [...dirty];
  dirty.clear();
  try {
    const db = await openDb();
    const cutoff = now() - KEEP_MS;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["buckets", "meta"], "readwrite");
      const st = tx.objectStore("buckets");
      for (const t of ts) {
        const b = buckets.get(t);
        if (b) st.put(b);
      }
      st.delete(IDBKeyRange.upperBound(cutoff));
      if (lastHealth) tx.objectStore("meta").put(lastHealth, "health");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

// ---------- Ingest ----------

function ingestTick(ev) {
  const ms = Date.parse(ev.ts || "") || now();
  const b = ensureBucket(bucketOf(ms));
  // The api replays recent events on connect: count each window once.
  if (ev.ts) {
    if (b.ticks.includes(ev.ts)) return false;
    b.ticks.push(ev.ts);
  }
  for (const [id, row] of Object.entries(ev.by_model || {})) addCounts(b, id, row);
  dirty.add(b.t);
  return true;
}

function ingestHealth(h) {
  if (!h?.received || !h.ts) return false;
  const ms = Date.parse(h.ts);
  if (!Number.isFinite(ms)) return false;
  const cur = { ts: h.ts, ms, screened: h.frames_screened || 0, escalated: h.frames_escalated || 0 };
  const prev = lastHealth;
  if (prev && Number.isFinite(prev.ms) && ms <= prev.ms) return false; // replayed / stale
  lastHealth = cur;
  if (!prev) return false; // first reading: only a baseline, no delta yet
  // Running totals: a drop is a reset, and the new total is all new work.
  const dS = cur.screened >= prev.screened ? cur.screened - prev.screened : cur.screened;
  const dE = cur.escalated >= prev.escalated ? cur.escalated - prev.escalated : cur.escalated;
  if (!dS && !dE) return false;
  const b = ensureBucket(bucketOf(ms));
  b.sampled += dS;
  b.escalated += dE;
  dirty.add(b.t);
  return true;
}

// ---------- Mock history (deterministic) ----------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mock only: the 7 days before the session, same numbers every reload. */
let seedEnd = null;
function seedMockHistory(provider) {
  // Fixed end so a later re-seed (provider switch) never touches the session.
  if (seedEnd == null) seedEnd = bucketOf(now());
  const endT = seedEnd;
  for (const [t, b] of buckets) if (b.mock) buckets.delete(t);
  const ttsId = provider === "elevenlabs" ? "eleven_flash_v2_5" : "kokoro-82m";
  for (let t = endT - 7 * 24 * 12 * BUCKET_MS; t < endT; t += BUCKET_MS) {
    const r = rng(Math.floor(t / BUCKET_MS));
    const hour = new Date(t).getHours();
    const busy = hour >= 7 && hour < 22 ? 1 : 0.35; // campus hours
    const b = ensureBucket(t);
    b.mock = true;
    const frames = Math.round(54000 * busy * (0.8 + 0.2 * r()));
    addCounts(b, "yolo26s-pose", { frames });
    addCounts(b, "clip-vit-b-16", { frames });
    b.sampled += frames;
    let req = 0;
    let tin = 0;
    let tout = 0;
    if (r() < 0.22 * busy) {
      req += 1;
      tin += 4400;
      tout += 8;
    }
    if (r() < 0.012 * busy) {
      // An incident with a dispatcher call.
      req += 14;
      tin += 16500;
      tout += 800;
      addCounts(b, "faster-whisper-base.en", { requests: 12, audio_s: 95 });
      addCounts(b, ttsId, { requests: 16, chars: 2400 });
    }
    if (req) {
      addCounts(b, "hf:Qwen/Qwen3-VL-30B-A3B-Instruct-FP8", {
        requests: req,
        tokens_in: tin,
        tokens_out: tout,
        live: req,
      });
    }
  }
  mockSeededFor = provider;
}

// ---------- Start ----------

export function startUsage(store) {
  let providerKey = null;
  function onState(state) {
    const conn = state.connection?.status || null;
    if (conn && conn !== mode) {
      const was = mode;
      mode = conn === "RECONNECTING" ? was || "LIVE" : conn;
      if (mode === "LIVE" && was == null) loadPersisted();
    }
    let changed = false;
    if (mode === "MOCK") {
      const p = ttsProvider(state);
      if (p !== mockSeededFor) {
        seedMockHistory(p);
        changed = true;
      }
    }
    const q = state.usageTicks;
    if (q && q.seq !== lastSeq) {
      if (q.seq < lastSeq) lastSeq = 0; // store was reset
      for (const it of q.items) {
        if (it.seq <= lastSeq) continue;
        if (ingestTick(it.event)) changed = true;
        tickSeen = true;
      }
      lastSeq = q.seq;
    }
    if (ingestHealth(state.health)) changed = true;
    if (changed) {
      updatedMs = now();
      scheduleSave();
      notify();
    }
    const pk = ttsProvider(state);
    if (pk !== providerKey) {
      providerKey = pk;
      notify();
    }
  }
  const unsub = store.subscribe(onState);
  const unsubVoice = subscribeModelStatus(() => onState(store.getState()));
  onState(store.getState());
  window.addEventListener("pagehide", flushSave);

  // Test-only hooks (headless checks): empty state and price overrides.
  window.__usageTest = {
    empty(on) {
      testEmpty = Boolean(on);
      notify();
    },
    setPrices(map) {
      testPrices = map && typeof map === "object" ? map : null;
      notify();
    },
  };

  return () => {
    unsub();
    unsubVoice();
    window.removeEventListener("pagehide", flushSave);
  };
}

// ---------- View model ----------

/** Price rows for a model, with the test override applied. */
function unitsOf(m) {
  const over = testPrices?.[m.id];
  return m.units.map((u, i) => ({ ...u, price: Array.isArray(over) ? over[i] ?? null : u.price }));
}

export function modelPriced(m) {
  const u = unitsOf(m);
  return u.length > 0 && u.every((x) => Number.isFinite(x.price));
}

function costOf(m, c) {
  if (!modelPriced(m)) return null;
  let usd = 0;
  for (const u of unitsOf(m)) usd += ((c?.[u.key] || 0) * u.price) / u.per;
  return usd;
}

/** Footer: all prices set → the oldest `checked` date. */
export function pricesFooter() {
  const all = BILLABLE.every(modelPriced);
  if (!all) return "Cloud prices not set yet";
  const dates = BILLABLE.map((m) => m.checked).filter(Boolean).sort();
  return `Estimated at public list prices · checked ${dates[0] || "date not set"}`;
}

/**
 * Models in use for this provider: only the ACTIVE phone TTS is listed
 * (ElevenLabs or Kokoro, never both; neither while the provider is unknown).
 */
export function visibleModels(provider) {
  return BILLABLE.filter((m) => !m.tts || m.tts === provider);
}

function slotsFor(period, nowMs) {
  const out = [];
  if (period === "hour") {
    const end = bucketOf(nowMs);
    for (let i = 11; i >= 0; i--) {
      const t = end - i * BUCKET_MS;
      out.push({ start: t, end: t + BUCKET_MS, future: false });
    }
  } else if (period === "today") {
    const d = new Date(nowMs);
    d.setHours(0, 0, 0, 0);
    for (let h = 0; h < 24; h++) {
      const s = new Date(d);
      s.setHours(h);
      const e = new Date(d);
      e.setHours(h + 1);
      out.push({ start: s.getTime(), end: e.getTime(), future: s.getTime() > nowMs });
    }
  } else {
    const d = new Date(nowMs);
    d.setHours(0, 0, 0, 0);
    for (let i = 6; i >= 0; i--) {
      const s = new Date(d);
      s.setDate(d.getDate() - i);
      const e = new Date(s);
      e.setDate(s.getDate() + 1);
      out.push({ start: s.getTime(), end: e.getTime(), future: false });
    }
  }
  return out;
}

function sumInto(acc, c) {
  for (const f of FIELDS) if (Number.isFinite(c?.[f])) acc[f] = (acc[f] || 0) + c[f];
}

/**
 * Everything the card draws, for one period / mode. Tokens only in the
 * chart (models that produce tokens); frames and voice are tiles. Values
 * are null when there is no data yet (shown as "—").
 */
export function usageView({ period, cumulative, hidden }, state) {
  const provider = ttsProvider(state);
  const isMock = mode === "MOCK";
  const nowMs = now();
  const models = visibleModels(provider);
  const slots = slotsFor(period, nowMs);
  const from = slots[0].start;
  const to = slots[slots.length - 1].end;

  for (const s of slots) {
    s.by = {};
    s.sampled = 0;
  }
  if (!testEmpty) {
    for (const b of buckets.values()) {
      if (b.t < from || b.t >= to) continue;
      const s = slots.find((x) => b.t >= x.start && b.t < x.end);
      if (!s) continue;
      for (const [id, c] of Object.entries(b.by)) sumInto(s.by[id] || (s.by[id] = {}), c);
      s.sampled += b.sampled;
    }
  }

  const tokenModels = models.filter((m) => m.usage === "tokens");
  const series = tokenModels.map((m) => ({
    key: m.id,
    name: m.name,
    models: [m],
    color: BILLABLE.indexOf(m) + 1,
    hidden: hidden.has(m.id),
  }));
  const tok = (c) => (c?.tokens_in || 0) + (c?.tokens_out || 0);
  const running = series.map(() => 0);
  const bars = slots.map((s) => {
    const values = series.map((se, i) => {
      const v = tok(s.by[se.key]);
      running[i] += v;
      return cumulative ? running[i] : v;
    });
    const total = values.reduce((a, v, i) => a + (series[i].hidden ? 0 : v), 0);
    return { ...s, values: s.future ? values.map(() => 0) : values, total: s.future ? 0 : total };
  });

  // Period totals for the tiles.
  const tot = {};
  let sampled = 0;
  let anyTickData = false;
  for (const s of slots) {
    for (const [id, c] of Object.entries(s.by)) {
      sumInto(tot[id] || (tot[id] = {}), c);
      anyTickData = true;
    }
    sampled += s.sampled;
  }
  const hasTicks = tickSeen || isMock || anyTickData;
  let tokens = null;
  let requests = null;
  let tokPerReq = null;
  let voiceMin = null;
  if (hasTicks && !testEmpty) {
    tokens = 0;
    requests = 0;
    let tokenReqs = 0;
    for (const m of models) {
      requests += tot[m.id]?.requests || 0;
      if (m.usage === "tokens") {
        tokens += tok(tot[m.id]);
        tokenReqs += tot[m.id]?.requests || 0;
      }
    }
    tokPerReq = tokenReqs ? tokens / tokenReqs : null;
    const stt = models.find((m) => m.usage === "audio_s");
    voiceMin = stt ? (tot[stt.id]?.audio_s || 0) / 60 : null;
  }
  const frames = lastHealth || sampled ? sampled : null;

  // Dollars only when every visible model has a price.
  let dollars = null;
  if (models.length && models.every(modelPriced) && hasTicks) {
    const saved = models.filter((m) => !m.cloud).reduce((a, m) => a + (costOf(m, tot[m.id]) || 0), 0);
    const spend = models.filter((m) => m.cloud).reduce((a, m) => a + (costOf(m, tot[m.id]) || 0), 0);
    dollars = { saved, spend };
  }

  return {
    provider,
    isMock,
    series,
    bars,
    noTicks: !hasTicks,
    empty: testEmpty || bars.every((b) => b.values.every((v) => !v)),
    kpi: { tokens, requests, tokPerReq, frames, voiceMin, dollars },
    updatedMs,
    period,
  };
}

/** Per-slot native usage rows for the tooltip (frames, seconds, chars). */
export function nativeUsage(m, c) {
  if (!c) return "";
  if (m.usage === "tokens") return `${compact((c.tokens_in || 0) + (c.tokens_out || 0))} tokens`;
  if (m.usage === "frames") return `${compact(c.frames || 0)} frames`;
  if (m.usage === "audio_s") return `${compact(c.audio_s || 0)} s audio`;
  if (m.usage === "chars") return `${compact(c.chars || 0)} chars`;
  return "";
}

/** 16.4M, 912k, 4.4k, 950. */
export function compact(n) {
  if (!Number.isFinite(n)) return "";
  const a = Math.abs(n);
  const f = (v, s) => `${v >= 100 ? Math.round(v) : Number(v.toFixed(1))}${s}`;
  if (a >= 1e9) return f(n / 1e9, "B");
  if (a >= 1e6) return f(n / 1e6, "M");
  if (a >= 1e3) return f(n / 1e3, "k");
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1)));
}

export function usd(n) {
  if (!Number.isFinite(n)) return "";
  if (n > 0 && n < 0.01) return "<$0.01";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
