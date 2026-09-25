# context.md
Last updated: 2026-09-25 - complete live-wiring baseline and design

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
- Current detached sessions: `sentinel-api` and `sentinel-web`. ZRT serves Qwen on `127.0.0.1:8000`.

## Mac mount
- `~/mnt/zgx-b505` = SSHFS of `/home/hp25` via **`zgx-up`** (must show in `mount`, not a local folder).
- If Mac writes never appear on ZGX: `zgx-down && zgx-up` (script now rejects local shadow trees + verifies write-through).

## Clips (Naman) — 3 + 3 only
- **cam-01..03:** locked Seville chase (WEAPON). No 12-clip pack.
- **cam-04..06:** Naman `feeds/naman/demo_clips` — VLM-assigned. See `docs/NAMAN_CLIPS.md`.

## Voice / SignalWire
- Active provider: SignalWire Compatibility API (`signalwire_bridge`); legacy `twilio_bridge` remains inactive only for rollback. Credentials live in ZGX **`.env` only** (gitignored).
- Outbound calls use `/signalwire/voice`; bidirectional audio uses `/signalwire/media`. `GET /voice/status` reports configuration without returning secrets. `CS_KILL_SWITCH=1` blocks calling.
- The media bridge voices live `speaker=="sentinel"` transcript lines via Kokoro and sends inbound caller audio through Parakeet in ~2 s batches. SignalWire's live stream event compatibility still requires one real-call validation.
- Kokoro/Parakeet endpoints are configured for ports 8092/8093, but neither speech process is currently listening. Start them in tmux before the real audio test; their isolated `services/voice/.venv` does not touch the live vision environment.
- Local round-trip tested: Kokoro → mulaw compatibility stream → Parakeet → near-exact transcript. Provider transport is pending the first SignalWire call.
- Stub docstrings say Parakeet/Kokoro land with **Naman**, ownership table says **Pratham** owns `voice/` — Naman is doing it now, table should be updated.
- The WEAPON demo promotes to SEVERE, transitions to DISPATCHED, starts the scripted transcript, and places a SignalWire call when enabled. Qwen adjudicates the visual event; live dispatcher answers remain scripted until a grounded conversational loop is explicitly added.

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
- web: real SJSU site map (OpenStreetMap export, attribution and 'Illustrative layout' note), cameras named and placed on the backend camera graph, pursuit along walkways, ?map=plan fallback, ?mapedit=1 placement tool (fix 9b)

## Pending (owners)
Design and verified pre-change baseline: `docs/superpowers/specs/2026-09-25-complete-live-wiring-design.md`.

| Who | What |
|-----|------|
| **Naman** | Ambient clips done. Optional more later |
| **Voice / Ayush** | Validate SignalWire media events on one real call |
| **Indraneel** | Officer F1 polish |
| **Ayush / open** | OSNet weights · temp calibration · MediaMTX optional |
| **Ayush / api** | REST routes: confirm, dismiss (demo reset is already WS) |
| **Ayush / api** | CallBrief event (when available) |
| **Ayush / api** | POST /api/incidents/manual, /api/incidents/{id}/dispatch, /api/broadcast, /confirm, /dismiss; CORS allow POST from :8090; rules_fired ['operator_report'] on manual incidents (blocks web fix 5 live path) |
| **Ayush / api** | Send camera.online per camera every few seconds as a heartbeat, and camera.online false when a feed stops |

## Decisions made since the playbook
- UI branded **Sentinel**; cameras only as Camera 1–6; no place names in UI or mock (public video). (manav)
- Mock-only UI: predicted next camera, clip from local video, confirm/dismiss in mock. (manav)
- API now emits normalized 0–1 boxes; the UI and API use canonical hyphenated camera IDs.
- The API exposes `/mjpeg/{cam}` for cam-01..03 and byte-range `/media/{cam}` for ambient cam-04..06.
- **SIMULATED** on every call and dispatch surface. (manav)
- Deployment is Docker Compose only.
- WS overlays are `overlay.boxes` only.

## Ownership
Ayush: brain/api/lab/audit · Pratham: vision/voice · **Manav: web/** · Naman: data/clips
