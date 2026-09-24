# context.md
Last updated: 2026-09-24 (ayush) — Seville full PASS; vision→api bridge ready to merge

## HARD RULES (do not skip)
1. **Pull before push.** Always `git pull --rebase origin main` before every push. Work on **`main`** (no long-lived feature branches overnight).
2. **Update this file after every finished piece**, in the **same commit** as the work.
3. **Stay in your ownership paths.** Especially do not change `contracts/` after freeze without a group message.
4. Keep this file under ~150 lines. State only — no design essays (playbook).
5. **Playbook is the base plan.** Deviate only on real test failure or reviewed unblock; record **why** here.

## How to run it right now
```bash
git checkout feat/pratham/vision-router && git pull
make check
# Seville live router:
services/vision/.venv/bin/python services/vision/run_seville.py --max-steps 90
services/vision/.venv/bin/python services/vision/run_seville.py
# api + live vision overlays/escalations (needs vision venv):
CS_VISION_SEVILLE=1 services/vision/.venv/bin/python -m services.api
```

## Demo media (outside git)
- Locked 3-cam: `Documents/campus_sentinel_media/feeds/seville_option1_3cam_locked/`
- Path map: `data/feeds/seville_option1_3cam_locked.json`

## Ownership
| Path | Owner |
|------|--------|
| `contracts/` | shared — frozen v1.0 |
| `services/brain/`, `services/api/`, compose, Makefile | Ayush |
| `services/vision/`, `services/voice/` | Pratham |
| `web/` | Manav — leave alone |
| `data/`, `bench/`, `docs/` | Naman |

## Done
- contracts + brain adjudicate/fuse/audit + from_vision map (ayush)
- api :8080 WS/MJPEG + optional `CS_VISION_SEVILLE` bridge (ayush)
- vision-router: YOLO TRT, ByteTrack, rules, VadCLIP, FileSource (pratham)
- **Seville full PASS (ZGX):** 1699 frames / 88 esc / ~50s wall; max boxes CAM-01:10 CAM-02:4 CAM-03:4

## In progress
- Merge `feat/pratham/vision-router` → `main`
- Live ZRT classify from FrameBundle (still forced)

## Blocked
- Ambient fillers + real thresholds (Naman)
- Fight/theft clips to bench VadCLIP (theft firing on lobby chase — revisit)

## Decisions
- Wire ids: vision `CAM-01` → api/web `cam-01` via `normalize_camera_id`
- Do not touch `web/` while Manav works
- Vision bridge cooldown default 8s per (cam, track)

## Next up
1. Merge vision-router → main
2. Demo path: CS_VISION_SEVILLE=1 api + live dashboard
3. Naman ambient + thresholds; Pratham voice
