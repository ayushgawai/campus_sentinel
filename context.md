# context.md
Last updated: 2026-09-24 (ayush) — 911 script + 3+3 clips + Twilio handoff

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

## Runtime (GB10)
```bash
zrt serve hf:Qwen/Qwen3-VL-30B-A3B-Instruct-FP8 --force --gpu-memory-fraction 0.55 \
  --extra "--max-model-len=8192"
CS_VISION_SEVILLE=1 CS_VISION_YOLO=pt CS_VISION_DEVICE=cuda:0 \
  CS_VISION_STEP_S=0.5 CS_VISION_COOLDOWN_S=12 \
  services/vision/.venv/bin/python -m services.api --host 0.0.0.0 --port 8080
# Lab static (Mac + ZGX) — separate from API
cd web && python3 -m http.server 8765 --bind 0.0.0.0
```
- Qwen **0.55** required for YOLO coexistence. Does **not** change FP8 precision.
- Lab: `http://100.83.170.35:8765/lab.html` (ZGX) · Mac Tailscale `:8765` · API `:8080`
- Kill switch: `CS_KILL_SWITCH=1` blocks SEVERE voice dispatch.

## Clips (Naman) — 3 + 3 only
- **cam-01..03:** locked Seville chase (WEAPON). No 12-clip pack.
- **cam-04..06:** Naman `feeds/naman/demo_clips` — VLM-assigned (parking / lobby / walkway). See `docs/NAMAN_CLIPS.md` + `data/naman_ambient_assign.json`.
- Placeholders remain as fallback if Naman pack missing.

## Voice / Twilio handoff
- Spec: **`docs/HANDOFF_VOICE_TWILIO.md`** (Twilio Media Streams + Parakeet ASR + Kokoro TTS).
- Never dial real emergency numbers. Demo phone allowlist only.
- Until phones land: officer Q&A in `services/voice/agent.py`; cam-02/03 → `notify_whereabouts` + `security_alert:*`.
- Self-check: `python3 -m services.voice.check`

## Done
- Live C→D→E + Completion B + guardrails + AUDIT.md
- Officer 911 script + cross-cam whereabouts + security re-alerts (hub wired)
- Naman 3+3 + Twilio handoff docs · lab on `:8765`

## Pending (owners)
| Who | What |
|-----|------|
| **Naman** | Done for ambient — 3 clips wired. Optional: more natural basement/road later |
| **Voice owner** | Twilio Media Streams + Parakeet + Kokoro (`docs/HANDOFF_VOICE_TWILIO.md`) |
| **Indraneel** | Officer F1 polish (same WS events as lab) |
| **Ayush / open** | OSNet weights · temp calibration fit · MediaMTX optional |

## Runtime status (2026-09-24)
- ZRT `:8000` @ **0.55** + API `:8080` Seville bridge **up** (restarted this session).
- Lab `:8765` Mac + ZGX. VadCLIP “random init” warning = open_clip before local `.pt` load (weights on disk).

## Ownership
Ayush: brain/api/lab/audit · Pratham: vision/voice · Indraneel: web · Naman: data/clips
