# context.md
Last updated: 2026-09-24 (ayush) — GB10 stability: 0.40 Qwen fraction + 32G swap

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
CS_VISION_SEVILLE=1 CS_VISION_YOLO=pt CS_VISION_DEVICE=cuda:0 \
  CS_VISION_STEP_S=0.5 CS_VISION_COOLDOWN_S=12 \
  services/vision/.venv/bin/python -m services.api --host 0.0.0.0 --port 8080
```
- Prefer **0.40** GPU fraction when coexisting (0.55 left too little headroom and hard-locked the box).
- **32G swap is on** the shared ZGX box (`/swapfile`). Do not start Qwen at 0.55.
- A.1 UI-only: do **not** start ZRT.

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
