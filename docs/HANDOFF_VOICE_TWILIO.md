# Handoff: Twilio + Parakeet + Kokoro (what we need)

Owner of this doc: whoever wires real phone audio. **Do not dial 911 / any real PSAP.** Demo terminal only (verified teammate phone or Twilio test numbers).

## What already works without you
- Vision → Qwen → severity → **scripted** Sentinel↔dispatcher transcript on WebSocket (`call.transcript_delta`, `tool.call_live`).
- Call Brief lookups only (location from `camera_map.json`, person from Completion B).
- Lab UI shows the transcript + tools. Officer dashboard (Indraneel) will consume the same events.

## What we need from you (interfaces, not a rewrite)

### 1) Twilio — **Media Streams only** (raw audio)
We need a **bidirectional audio pipe**, not Twilio `<Say>` / `<Gather input="speech">` (speech stays on our box).

**Deliver:**
1. Twilio account + **verified caller ID** (or Twilio number) that can call **one teammate’s phone**.
2. A thin webhook server (can live under `services/voice/twilio_bridge.py`) that:
   - On SEVERE (HTTP POST from our api, or subscribe to our WS): places outbound call to the demo phone.
   - Returns TwiML that starts **`<Connect><Stream url="wss://…"/></Connect>`** (Media Streams).
   - Relays **mulaw/PCM frames** both ways between Twilio WS and our voice process.
3. Env vars (document in README): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `CS_DEMO_TO_NUMBER`, `CS_PUBLIC_WS_BASE` (ngrok/tailscale HTTPS for Twilio webhooks).
4. Kill switch: respect `CS_KILL_SWITCH=1` — never place a call when set.
5. **Never** call `911`, `112`, or any emergency number. Hard-code allowlist of demo numbers.

**Out of scope for you:** deciding severity, Call Brief contents, YOLO/Qwen.

### 2) Parakeet — ASR (dispatcher speech → text)
**Deliver:**
1. Local model served on ZRT or a small local process (preferred: same Nano, no cloud STT).
2. Function we can call: `transcribe(pcm16_mono_16k: bytes) -> str` with p95 latency target **&lt; 800 ms** for a short utterance.
3. Streaming optional; batch-per-utterance is OK for demo.
4. Wire: Twilio Media Stream **inbound** audio → Parakeet → we append `CallTranscriptDelta(speaker="dispatcher", text=…)`.

### 3) Kokoro — TTS (Sentinel text → speech)
**Deliver:**
1. Local TTS: `synthesize(text: str) -> pcm/wav` (or streaming chunks).
2. Latency target: first audio **&lt; 500 ms** for a short sentence.
3. Wire: our Sentinel lines (script or tool spoken results) → Kokoro → Twilio Media Stream **outbound**.

### 4) Glue contract with our repo
Our hub already emits:
- `call.transcript_delta` `{incident_id, speaker: dispatcher|sentinel, text, ts}`
- `tool.call_live` `{incident_id, tool, args, result, ts}`

Your bridge should:
- **Consume** Sentinel text (from our script/agent) → Kokoro → phone.
- **Produce** dispatcher text (Parakeet) → publish the same `call.transcript_delta` envelopes on our WS **or** POST to `http://127.0.0.1:8080` if we add a small `/voice/ingress` hook (ask Ayush before new routes).

Until your stack lands, **`services/voice/agent.py` keeps the simulated officer script** so the demo never blocks on phones.

## Acceptance test (demo day)
1. Trigger SEVERE on Seville cam-01 (live vision or lab path).
2. Teammate phone rings (Twilio).
3. You hear Kokoro speak the opening Sentinel line.
4. You ask “where is the subject?” → Parakeet text appears in the dashboard transcript → Sentinel answers via **lookup_location** tool (visible `tool.call_live`).
5. Kill switch stops further outbound calls.

## Checklist to paste to your person

Ask them to return:
- [ ] Twilio SID + verified **demo-only** TO number (never 911)
- [ ] Public HTTPS base (Tailscale Funnel / ngrok) for TwiML webhook
- [ ] Working Media Streams bridge (mulaw ↔ our WS)
- [ ] Parakeet `transcribe(pcm) -> str` on ZGX, &lt;800ms p95
- [ ] Kokoro `synthesize(text) -> pcm` on ZGX, &lt;500ms first audio
- [ ] Kill switch honors `CS_KILL_SWITCH=1`
- [ ] Acceptance test above passes once

Point them at this file + `.env.example`. Scaffold already in repo:
- `services/voice/twilio_bridge.py` — place_call + TwiML Connect/Stream
- `services/voice/parakeet.py` / `kokoro.py` — stubs until local serves exist
- `GET /voice/status` · `POST /twilio/voice`
- Hub calls `place_call` on SEVERE when `CS_TWILIO_ENABLED=1`

## What we are NOT asking for
- Cloud OpenAI/Deepgram as the default path (HP story = local ZRT / on-box).
- Twilio gathering speech in the cloud.
- Changing YOLO/Qwen thresholds.
