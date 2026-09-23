# context.md
Last updated: 2026-09-23 (ayush) — piece 1: repo skeleton

## HARD RULES (do not skip)
1. **Pull before push.** Always `git pull --rebase origin main` before every push. No exceptions.
2. **Update this file after every finished piece**, in the **same commit** as the work. Move items Done / In progress / Blocked / Decisions. Never push code with stale context.
3. **Stay in your ownership paths.** Do not edit another owner's directories without telling them. Especially do not change `contracts/` after freeze without a group message.
4. Keep this file under ~150 lines. State only — no design essays (those live in the playbook).

## How to run it right now
Skeleton only. `make up` / `make demo` land after compose + services exist.

```bash
git pull --rebase origin main
```

## Ownership (paths)
| Path | Owner |
|------|--------|
| `contracts/` | shared (Ayush writes; freeze Tue night) |
| `services/brain/`, `services/api/`, compose, Makefile | Ayush |
| `services/vision/`, `services/voice/` | Pratham |
| `web/` | Manav |
| `data/`, `bench/`, `docs/` | Naman |
| `services/mediamtx/` | deploy (Ayush) + clips from Naman |

## Done
- Repo skeleton per playbook §06 (ayush)
- `context.md` hard rules (ayush)
- Stub Makefile + compose + `.gitignore` (ayush)

## In progress
- Next piece: freeze `contracts/` (incident, events, call_brief) — ayush

## Blocked
- (none)

## Decisions made since the playbook
- Deployment is Docker Compose only. Scale = five services + one camera map + another box per campus.

## Next up
1. Ayush: write and push `contracts/`
2. Pratham: ZRT serve Qwen3-VL FP8
3. Manav: dashboard shell on mock events
4. Naman: pull datasets / chase footage hunt
