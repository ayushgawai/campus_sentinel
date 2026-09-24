# context.md
Last updated: 2026-09-24 (ayush) — live pipeline lab (real YOLO/VadCLIP/Qwen)

## HARD RULES
1. `git pull --rebase origin main` before every push. Work on **main**.
2. Update this file in the same commit as the work.
3. Stay in ownership paths. Contracts change = group decision (logged below).
4. Keep under ~150 lines.
5. Playbook is base; record deviations here.

## CONTRACT DECISION (2026-09-24)
- **IncidentClass:** `FALL` replaced by **`WEAPON`**. Six-class set is now:
  `WEAPON | FIGHT | THEFT | RUN | MEDICAL | BENIGN`
- **Why:** Seville armed-chase is the demo primary; "person down"/FALL was the wrong hero class.
- **schema_version:** IncidentRecord → **1.1**
- Pose rule name `fall` may still fire inside vision; wire token / VLM class is **WEAPON**.
- VadCLIP prompts include weapon. Web mirror + demo scenario id `armed-intruder` (legacy `person-down` aliases to WEAPON).

## How to run (stable)
```bash
# ZRT/Qwen on :8000 uses most VRAM — run YOLO/CLIP on CPU beside it:
CS_VISION_SEVILLE=1 CS_VISION_YOLO=pt CS_VISION_DEVICE=cpu \
  CS_VISION_STEP_S=0.6 CS_VISION_COOLDOWN_S=15 \
  services/vision/.venv/bin/python -m services.api --host 127.0.0.1 --port 8080
# Mac: ssh -L 8080:127.0.0.1:8080 zgx-b505
# Lab: cd web && python3 -m http.server 8000 → http://127.0.0.1:8000/lab.html
```

## Done
- contracts v1.1 WEAPON + brain adjudicate/fuse/CallBrief
- api WS/MJPEG + throttled Seville vision bridge → live ZRT when healthy
- Voice on any SEVERE upsert (live or scenario); transcript AI↔911 stand-in
- Ambient cam-04..06 placeholders; bench thresholds; OSNet stub; mediamtx paths
- **`web/lab.html`** live-only test UI (tracks, scores, 911, HITL broadcast)
- Indraneel’s officer `web/index.html` untouched

## Still open
- Real Parakeet/Kokoro (911 human later)
- Real ambient CCTV + OSNet weights
- make up/demo clean-clone

## Ownership
Ayush: brain/api/compose/lab · Pratham: vision/voice · Indraneel: officer web · Naman: data/bench
