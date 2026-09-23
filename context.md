# context.md
Last updated: 2026-09-23 (pratham) — vision slice: decode / ring / YOLO / ByteTrack

## HARD RULES (do not skip)
1. **Pull before push.** Always `git pull --rebase origin main` before every push. No exceptions.
2. **Update this file after every finished piece**, in the **same commit** as the work. Move items Done / In progress / Blocked / Decisions. Never push code with stale context.
3. **Stay in your ownership paths.** Do not edit another owner's directories without telling them. Especially do not change `contracts/` after freeze without a group message.
4. Keep this file under ~150 lines. State only — no design essays (those live in the playbook).
5. **Playbook is the base plan** (`campus-sentinel-playbook.html`). Do not change direction because a model suggested something prettier. Deviate only when (a) a real test/integration failure forces it, or (b) a reviewed better approach clearly unblocks the demo. When you deviate, add a **Decisions** line here with **why** so other agents keep working correctly.

## How to run it right now
```bash
git pull --rebase origin main
python3 services/brain/check.py
services/vision/.venv/bin/python services/vision/check.py
```

## Ownership (paths)
| Path | Owner |
|------|--------|
| `contracts/` | shared — **frozen v1.0** |
| `services/brain/`, `services/api/`, compose, Makefile | Ayush |
| `services/vision/`, `services/voice/` | Pratham |
| `web/` | Manav |
| `data/`, `bench/`, `docs/` | Naman |

## Done
- Repo skeleton (ayush)
- `contracts/` v1.0 (ayush; Kiro+Codex review)
- `services/brain/` skeleton: sampler, ZRT client (forced), state machine, placeholder thresholds (ayush; Kiro+Codex review)
- `services/vision/` Wed-morning slice: synthetic decode, 8s ring, YOLO26s-pose TensorRT, ByteTrack → `overlay.boxes` (pratham)

## In progress
- (none)

## Blocked
- Live multimodal ZRT classify needs vision's 16-frame bundle into brain + ZRT up (Pratham Gate 1 — zrt not installed yet)
- Real decode/RTSP waits on Naman clips + mediamtx
- Real severity thresholds need Naman bench curve

## Decisions made since the playbook
- Deployment is Docker Compose only.
- VLM six-class + Severity enums frozen in contracts.
- WS overlays are `overlay.boxes` only.
- Timestamps must be timezone-aware UTC.
- **Brain state machine:** after DISPATCHED, must go TRACKING before RESOLVED (chase path). ALERTED→RESOLVED kept for MINOR close-without-dispatch (three ACT outcomes). Not a playbook rewrite — clarifies the graph.
- **Thresholds:** `severity_from_fused(..., allow_placeholder=True)` required; numbers are not operational until bench.
- **ZRT skeleton:** only forced/demo classify works; live classify raises until 16-frame multimodal prefill is wired (no metadata-only fake).
- **Vision input:** synthetic frames until Naman clips/mediamtx. No RTSP invented.
- **Vision emit:** `overlay.boxes` only. No new contract fields. Keypoints + direction stay internal.
- **YOLO26s-pose:** official Ultralytics `yolo26s-pose.pt` + TensorRT engine (batch=2, pad if fewer cameras). Weights in `services/vision/weights/` (gitignored).
- **ByteTrack this slice:** IoU high/low match, no Kalman — keeps forced path dependency-free.

## Next up
1. Ayush: wire brain escalate→IncidentRecord path + audit log stub; then api
2. Pratham: Gate 1 `zrt serve` Qwen3-VL; then 16-frame ring → brain sampler; Wed afternoon rules / VadCLIP / fusion
3. Manav: dashboard on mock incident.upsert
4. Naman: clips / camera_map / thresholds bench
