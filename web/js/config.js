/**
 * Backend REST route builders. The API base is the ?ws= host over http(s)
 * (ws://host:8080/ws → http://host:8080); ?api= overrides it. Mock mode has
 * no API base and every builder returns null.
 */

function apiBase() {
  if (typeof location === "undefined") return null;
  const params = new URLSearchParams(location.search);
  const raw = params.get("api") || params.get("ws");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === "ws:") url.protocol = "http:";
    if (url.protocol === "wss:") url.protocol = "https:";
    return url.origin;
  } catch {
    return null;
  }
}

const BASE = apiBase();

export const API_TIMEOUT_MS = 5000;

export const routes = {
  manualIncident: () => (BASE ? `${BASE}/api/incidents/manual` : null),
  dispatch: (incidentId) =>
    BASE ? `${BASE}/api/incidents/${encodeURIComponent(incidentId)}/dispatch` : null,
  confirm: (incidentId) =>
    BASE ? `${BASE}/api/incidents/${encodeURIComponent(incidentId)}/confirm` : null,
  dismiss: (incidentId) =>
    BASE ? `${BASE}/api/incidents/${encodeURIComponent(incidentId)}/dismiss` : null,
  broadcast: () => (BASE ? `${BASE}/api/broadcast` : null),
};

/**
 * Cloud-equivalent pricing for the System page "Cloud cost avoided" card.
 * One row per model found in the code and on the running Nano (Step 0
 * inventory, 2026-09-26). `id` is the key the backend's usage.tick uses.
 *
 * TODO(team): fill each `price` (USD per `per` units of `key`) from the
 * vendor's official price page, and set `checked` to that date
 * ("YYYY-MM-DD"). While a price is null the model shows "Price not set" and
 * is left out of every dollar total. Never enter a price from memory.
 *
 * `cloud: true` marks work that really runs on a cloud API (its cost is
 * real spend, not savings). Category "none" never counts in dollars.
 * `usage` names the one usage field shown for the model when it has no
 * token counts (frames, audio seconds, characters).
 */
export const CLOUD_EQUIV = [
  {
    id: "hf:Qwen/Qwen3-VL-30B-A3B-Instruct-FP8",
    name: "Qwen3-VL-30B-A3B",
    tier: "Adjudicate + Act",
    tierNote: "Adjudicate, Act and Surface calls are counted together",
    category: "cloud vision-language API",
    usage: "tokens",
    units: [
      { key: "tokens_in", unit: "per 1M input tokens", per: 1e6, price: null },
      { key: "tokens_out", unit: "per 1M output tokens", per: 1e6, price: null },
    ],
    checked: null,
  },
  {
    id: "yolo26s-pose",
    name: "YOLO26s-pose",
    tier: "Router",
    category: "cloud object detection",
    usage: "frames",
    units: [{ key: "frames", unit: "per 1k images", per: 1e3, price: null }],
    checked: null,
  },
  {
    id: "clip-vit-b-16",
    name: "CLIP ViT-B/16",
    tier: "Router",
    category: "cloud image classification",
    usage: "frames",
    units: [{ key: "frames", unit: "per 1k images", per: 1e3, price: null }],
    checked: null,
  },
  {
    id: "faster-whisper-base.en",
    name: "Whisper base.en",
    tier: "Act",
    category: "cloud speech-to-text",
    usage: "audio_s",
    units: [{ key: "audio_s", unit: "per audio minute", per: 60, price: null }],
    checked: null,
  },
  {
    id: "kokoro-82m",
    name: "Kokoro-82M",
    tier: "Act",
    category: "cloud text-to-speech",
    usage: "chars",
    tts: "kokoro",
    units: [{ key: "chars", unit: "per 1M characters", per: 1e6, price: null }],
    checked: null,
  },
  {
    id: "eleven_flash_v2_5",
    name: "ElevenLabs (cloud)",
    tier: "Cloud",
    category: "cloud text-to-speech",
    usage: "chars",
    tts: "elevenlabs",
    cloud: true,
    units: [{ key: "chars", unit: "per 1M characters", per: 1e6, price: null }],
    checked: null,
  },
  {
    id: "bytetrack",
    name: "ByteTrack",
    tier: "Router",
    category: "none",
    units: [],
    checked: null,
  },
];

/** Tier order for "Group by: Tier" (bottom of the stack first). */
export const USAGE_TIERS = ["Router", "Adjudicate + Act", "Act", "Cloud"];
