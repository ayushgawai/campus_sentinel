# context.md
Last updated: 2026-09-24 (ayush) — local Mac clone; vision-router merged with main; ZGX offline

## HARD RULES (do not skip)
1. **Pull before push.** Always `git pull --rebase origin main` before every push. Work on **`main`** (no long-lived feature branches overnight).
2. **Update this file after every finished piece**, in the **same commit** as the work.
3. **Stay in your ownership paths.** Especially do not change `contracts/` after freeze without a group message.
4. Keep this file under ~150 lines. State only — no design essays (playbook).
5. **Playbook is the base plan.** Deviate only on real test failure or reviewed unblock; record **why** here.

## How to run it right now
```bash
# Local Mac working copy (ZGX down): ~/src/campus_sentinel
git checkout feat/pratham/vision-router && git pull
make check   # brain + api (no GPU)
# On ZGX tomorrow (GPU + weights):
services/vision/.venv/bin/python services/vision/check.py
services/vision/.venv/bin/python services/vision/run_seville.py --max-steps 90
services/vision/.venv/bin/python services/vision/run_seville.py   # full ~340s
```

## Demo media (outside git — never commit mp4s)
- **Locked chase pack:** `Documents/campus_sentinel_media/feeds/seville_option1_3cam_locked/`
- Path map: `data/feeds/seville_option1_3cam_locked.json`
- **Still needed:** 3 ambient fillers → 6 demo feeds

## Ownership
| Path | Owner |
|------|--------|
| `contracts/` | shared — frozen v1.0 |
| `services/brain/`, `services/api/`, compose, Makefile | Ayush |
| `services/vision/`, `services/voice/` | Pratham |
| `web/` | Manav — **leave alone** |
| `data/`, `bench/`, `docs/` | Naman |

## Done
- contracts + brain adjudicate/fuse/audit + api :8080 (ayush, on main)
- web mock dashboard (indraneel); Manav iterating UI — do not touch
- vision-router branch: YOLO26s-pose TRT, ByteTrack, rules, VadCLIP, FileSource, Seville path JSON (pratham)
- **Partial Seville verify (ZGX, before box died):** forced `check.py` OK; live 90 steps on 3 cams → 22 escalations, YOLO+CLIP loaded. Full 340s pass interrupted (SSH/host stop).

## In progress
- Finish full Seville `run_seville.py` on ZGX tomorrow → then merge vision-router → main
- Wire Escalation → EscalateRequest into api hub

## Blocked
- ZGX offline until morning restart (GPU live tests)
- Ambient clips + thresholds (Naman); live ZRT frames wire

## Decisions
- Working copy while ZGX down: **`~/src/campus_sentinel`** (push remote; pull on box tomorrow)
- Camera wire ids `cam-01`… for web/api; vision Seville JSON uses `CAM-01`… — map at api ingest
- Do not touch `web/` while Manav works

## Next up
1. ZGX up → full `run_seville.py` → merge vision-router → main
2. Ayush: api ingest of escalations
3. Manav: UI; Naman: ambient + thresholds
