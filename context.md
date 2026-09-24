# context.md
Last updated: 2026-09-24 (ayush) — on main; demo clips unlocked

## HARD RULES (do not skip)
1. **Pull before push.** Always `git pull --rebase origin main` before every push. Work on **`main`** (no long-lived feature branches overnight).
2. **Update this file after every finished piece**, in the **same commit** as the work.
3. **Stay in your ownership paths.** Especially do not change `contracts/` after freeze without a group message.
4. Keep this file under ~150 lines. State only — no design essays (playbook).
5. **Playbook is the base plan.** Deviate only on real test failure or reviewed unblock; record **why** here.

## How to run it right now
```bash
git checkout main && git pull --rebase origin main
python3 services/brain/check.py
# dashboard (Manav): open web/index.html — mock emitter
```

## Demo media (outside git — never commit mp4s)
- **Locked chase pack (3 cams):** `Documents/campus_sentinel_media/feeds/seville_option1_3cam_locked/`
  - CAM-01 lobby, CAM-02 hall east, CAM-03 hall west · ~340s · IN then OUT path
  - `demo.json` + `HIGHLIGHTS.md` · Seville US Mock Attack · CC BY-NC 4.0 · staged drill
- **Still needed:** 3 ambient fillers (parking / basement / road) → **6 feeds total** for demo wall

## Ownership
| Path | Owner |
|------|--------|
| `contracts/` | shared — frozen v1.0 |
| `services/brain/`, `services/api/`, compose, Makefile | Ayush |
| `services/vision/`, `services/voice/` | Pratham |
| `web/` | Manav |
| `data/`, `bench/`, `docs/` | Naman |

## Done
- Repo skeleton + `contracts/` v1.0 + brain skeleton (ayush)
- `web/` mock-driven officer dashboard (manav) — on main
- Chase footage decision: Seville 3-cam locked pack verified (ayush/naman)

## In progress
- (ayush) next: escalate → IncidentRecord + audit stub; then api
- Vision router + VadCLIP live on `origin/feat/pratham/vision-router` — **not merged to main yet** (pratham)

## Blocked
- 3 ambient filler clips for 6-pane wall
- Live ZRT classify needs vision frames wired on main
- Real severity thresholds (Naman bench)

## Decisions
- Work lands on **main**; merge feature branches same day.
- Clips live under `campus_sentinel_media/` (sibling of repo), not in git.
- Demo wall target: **6 cameras** = 3 Seville chase + 3 ambient fillers.

## Next up
1. Ayush: IncidentRecord path + api
2. Pratham: merge vision-router → main; point FileSource at locked Seville paths
3. Manav: swap mock video panes to real MJPEG when api up
4. Naman: 3 ambient clips + camera_map + thresholds
