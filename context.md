# context.md
Last updated: 2026-09-24 (ayush) — architecture audit + D6/A2/A3/E4 fixes

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
```
- Qwen **0.55** required for YOLO coexistence. Does **not** change FP8 precision.
- Lab: `http://100.83.170.35:8765/lab.html` · API `:8080` · clips outside git (FileSource).
- Kill switch: `CS_KILL_SWITCH=1` blocks SEVERE voice dispatch.

## Done
- Live C→D→E path: YOLO-pose + ByteTrack + rules + VadCLIP → ZRT A+**B** → fuse → thresholds → voice tools + HITL
- `data/scenario.json`, enriched `camera_map.json`, `services/brain/guardrails.py`
- `AUDIT.md` full step table (INTENTIONAL / MISSED / fixed)

## In progress / open
- MediaMTX · Twilio/Parakeet/Kokoro · OSNet weights · temp calibration fit · officer F1 polish (Indraneel)
- VadCLIP load warning (“random init”) — verify weights path

## Ownership
Ayush: brain/api/lab/audit · Pratham: vision/voice · Indraneel: web · Naman: data/clips
