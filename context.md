# context.md
Last updated: 2026-09-24 (ayush) — locked Seville 3-cam mock CCTV under Documents/campus_sentinel_media

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
# VLM (needs zrt group): zrt status
# API: http://127.0.0.1:8000/v1  model Qwen/Qwen3-VL-30B-A3B-Instruct-FP8
# Live clips (skips 35-min Wildtrack):
services/vision/.venv/bin/python services/vision/run_clips.py
# Locked Seville 3-cam mock CCTV (FileSource) — mp4s NOT in git:
#   /home/hp25/Documents/campus_sentinel_media/feeds/seville_option1_3cam_locked/
#   path map: data/feeds/seville_option1_3cam_locked.json
# Preview: cd that dir && python3 -m http.server 8765 --bind 127.0.0.1
#          → http://127.0.0.1:8765/dashboard.html
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
- **Gate 1 YES:** `zrt` 0.30.7 serves `Qwen/Qwen3-VL-30B-A3B-Instruct-FP8` on aarch64 `:8000`. Still frame answered. Cold TTFT 18.4s (image prefill); warm TTFT 0.12s, ~43 tok/s wall / ~54 tok/s decode. NVFP4 not tried. (pratham)
- Vision `FrameBundle`: 16 peak-weighted frames from the 8s ring via `brain.sampler`. `to_classify_kwargs()` matches `ZRTClient.classify`. No scores. Ayush still needs to send `frames` on the wire. (pratham)
- Router rolling 1–2s state + rules `fall|run|sudden_acceleration|long_dwell` + loose fusion. Overlay `score` is fused. Peak for the 16-frame bundle is the max fused ts. No FIRE — not in frozen six-class. (pratham)
- `FileSource` + live router on Naman `data/clips/staging/normalized/` (10 short mp4s, ~30s wall). Ambient stay under 0.40. cam7 fall peak 0.878 (walk→kneel→floor). cam1–4/6/8 run+accel over 0.40. Skipped wildtrack_cam1/2 (35 min). (pratham)
- **VadCLIP live:** frozen CLIP ViT-B/16 (`openai`) on person crops at 1 fps/track. Score is cosine margin (fight|theft − benign), not 3-way softmax (softmax called mall walking “theft” at 0.91). `W_VADCLIP=0.40`. Official Wu adapter needs pre-extracted 10-crop UCF features + OneDrive weights — not a live crop model. Same ZRT exception as YOLO. Forced path needs no weights. Staging retest: ambient vadclip=0; cam7 still fall 0.912; no fight/theft clips yet. (pratham)
- **Seville Option1 locked 3-cam mock CCTV** (ayush): permanent stream source at `/home/hp25/Documents/campus_sentinel_media/feeds/seville_option1_3cam_locked/` (outside git). Repo holds paths only: `data/feeds/seville_option1_3cam_locked.json` + `data/camera_map.json`. Cams CAM-01 lobby / CAM-02 hall east / CAM-03 hall west; IN then OUT ~340s. Research originals stay in `~/tmp/campus_sentinel_clip_research/` (WATCH_THESE + sources/mock_attack). Do not stream from tmp for demo.

## In progress
- (none)

## Blocked
- Live ZRT classify: vision bundle is ready (`VisionRouter.bundle` / `to_classify_kwargs`); brain `zrt_client.classify` still raises until Ayush wires `frames`
- Live RTSP still waits on Naman mediamtx; FileSource covers staging mp4s + locked Seville pack under `campus_sentinel_media/`
- Real severity thresholds need Naman bench curve

## Decisions made since the playbook
- Deployment is Docker Compose only.
- VLM six-class + Severity enums frozen in contracts.
- WS overlays are `overlay.boxes` only.
- Timestamps must be timezone-aware UTC.
- **Brain state machine:** after DISPATCHED, must go TRACKING before RESOLVED (chase path). ALERTED→RESOLVED kept for MINOR close-without-dispatch (three ACT outcomes). Not a playbook rewrite — clarifies the graph.
- **Thresholds:** `severity_from_fused(..., allow_placeholder=True)` required; numbers are not operational until bench.
- **ZRT skeleton:** only forced/demo classify works; live classify raises until 16-frame multimodal prefill is wired (no metadata-only fake).
- **ZRT local:** `proxy.auth.type=none`, `proxy.tls.enabled=false`, `proxy.port=8000`. User must be in `zrt` group (`newgrp zrt`).
- **Vision input:** `FileSource` for Naman staging mp4s; `SyntheticSource` for check.py. No RTSP invented until mediamtx.
- **Demo CCTV media:** mp4s live under `Documents/campus_sentinel_media/` (sibling folder, not in git). Never commit clips. Path map in `data/feeds/`. Staging clips under `data/clips/` stay gitignored for benches; locked Seville demo is the permanent mock-feed source.
- **Vision emit:** `overlay.boxes` only on the socket. Escalation bundle is in-process Python (`FrameBundle`), not a new contract. Keypoints + direction stay internal.
- **16-frame sample:** vision calls `services.brain.sampler.sample_from_timestamps`. Peak is the camera's max fused score ts (else newest ring ts).
- **Router classes:** pose rules cover fall/run/accel/dwell. Fight/theft wait on VadCLIP + VLM. FIRE is not a contract class — do not add without a group message.
- **VadCLIP:** live CLIP ViT-B/16 crop scorer, not the official UCF-Crime MIL adapter (pre-extracted features only). Weight 0.40 so fight/theft can escalate without a pose rule. `open_clip_torch` in `services/vision/.venv`. Weights `services/vision/weights/clip-vit-b-16.pt` (gitignored).
- **YOLO26s-pose:** official Ultralytics `yolo26s-pose.pt` + TensorRT engine (batch=2, pad if fewer cameras). Weights in `services/vision/weights/` (gitignored).
- **ByteTrack this slice:** IoU high/low match, no Kalman — keeps forced path dependency-free.

## Next up
1. Ayush: wire brain escalate→IncidentRecord path + audit log stub; then api
2. Ayush: wire `ZRTClient.classify` live path from `FrameBundle.to_classify_kwargs()`
3. Pratham: NVFP4 optional; Thursday voice + OSNet. Naman fight/theft clips still needed to bench VadCLIP
4. Manav: dashboard on mock incident.upsert
5. Naman: clips / camera_map / thresholds bench
