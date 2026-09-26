/**
 * The AI models the pipeline actually runs, one source for the header card
 * and the System page. Names are as served (see services/ and context.md);
 * add a row here only when the model is in use.
 *
 * `status` names where a row's readiness comes from (see modelStatus.js):
 *   vision   health.strip models_resident (Z Runtime answers on :8000)
 *   router   health.strip p95_ms measured (detection step has run)
 *   asr/tts  /voice/status in live
 * `core` rows decide the header chip; voice rows never do.
 * The Text to speech row and the footer follow the active phone TTS
 * provider from /voice/status (modelStatus.js: ttsProvider).
 */

export const MODELS = [
  {
    id: "vision",
    role: "Vision",
    name: "Qwen3-VL-30B-A3B (FP8)",
    runtime: "HP Z Runtime",
    status: "vision",
    core: true,
  },
  {
    id: "detection",
    role: "Detection",
    name: "YOLO26s-pose + ByteTrack",
    runtime: "On device",
    status: "router",
    core: true,
    metric: "p95",
  },
  {
    id: "anomaly",
    role: "Anomaly",
    name: "CLIP ViT-B/16 (VadCLIP-style)",
    runtime: "On device",
    status: "router",
    core: true,
  },
  {
    id: "asr",
    role: "Speech to text",
    name: "Whisper base.en",
    runtime: "On device",
    status: "asr",
    core: false,
  },
  {
    id: "tts",
    role: "Text to speech",
    name: "Kokoro-82M",
    runtime: "On device",
    status: "tts",
    core: false,
  },
];

export const MODELS_TITLE = "AI models";
export const MODELS_SUBTITLE = "";
