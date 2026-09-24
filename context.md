# context.md
Last updated: 2026-09-24 (ayush) — api on main; next: verify Pratham vision + Seville clips

## HARD RULES (do not skip)
1. **Pull before push.** Always `git pull --rebase origin main` before every push. Work on **`main`** (no long-lived feature branches overnight).
2. **Update this file after every finished piece**, in the **same commit** as the work.
3. **Stay in your ownership paths.** Especially do not change `contracts/` after freeze without a group message.
4. Keep this file under ~150 lines. State only — no design essays (playbook).
5. **Playbook is the base plan.** Deviate only on real test failure or reviewed unblock; record **why** here.

## How to run it right now
```bash
git checkout main && git pull --rebase origin main
make check                          # brain + api self-checks
make api                            # :8080 /health /ws /mjpeg/{cam-01..03}
# Mac dashboard (mock): cd web && python3 -m http.server 8000 → http://127.0.0.1:8000/
# Live: SOURCE:live API_BASE:http://127.0.0.1:8080 (api must be up; tunnel if remote)
```

## Demo media (outside git — never commit mp4s)
- **Locked chase pack (3 cams):** `Documents/campus_sentinel_media/feeds/seville_option1_3cam_locked/`
  - cam-01/02/03 ↔ CAM01/02/03 mp4s (api MJPEG)
- **Still needed:** 3 ambient fillers → **6 feeds** for demo wall

## Ownership
| Path | Owner |
|------|--------|
| `contracts/` | shared — frozen v1.0 |
| `services/brain/`, `services/api/`, compose, Makefile | Ayush |
| `services/vision/`, `services/voice/` | Pratham |
| `web/` | Manav — **leave alone** (he is iterating UI) |
| `data/`, `bench/`, `docs/` | Naman |

## Done
- contracts v1.0 + brain adjudicate/fuse/audit (ayush)
- services/api :8080 — WS + health + ffmpeg MJPEG; scenarios → forced adjudicate (ayush)
- compose: `api` service + Dockerfile; mediamtx under profile `full`
- web mock dashboard on main (indraneel); createLiveSource present — Manav owns further UI

## In progress
- (ayush) verify `origin/feat/pratham/vision-router` against Seville locked clips, then merge if green
- Vision Escalation → EscalateRequest wiring after merge
  (camera_id, track_id, ts→peak_ts, fused→router_score, rules→rules_fired)

## Blocked
- 3 ambient filler clips; real severity thresholds (Naman)
- Live ZRT classify (needs vision frames on main)

## Decisions
- Camera wire ids stay `cam-01`… (web); Seville files mapped in api only.
- ZRT stays on host, never in compose.
- Do not touch `web/` while Manav is working.

## Next up
1. Ayush: test Pratham vision on Seville clips → merge → api ingest escalations
2. Manav: UI (no interference)
3. Naman: ambient clips + camera_map + thresholds
