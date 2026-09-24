# Campus Sentinel

Edge AI campus security demo (SJSUHack). Local inference only on the ZGX Nano — no cloud AI in the runtime path.

## Start here
1. Read [`PLAYBOOK.md`](./PLAYBOOK.md) → HTML playbook
2. Read [`context.md`](./context.md) (living state — update after every piece)
3. Stay in your ownership paths (see `context.md`)

## Team
| Person | Owns |
|--------|------|
| **Ayush** | `contracts/`, `services/brain/`, `services/api/`, Compose, Makefile, integration |
| **Pratham** | `services/vision/`, `services/voice/`, ZRT models |
| **Manav** | `web/` |
| **Naman** | `data/`, `bench/`, `docs/` |

## Deployment
Docker Compose. One machine, one compose file.

## Mock CCTV feeds (not in git)
Video bytes live **outside** the repo under Documents:

| What | Path (ZGX) |
|------|------------|
| **Locked 3-cam demo (stream from here)** | `/home/hp25/Documents/campus_sentinel_media/feeds/seville_option1_3cam_locked/` |
| Path map + FileSource example (in repo) | [`data/feeds/seville_option1_3cam_locked.json`](./data/feeds/seville_option1_3cam_locked.json) |
| Camera ids / locations | [`data/camera_map.json`](./data/camera_map.json) |
| Research originals (tmp, do not stream) | `/home/hp25/tmp/campus_sentinel_clip_research/` |

Preview dashboard (from media root):
```bash
cd /home/hp25/Documents/campus_sentinel_media/feeds/seville_option1_3cam_locked
python3 -m http.server 8765 --bind 127.0.0.1
# → http://127.0.0.1:8765/dashboard.html
```

Mac mount: `~/mnt/zgx-b505/Documents/campus_sentinel_media/...`

## Commands (once services exist)
```bash
make up      # compose up + health
make demo    # pre-warm, scenario, dashboard
make reset   # back to t=0
```

## Git discipline
- `git pull --rebase origin main` before every push
- Update `context.md` in the same commit as your work
- Branch: `feat/<name>/<thing>`, merge same day
- Never commit weights, clips, or `.env`
- Mock CCTV mp4s: only under `Documents/campus_sentinel_media/` (sibling to this repo), never under `campus_sentinel/`
