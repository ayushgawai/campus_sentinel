# context.md
Last updated: 2026-09-24 (pratham) — Qwen lean serve 0.40 so idle KV cache does not hog the box

## HARD RULES
1. `git pull --rebase origin main` before every push. Work on **main**.
2. Update this file in the same commit as the work.
3. Stay in ownership paths. Contracts change = group decision (logged below).
4. Keep under ~150 lines.
5. Playbook is base; record deviations here.

## CONTRACT DECISION (2026-09-24)
- **IncidentClass:** `FALL` → **`WEAPON`**. Set: `WEAPON | FIGHT | THEFT | RUN | MEDICAL | BENIGN`
- **schema_version:** IncidentRecord → **1.1**

## Git identity (ZGX repo)
- Local `user.name` / `user.email` = **ayushgawai** (was pgala3183; fixed).
- Push creds = ayushgawai. Old gala-authored commits rewritten on `main`.

## Runtime / GPU (GB10 unified ~122 GiB)
- **Qwen KV cache is the RAM hog, not the weights (~31 GiB).** vLLM pre-allocates cache up to `--gpu-memory-fraction`.
- **Lean serve: `--gpu-memory-fraction 0.40` + `--max-num-seqs=1`.** Measured Ready: **45.9 GB VRAM**, unified **65.1 / 121.6 GB**, ~56 GB available. Was 0.87≈102 GB then 0.55≈64 GB. Still FP8; enough for one 16-frame escalate.
- Bring-up:
```bash
zrt serve hf:Qwen/Qwen3-VL-30B-A3B-Instruct-FP8 --force --gpu-memory-fraction 0.40 \
  --extra "--max-model-len=8192" --extra "--max-num-seqs=1"
CS_VISION_SEVILLE=1 CS_VISION_YOLO=pt CS_VISION_DEVICE=cuda:0 \
  CS_VISION_STEP_S=0.5 CS_VISION_COOLDOWN_S=12 \
  services/vision/.venv/bin/python -m services.api --host 0.0.0.0 --port 8080
```
- Clips: `~/Documents/campus_sentinel_media/feeds/seville_option1_3cam_locked/` (outside git). Hot path = **FileSource** (mediamtx stubbed, not required for demo).
- Lab UI: `http://100.83.170.35:8765/lab.html` · API `http://100.83.170.35:8080` · not `:8000` for static (ZRT).
- Officer dashboard: `web/index.html` → **Indraneel**. `web/js/config.js`: `SOURCE: live`, Tailscale API_BASE.

## Perf snapshot (30s WS, GPU router + Qwen 0.40)
- Overlay ~**5.4 Hz** (was ~2.4 Hz on CPU YOLO); gap p95 ~**0.56 s**
- `/health` ~14 ms · ZRT `/v1/models` ~1 ms · MJPEG first chunk ~3.3 s (ffmpeg spawn)
- Live classify `live=True` upserts working; cooldown limits upsert rate
- Re-run: `PYTHONPATH=. python3 scripts/perf_live.py --seconds 30`

## Playbook deviations (deliver toward fig. 2 / tiers C–F)
- vision+brain+api **one process** (not five containers yet)
- MediaMTX / Twilio / Parakeet+Kokoro **not** on hot path (voice = scripted AI↔AI + HITL draft)
- OSNet = digest stub · Completion B JSON path incomplete · YOLO `.engine` preferred later if headroom allows

## Done
- Live Seville → YOLO/VadCLIP (GPU) → Qwen (ZRT) → thresholds → SEVERE voice + HITL
- `web/lab.html`, ambient cam-04..06 placeholders, `bench/thresholds.json`, OSNet stub
- `scripts/perf_live.py`

## Still open
- Parakeet/Kokoro + Twilio · mediamtx live RTSP · Completion B · OSNet weights · `make up` clean-clone · Indraneel officer polish

## Ownership
Ayush: brain/api/compose/lab · Pratham: vision/voice · **Indraneel: web/** · Naman: data/bench
