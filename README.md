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
