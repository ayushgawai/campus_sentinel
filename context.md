# context.md
Last updated: 2026-09-25 - live six-camera console + severe weapon call flow

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
  CS_VISION_STEP_S=0.5 CS_VISION_COOLDOWN_S=600 \
  CS_VISION_MAX_UPSERTS_MIN=1 \
  services/vision/.venv/bin/python -m services.api --host 0.0.0.0 --port 8080
# Separate shell/tmux session:
python3 -m http.server 8090 --bind 0.0.0.0 --directory web
```
- **Detector = YOLO26s-pose `.pt` only.** TensorRT path removed (engine/onnx deleted, no export).
- **Overlay sync:** FileSource follows the configured active-camera windows. First MJPEG rewinds YOLO to t=0. `STEP_S` defaults to **0.5**. Qwen runs once on cam-01; cam-02/03 reuse that result.
- Prefer **0.40** GPU fraction when coexisting (0.55 left too little headroom and hard-locked the box).
- **32G swap is on** the shared ZGX box (`/swapfile`). Do not start Qwen at 0.55.
- A.1 UI-only: do **not** start ZRT.
- Live dashboard: `http://100.83.170.35:8090/?ws=ws%3A%2F%2F100.83.170.35%3A8080%2Fws&nosplash=1`
- Current detached sessions: `sentinel-api` and `sentinel-web`. ZRT serves Qwen on `127.0.0.1:8000`.

## Mac mount
- `~/mnt/zgx-b505` = SSHFS of `/home/hp25` via **`zgx-up`** (must show in `mount`, not a local folder).
- If Mac writes never appear on ZGX: `zgx-down && zgx-up` (script now rejects local shadow trees + verifies write-through).

## Clips (Naman) — 3 + 3 only
- **cam-01..03:** locked Seville chase (WEAPON). No 12-clip pack.
- **cam-04..06:** Naman `feeds/naman/demo_clips` — VLM-assigned. See `docs/NAMAN_CLIPS.md`.

## Voice / Twilio
- Spec: `docs/HANDOFF_VOICE_TWILIO.md` · scaffold: `twilio_bridge` / `parakeet` / `kokoro`
- SID + token on ZGX **`.env` only** (gitignored). Parakeet/Kokoro = local stubs, no cloud keys.
- **Trial block, verified live against Twilio's API 2026-09-25:** account type is **Trial**, 0 verified caller IDs, 0 owned numbers. Still need: buy a Voice number (`TWILIO_FROM`), verify the demo phone as a Caller ID in Console (`CS_DEMO_TO_NUMBER`, E.164 — trial accounts reject unverified `to`), and a public HTTPS tunnel to `:8080` (`CS_PUBLIC_BASE`, e.g. Tailscale Funnel/ngrok — none running yet).
- Check: `bash scripts/check_twilio_env.sh` · `GET /voice/status`
- **`/twilio/media` Media Streams bridge landed** (`services/voice/media_bridge.py` + `services/api/server.py` `_twilio_media`/voice-subscriber fan-out on `broadcast()`). Voices every live `call.transcript_delta` `speaker=="sentinel"` line over the real call via Kokoro (falls back to a short tone if Kokoro has nothing, never dead air). Replays already-said sentinel lines from `hub.replay_events()` on connect (script starts on dispatch, phone may answer seconds later). Inbound caller audio → Parakeet → published back as `CallTranscriptDelta(speaker="dispatcher", ...)` in ~2s batches (no VAD, that's the accepted demo shortcut per the handoff doc). Respects `CS_KILL_SWITCH`.
- **Kokoro + Parakeet are both actually serving now**, CPU-only, isolated venv (`services/voice/.venv` — never `services/vision/.venv`, so none of this touches the live process's deps): `scripts/serve_kokoro.py` (real Kokoro-82M, ~1.7s per short line, one-time ~6s pipeline load) and `scripts/serve_parakeet.py` (**faster-whisper**, not NeMo Parakeet — NeMo is 236 deps incl. CUDA bindings, too risky to install into a venv near the live GPU process on this box; same `transcribe(pcm)->str` contract, swap later if NVIDIA branding matters for judging). Both currently running as background processes (pids logged in this session, not yet in a tmux/screen session like `sentinel-api`/`sentinel-web` — should move there for demo-day reliability). `CS_KOKORO_URL`/`CS_PARAKEET_URL` set in `.env` (port 8093 for parakeet, not the `.env.example`-suggested 8091 — that port was already taken by someone's `http.server` on this shared box).
- Full round-trip tested for real: Kokoro synthesizes a script line → mulaw over a fake Twilio socket → decoded back → Parakeet transcribes it → near-exact match. Inbound path tested the same way in reverse (simulated caller audio → transcribed → published as a dispatcher line). Not yet tested against an actual Twilio call — account still has no number/verified caller ID.
- Stub docstrings say Parakeet/Kokoro land with **Naman**, ownership table says **Pratham** owns `voice/` — Naman is doing it now, table should be updated.
- The current WEAPON demo is promoted to SEVERE, transitions to DISPATCHED, and starts a **simulated** call transcript labeled for `4083872138` (hardcoded display text in `agent.py:190`, not read from `CS_DEMO_TO_NUMBER` — fix before relying on it once a real number is set). It does not place a real phone call today.

## Done
- Live C→D→E + Completion B + guardrails + AUDIT.md
- Officer 911 script + cross-cam whereabouts + security re-alerts
- Naman 3+3 · lab `:8765` · SSHFS mount recovered
- Health strip **measured** (`services/api/telemetry.py`): nvidia-smi GPU, router-step p95, real counters. No constants on the wire; `null` when unmeasured. GPU/p95 tiles restored.
- **Live wall:** canonical `cam-01` IDs end to end. cam-01..03 use MJPEG; cam-04..06 use browser-decoded MP4 and never enter YOLO/Qwen.
- **Reconnect:** every WebSocket client receives camera state plus a bounded replay of incidents, dispatch state, transcript, and tool events.
- **web:** Sentinel console (plain HTML/JS, no build) - splash, Live Operations camera wall, auto-open call sidebar, Incidents / Call Console / System pages, and Demo controls. Mock remains available without `?ws=`. (manav)

## Pending (owners)
| Who | What |
|-----|------|
| **Naman** | Ambient clips done. Optional more later |
| **Voice / Ayush** | Verify phone → buy FROM → set TO + public HTTPS |
| **Indraneel** | Officer F1 polish |
| **Ayush / open** | OSNet weights · temp calibration · MediaMTX optional |
| **Ayush / api** | REST routes: confirm, dismiss, demo reset |
| **Ayush / api** | CallBrief event (when available) |

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
