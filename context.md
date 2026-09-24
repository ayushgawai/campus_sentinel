# context.md
Last updated: 2026-09-24 (ayush) — handoff to Indraneel + live perf script

## HARD RULES
1. `git pull --rebase origin main` before every push. Work on **main**.
2. Update this file in the same commit as the work.
3. Stay in ownership paths. Contracts change = group decision (logged below).
4. Keep under ~150 lines.
5. Playbook is base; record deviations here.

## CONTRACT DECISION (2026-09-24)
- **IncidentClass:** `FALL` → **`WEAPON`**. Set: `WEAPON | FIGHT | THEFT | RUN | MEDICAL | BENIGN`
- **schema_version:** IncidentRecord → **1.1**

## Indraneel handoff (UI)
- Officer dashboard: `web/index.html` (yours)
- Live pipeline lab: `web/lab.html` — tracks / scores / 911 transcript / HITL broadcast
- `web/js/config.js`: `SOURCE: 'live'`, `API_BASE: 'http://100.83.170.35:8080'` (ZGX Tailscale)
- Lab page: `http://100.83.170.35:8765/lab.html` (or Mac `:8765`) — not `:8000` (ZRT owns ZGX `:8000`)

## How to run API (stable)
```bash
# ZRT/Qwen on :8000 owns VRAM — YOLO/CLIP on CPU beside it:
CS_VISION_SEVILLE=1 CS_VISION_YOLO=pt CS_VISION_DEVICE=cpu \
  CS_VISION_STEP_S=0.6 CS_VISION_COOLDOWN_S=15 \
  services/vision/.venv/bin/python -m services.api --host 0.0.0.0 --port 8080
# Perf sample: PYTHONPATH=. python3 scripts/perf_live.py --seconds 30
```

## Done
- Live Seville → YOLO/VadCLIP → Qwen → thresholds → SEVERE 911 + HITL
- `web/lab.html`, ambient placeholders, bench thresholds, OSNet stub
- `scripts/perf_live.py` → `bench/perf_latest.json`

## Still open
- Parakeet/Kokoro · real ambient · OSNet weights · clean-clone demo

## Ownership
Ayush: brain/api/compose/lab · Pratham: vision/voice · **Indraneel: web/** · Naman: data/bench
