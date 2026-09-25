# context.md
Last updated: 2026-09-25 - live voice conversation and audio validation

## HARD RULES
1. `git pull --rebase origin main` before every push. Work on **main**.
2. Update this file in the same commit as the work.
3. Stay in ownership paths. Contracts change = group decision (logged below).
4. Keep under ~150 lines.
5. Playbook is base; record deviations here. See **AUDIT.md** for step table.

## CONTRACT DECISION (2026-09-24)
- **IncidentClass:** `FALL` → **`WEAPON`**. Set: `WEAPON | FIGHT | THEFT | RUN | MEDICAL | BENIGN`
- **schema_version:** IncidentRecord → **1.1**
- Hero demo = **Seville armed chase / WEAPON**, not medical-fall (pose rule `fall` may still fire).

## Runtime (GB10) — STABILITY FIRST
See **`docs/STABILITY.md`**. Box had repeated **hard crashes** under Qwen+YOLO (NVRM OOM, no swap).
```bash
# Always: bash scripts/preflight_gb10.sh
zrt serve hf:Qwen/Qwen3-VL-30B-A3B-Instruct-FP8 --force --gpu-memory-fraction 0.40 \
  --extra "--max-model-len=8192"
# YOLO CUDA only after ZRT is healthy; or use CS_VISION_DEVICE=cpu for light tests
CS_VISION_SEVILLE=1 CS_VISION_DEVICE=cuda:0 \
  CS_VISION_STEP_S=0.5 CS_VISION_CONF=0.50 CS_VISION_COOLDOWN_S=600 \
  CS_VISION_MAX_UPSERTS_MIN=1 \
  services/vision/.venv/bin/python -m services.api --host 0.0.0.0 --port 8080
# Separate shell/tmux session:
python3 -m http.server 8090 --bind 0.0.0.0 --directory web
```
- **Detector = YOLO26s-pose `.pt` only.** TensorRT path removed (engine/onnx deleted, no export).
- **Overlay sync:** FileSource follows the configured active-camera windows. First MJPEG rewinds YOLO to t=0. `STEP_S` defaults to **0.5** and `CONF` to **0.50**. The dashboard gets explicit empty overlays for inactive cameras and only the strongest known demo subject as `Person #1`; Qwen runs once on cam-01 and cam-02/03 reuse that result.
- Prefer **0.40** GPU fraction when coexisting (0.55 left too little headroom and hard-locked the box).
- **32G swap is on** the shared ZGX box (`/swapfile`). Do not start Qwen at 0.55.
- A.1 UI-only: do **not** start ZRT.
- Live dashboard: `http://100.83.170.35:8090/?ws=ws%3A%2F%2F100.83.170.35%3A8080%2Fws&nosplash=1`
- For recording use the same URL without &nosplash=1 so the brand intro plays.
- Current detached sessions: `sentinel-api`, `sentinel-web`, `sentinel-asr`, and `sentinel-tts`. ZRT serves Qwen on `127.0.0.1:8000`.

## Mac mount
- `~/mnt/zgx-b505` = SSHFS of `/home/hp25` via **`zgx-up`** (must show in `mount`, not a local folder).
- If Mac writes never appear on ZGX: `zgx-down && zgx-up` (script now rejects local shadow trees + verifies write-through).

## Clips (Naman) — 3 + 3 only
- **cam-01..03:** locked Seville chase (WEAPON). No 12-clip pack.
- **cam-04..06:** Naman `feeds/naman/demo_clips` — VLM-assigned. See `docs/NAMAN_CLIPS.md`.

## Voice / SignalWire
- Active provider: SignalWire Compatibility API (`signalwire_bridge`) is the only outbound voice provider. Credentials live in ZGX **`.env` only** (gitignored).
- Outbound calls use `/signalwire/voice`; bidirectional audio uses `/signalwire/media`. `GET /voice/status` reports configuration without returning secrets. `CS_KILL_SWITCH=1` blocks calling.
- The media bridge voices live `speaker=="sentinel"` transcript lines via Kokoro and closes dispatcher turns after 500 ms of silence. One worker serializes ASR and answers; overlong 15-second/noisy turns are discarded as one turn instead of split into multiple answers.
- Kokoro and faster-whisper endpoints are live on ports 8092/8093 in an isolated `services/voice/.venv`; the UI keeps the historical Parakeet label, but the runtime backend is faster-whisper `base.en` on CPU.
- SignalWire outbound calling, public WSS media, inbound audio, ASR, Qwen fallback, Kokoro return audio, and dashboard transcript transport were validated on real calls. The final demo tmux session runs with `CS_SIGNALWIRE_ENABLED=1`; use `CS_KILL_SWITCH=1` before non-call testing.
- API/WebSocket startup now seeds only camera and health state; it never creates the synthetic armed-intruder incident. Demo scenarios must be triggered explicitly, preventing provider-enabled restarts from placing an extra call before the intended dispatch.
- A later looping-vision incident can never invoke SignalWire while a voice call is already active. The shared dispatch boundary blocks it as `voice_busy`; same-incident Camera 1 to 2 to 3 handoffs continue updating the existing call.
- Phone-codec local simulation transcribed emergency, exact-address, repeat, current-location, and unknown-detail questions exactly. Time from end of speech to generated answer audio was 0.75 to 1.20 seconds; deterministic text answers were under 1 ms and one Qwen refusal took 365 ms.
- A live conversational call exposed acoustic echo/noise fragments that repeatedly triggered the unknown-detail response. The media bridge now ignores inbound audio during Sentinel speech and for a 500 ms echo tail; acknowledgements and non-question fragments produce no answer. Operators must wait until Sentinel finishes speaking because barge-in is intentionally disabled for this demo path.
- Unmatched questions now get an immediate short checking line before the Qwen lookup. Final replies are limited to one sentence, unknown visual details rotate between two natural camera-grounded answers, and medical/identity/visibility refusals use short context-specific wording instead of one repeated stock response.
- Live-call timing showed Qwen replies arriving 0.28-1.02 seconds after dispatcher transcription; the perceived silence was before that, during turn closure and CPU ASR. Caller turns with about one second or more of speech now publish one rotating filler before ASR and transcribe while it is spoken; shorter turns get no filler, ASR misses ask for a repeat, and the agent no longer adds a second Qwen-stage filler.
- **Phone TTS (opt-in):** `CS_TTS_PROVIDER=elevenlabs` + `ELEVENLABS_API_KEY` (`.env` only) speaks call audio through ElevenLabs `eleven_flash_v2_5`, premade voice Sarah, `ulaw_8000` straight onto the media stream. Lines are **streamed**: each call's media bridge keeps one keep-alive HTTPS connection (TLS warmed when the stream opens, reconnect once if stale) to `/stream` with `optimize_streaming_latency=3` (`CS_ELEVENLABS_LATENCY`), and frames go out as chunks arrive. No first chunk within `CS_ELEVENLABS_FIRST_CHUNK_S` (default 1.5) or any error before audio → that line is spoken by Kokoro instead, never both; a mid-line failure just ends the line. Socket timeout is `CS_ELEVENLABS_TIMEOUT_S` (default 4). 401/402/403 (bad key, quota) parks ElevenLabs for 10 min. Fillers and the repeat prompt are prewarmed and cached per process. Echo suppression is unchanged (inbound ignored while streaming + 500 ms tail). `/voice/status.tts` shows the provider, never the key. **Free tier: 10,000 chars/month**; check.py mocks it. Measured from ZGX 2026-09-25 (short line): old path 260 ms until playable (whole body; earlier runs saw 1.7-2.0 s), streamed on a warm connection 157-160 ms to first chunk; Kokoro 0.10 s for a whole clip. Default stays Kokoro; enabling needs an API restart.
- Stub docstrings say Parakeet/Kokoro land with **Naman**, ownership table says **Pratham** owns `voice/` — Naman is doing it now, table should be updated.
- The WEAPON demo promotes to SEVERE and uses the scripted transcript only while SignalWire is disabled. When enabled, the live call uses a short SJSU/MacQuarrie opener, answers one dispatcher question at a time, remembers repeat requests, publishes dispatcher speech to the dashboard, uses current-camera facts for common answers, and reserves bounded Qwen for unmatched questions.
- Live call facts advance only on observed Camera 1 to 2 to 3 handoffs. Overlay presence also updates whether the person is currently visible, so the agent does not claim a subject remains on screen after the box clears.
- Only upserts for the active incident can advance a live call, and a repeated upsert on the same camera produces no extra narration.

## Canonical demo site
- `data/camera_map.json` is the source for San Jose State University / MacQuarrie Hall response facts. Cameras 1-3 represent the ground-floor lobby, east corridor, and west corridor/stairwell; each exposes only its current scene facts to voice logic.
- The verified mailing address used for the demo is One Washington Square, San Jose, CA 95192. Per-camera coordinates are demo map anchors, not surveyed emergency-response coordinates.

## Live operator actions
- `DemoHub` is the in-memory authority for the current demo run. Manual report, dispatch, confirm, dismiss, broadcast, and reset now use REST and publish through the existing incident WebSocket events; live UI actions no longer claim local success when the API is unavailable.
- Reset clears incidents, replay, counters, voice state, guardrail history, and the manual incident sequence, then restores only camera/health baseline state.

## Live readiness
- Camera heartbeats are limited to the six configured wall feeds and report file-backed availability. `/voice/status` now probes the ASR and TTS `/health` endpoints with a short timeout; configured URLs alone are not reported Ready.
- The frontend CSP permits HTTP(S) API probes while retaining the existing strict script/style policy.

## Frontend redesign
- The new Live Operations layout is integrated on main in `5fe1f80`; the prior frontend remains recoverable from git at `5db9808`. `docs/FRONTEND_REDESIGN_PROMPT.md` is the clean-sheet brief used for the redesign.

## Done
- Live C→D→E + Completion B + guardrails + AUDIT.md
- Officer 911 script + cross-cam whereabouts + security re-alerts
- Naman 3+3 · lab `:8765` · SSHFS mount recovered
- Health strip **measured** (`services/api/telemetry.py`): nvidia-smi GPU, router-step p95, real counters. No constants on the wire; `null` when unmeasured. GPU/p95 tiles restored.
- **Live wall:** canonical `cam-01` IDs end to end. cam-01..03 use MJPEG; cam-04..06 use browser-decoded MP4 and never enter YOLO/Qwen.
- **Reconnect:** every WebSocket client receives camera state plus a bounded replay of incidents, dispatch state, transcript, and tool events.
- **Reset / looping:** visible topbar Reset rewinds all six feeds, clears incidents/call transcript/overlays/counters, resets tracker state to `Person #1`, and keeps YOLO/VadCLIP/Qwen resident. Natural EOF resets tracker state too.
- **web:** Sentinel console (plain HTML/JS, no build) - splash, Live Operations camera wall, auto-open call sidebar, Incidents / Call Console / System pages, and Demo controls. Mock remains available without `?ws=`. (manav)
- web: map pins pulse and label active incidents (fix 1)
- web: All cameras button, Esc and 5 s auto return to grid (fix 2)
- web: live clock, one shared ticker, real time in live and mock (fix 3)
- web: floating incidents panel with a second call panel beside it, autofollow keeps map and call visible during tracking (fix 4)
- web: operator actions (report incident, call for help, broadcast) with local fallback until api routes exist; cleaner incident detail panel (wider, merged details card, aligned action bar); fixed swallowed clicks (fix 5, 5b)
- web: professional wording, Demo control redesign (collapsible sections, intro section removed), splash reveal in CSS starting on first paint and independent of video loading, js/boot.js for ?nosplash=1, module cache busting with one ?v= tag (bump it on every change), All cameras in camera toolbar (fix 7 to 7d)
- web: AI models card and System page AI models section (models actually running); System page rebuilt (full height camera status grid, stat cards); one camera status helper for tiles, pins, lists and header (MJPEG online from first frame until error, with 5 s retry; video online from frames; 10 s timeout); removed hard-coded fps (fix 10 to 10h)
- web: SignalWire voice wiring (`2f5a0d0`) - call label shows SignalWire call / SignalWire call failed / Simulated call from the live provider state (idle label follows `/voice/status` `signalwire.configured`); backend reset clears every open dashboard; `voice_busy` blocked auto-calls show the "Declined by server" note; incident-not-found errors surface. JS only, no styling. (ayush)
- voice: Twilio removed (`af75737`); SignalWire is the only provider. (ayush)
- brain: temperature-calibration plumbing, default off. `CS_CALIB_LOG` writes JSONL, `scripts/fit_temperature.py` fits T, `CS_VLM_TEMPERATURE` applies it (1.0 = identity). There is no labelled data yet, so T is not fitted. (ayush)
- voice: ElevenLabs phone TTS with Kokoro fallback, opt-in via `CS_TTS_PROVIDER=elevenlabs` (see Voice). (ayush)
- web: real SJSU site map (OpenStreetMap export, attribution and 'Illustrative layout' note), cameras named and placed on the backend camera graph, pursuit along walkways, ?map=plan fallback, ?mapedit=1 placement tool (fix 9b)

## Pending (owners)
Design and verified pre-change baseline: `docs/superpowers/specs/2026-09-25-complete-live-wiring-design.md`.

| Who | What |
|-----|------|
| **Naman** | Ambient clips done. Optional more later |
| **Voice / Ayush** | Decide whether to enable ElevenLabs on the live call. It sounds more natural; streaming now starts uncached lines in about 0.16 s; do a real-call listen test with `CS_TTS_PROVIDER=elevenlabs` |
| **Indraneel** | Officer F1 polish |
| **Ayush / open** | See `docs/OPEN_ML_ITEMS.md`. OSNet: stub with no callers; needs model code, weights, a crop path and a handoff consumer. Temperature: collect labelled rows with `CS_CALIB_LOG`, run `scripts/fit_temperature.py`, set `CS_VLM_TEMPERATURE`. MediaMTX: optional, document only; keep FileSource for the demo |
| **Group → Ayush / api** | CallBrief event: **blocked on a contract decision, not data.** `assemble_call_brief()` already works, but `contracts/events.py` (frozen) has no brief event type, and the 2026-09-25 wiring spec/plan chose *not* to add one (the call panel reads `incident.upsert`). To proceed, the group must approve adding `call.brief` (payload = `call_brief_to_dict`) to `EventType`; the hub would then publish it on dispatch/handoff through the normal replay path |
| **Web / Manav** | Browser-test the SignalWire wiring (`2f5a0d0`) against the live API; `node web/check.mjs` was not run (no node on ZGX) |
| **Web / Manav** | Bump the `?v=` module cache tag for `store.js`, `transport.js`, `actions.js`, `modelStatus.js`, `ui/call.js`, `ui/operator.js` |
| **Web / Manav** | Uncommitted on ZGX main: `live.js` leader-lines-under-dock order + 150 ms leave (`app.css`); review and commit or drop |
| **Web / Manav** | Remote reset clears state but does not rewind camera videos on other dashboards |
| **Web / Manav** | Load `GET /api/site` instead of the duplicated camera map in `site.js` |

## Decisions made since the playbook
- UI branded **Sentinel**; cameras only as Camera 1–6; no place names in UI or mock (public video). (manav)
- Mock-only UI: predicted next camera, clip from local video, confirm/dismiss in mock. (manav)
- API now emits normalized 0–1 boxes; the UI and API use canonical hyphenated camera IDs.
- The API exposes `/mjpeg/{cam}` for cam-01..03 and byte-range `/media/{cam}` for ambient cam-04..06.
- Call surfaces show the live provider state (SignalWire call / Simulated call); dispatch stays labelled **SIMULATED**. (ayush)
- Deployment is Docker Compose only.
- WS overlays are `overlay.boxes` only.

## Ownership
Ayush: brain/api/lab/audit · Pratham: vision/voice · **Manav: web/** · Naman: data/clips
