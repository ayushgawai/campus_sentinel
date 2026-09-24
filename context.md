# context.md
Last updated: 2026-09-24 (ayush) — SSHFS mount fix + Twilio .env on box

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

## Mac mount
- `~/mnt/zgx-b505` = SSHFS of `/home/hp25` via **`zgx-up`** (must show in `mount`, not a local folder).
- If Mac writes never appear on ZGX: `zgx-down && zgx-up` (script now rejects local shadow trees + verifies write-through).

## Clips (Naman) — 3 + 3 only
- **cam-01..03:** locked Seville chase (WEAPON). No 12-clip pack.
- **cam-04..06:** Naman `feeds/naman/demo_clips` — VLM-assigned. See `docs/NAMAN_CLIPS.md`.

## Voice / Twilio
- Spec: `docs/HANDOFF_VOICE_TWILIO.md` · scaffold: `twilio_bridge` / `parakeet` / `kokoro`
- SID + token on ZGX **`.env` only** (gitignored). Parakeet/Kokoro = local stubs, no cloud keys.
- **Trial block:** verify personal phone in Twilio Console → buy Voice number → set `TWILIO_FROM` + `CS_DEMO_TO_NUMBER` + `CS_PUBLIC_BASE`.
- Check: `bash scripts/check_twilio_env.sh` · `GET /voice/status`
- Until complete: scripted 911 loop still runs on SEVERE.

## Done
- Live C→D→E + Completion B + guardrails + AUDIT.md
- Officer 911 script + cross-cam whereabouts + security re-alerts
- Naman 3+3 · lab `:8765` · SSHFS mount recovered
- Health strip **measured** (`services/api/telemetry.py`): nvidia-smi GPU, router-step p95, real counters. No constants on the wire; `null` when unmeasured. GPU/p95 tiles restored.

## Pending (owners)
| Who | What |
|-----|------|
| **Naman** | Ambient clips done. Optional more later |
| **Voice / Ayush** | Verify phone → buy FROM → set TO + public HTTPS |
| **Indraneel** | Officer F1 polish |
| **Ayush / open** | OSNet weights · temp calibration · MediaMTX optional |

## Ownership
Ayush: brain/api/lab/audit · Pratham: vision/voice · Indraneel: web · Naman: data/clips
