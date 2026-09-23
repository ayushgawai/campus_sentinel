# context.md
Last updated: 2026-09-23 (ayush) — piece 2: contracts/ frozen v1.0

## HARD RULES (do not skip)
1. **Pull before push.** Always `git pull --rebase origin main` before every push. No exceptions.
2. **Update this file after every finished piece**, in the **same commit** as the work. Move items Done / In progress / Blocked / Decisions. Never push code with stale context.
3. **Stay in your ownership paths.** Do not edit another owner's directories without telling them. Especially do not change `contracts/` after freeze without a group message.
4. Keep this file under ~150 lines. State only — no design essays (those live in the playbook).

## How to run it right now
```bash
git pull --rebase origin main
cd /path/to/campus_sentinel && python3 -c "from contracts import IncidentRecord; print('ok')"
```
Compose / demo still stubs.

## Ownership (paths)
| Path | Owner |
|------|--------|
| `contracts/` | shared — **frozen v1.0** (Ayush wrote; message group before edits) |
| `services/brain/`, `services/api/`, compose, Makefile | Ayush |
| `services/vision/`, `services/voice/` | Pratham |
| `web/` | Manav |
| `data/`, `bench/`, `docs/` | Naman |
| `services/mediamtx/` | deploy (Ayush) + clips from Naman |

## Done
- Repo skeleton (ayush)
- `contracts/` v1.0: incident / events / call_brief — reviewed by Kiro + Codex (ayush)

## In progress
- (none on ayush) — next: brain skeleton + ZRT client

## Blocked
- (none)

## Decisions made since the playbook
- Deployment is Docker Compose only.
- VLM six-class set: FALL, FIGHT, THEFT, RUN, MEDICAL, BENIGN.
- Severity: NONE | MINOR | SEVERE.
- WS overlays are `overlay.boxes` only (no pixel frames on the socket).
- Timestamps must be timezone-aware UTC.

## Next up
1. Ayush: brain skeleton (sampler, ZRT client, state machine start)
2. Pratham: ZRT serve Qwen3-VL FP8 + vision decode path
3. Manav: dashboard shell on mock `incident.upsert` events
4. Naman: clips / camera_map / chase footage decision
