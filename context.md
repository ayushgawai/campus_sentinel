# context.md
Last updated: 2026-09-24 (ayush) — escalate → IncidentRecord + audit on main

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
cd web && python3 -m http.server 8000   # mock dashboard (SOURCE=mock)
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
| `web/` | Manav (landed by Indraneel ac7e93b) |
| `data/`, `bench/`, `docs/` | Naman |

## Done
- Repo skeleton + `contracts/` v1.0 + brain skeleton (ayush)
- Brain escalate → IncidentRecord: fuse + audit + adjudicate + self-check (ayush)
- `web/` mock-driven officer dashboard (indraneel) — on main; one-line swap to live api
- Chase footage decision: Seville 3-cam locked pack verified (ayush/naman)

## In progress
- (ayush) next: `services/api` WS + MJPEG; fill compose services as they land
- Vision router + VadCLIP live on `origin/feat/pratham/vision-router` — **not merged to main yet** (pratham)

## Blocked
- 3 ambient filler clips for 6-pane wall
- Live ZRT classify needs vision frames wired on main
- Real severity thresholds (Naman bench)

## Decisions
- Work lands on **main**; merge feature branches same day.
- Clips live under `campus_sentinel_media/` (sibling of repo), not in git.
- Demo wall target: **6 cameras** = 3 Seville chase + 3 ambient fillers.
- Compose = whole deployment story (5 services + ZRT on host). Stub until services exist.

## Next up
1. Ayush: api (ws + mjpeg) then wire compose
2. Pratham: merge vision-router → main; point FileSource at locked Seville paths
3. Manav/Indraneel: SOURCE=live when api up
4. Naman: 3 ambient clips + camera_map + thresholds
