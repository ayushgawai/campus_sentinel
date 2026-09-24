# context.md
Last updated: 2026-09-24 (ayush) — FALL→WEAPON contract divert; CallBrief assembler

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
# ONE GPU job only
CS_VISION_SEVILLE=1 CS_VISION_STEP_S=0.45 CS_VISION_COOLDOWN_S=12 \
  services/vision/.venv/bin/python -m services.api --host 127.0.0.1 --port 8080
# Mac tunnel: ssh -L 8080:127.0.0.1:8080 zgx-b505
```

## Done (Ayush)
- contracts v1.1 WEAPON divert + brain adjudicate/fuse/audit/from_vision
- CallBrief assembler (`services/brain/call_brief.py`) — facts only
- api WS/MJPEG + throttled Seville vision bridge (normalized boxes)
- compose: api service + mediamtx stub under profile `full`

## Still open (not UI)
- Live ZRT multimodal classify (FrameBundle → HTTP) — forced only today
- Voice service empty (Pratham)
- Ambient clips + real thresholds (Naman)
- OSNet / mediamtx live RTSP
- make up/demo end-to-end clean-clone

## Ownership
Ayush: brain/api/compose · Pratham: vision/voice · Manav: web · Naman: data/bench
