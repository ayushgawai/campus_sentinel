# Open items: OSNet, temperature calibration, MediaMTX

Status as of 2026-09-25. Owner: Ayush (open). None of these block the demo.

## 1. OSNet re-id weights: not wired, needs more than a weights file

**Today:** `services/vision/osnet.py` is a stub. It hashes the camera, track ID and bbox geometry into a 16-hex digest, and `affinity()` compares digest prefixes. **Nothing imports it.** Cross-camera continuity in the demo comes from the configured Camera 1 to 2 to 3 windows and handoffs, not from appearance. No OSNet weights exist in `services/vision/weights/` (only `yolo26s-pose.pt` and `clip-vit-b-16.pt`), and `pull_weights.py` has no OSNet entry.

**Needed to make it real:**
1. Model code. `torchreid` is not installed in `services/vision/.venv` (`timm`, `torchvision` and `open_clip` are), and timm has no OSNet. Either vendor torchreid's `osnet.py` (MIT, about 600 lines) or add `torchreid` as a dependency (group decision).
2. Weights: `osnet_x0_25_msmt17` (about 1 MB) or `osnet_x1_0_msmt17` (about 9 MB). Add a `pull_osnet()` to `pull_weights.py`. Both are far below the 1 GB download limit.
3. A crop path. `pipeline.py` must crop each tracked person from the decoded frame (256x128), embed on CPU or CUDA once per track per N frames, and store an L2-normalised 512-d vector on the `Track`.
4. A consumer. Cosine similarity between the last track on camera N and new tracks on camera N+1 should gate the handoff in `api/vision_bridge.py` (threshold about 0.6, tune on the Seville clips). Replace the `AppearanceVec.digest` API with the vector and keep `affinity()` returning [0, 1].
5. GB10 budget. Keep it CPU-only or batch it after YOLO; do not add a resident GPU model alongside Qwen at 0.40 without checking `docs/STABILITY.md`.

## 2. Temperature calibration: machinery landed, no data to fit yet

**Today:** Live `ZRTClient.classify` requests `logprobs` and keeps only the first class token's logprob. Most demo runs use the forced path (`logprob=0`, confidence fixed), so there are no recorded live classifications and no labels to fit on. `AuditLog` is in memory only.

**Landed (default off, no behaviour change at defaults):**
- `CS_CALIB_LOG=/path/calib.jsonl` appends one row per non-forced classification: `incident_id, camera_id, track_id, class_token, logprob, ts`.
- `scripts/fit_temperature.py calib.jsonl` fits one temperature T for `sigmoid(logit(p)/T)` on "was the class right?" (NLL, stdlib golden-section) and prints NLL and ECE before and after. `--selftest` recovers a known T=3 on synthetic data.
- `CS_VLM_TEMPERATURE=<T>` applies it in `adjudicate()` before fusion. It defaults to 1.0, which is the identity.

**Needed:**
1. Run the live (non-forced) classify over labelled clips with `CS_CALIB_LOG` set. This needs ZRT/Qwen, so follow the Runtime rules. Aim for 100 or more rows across classes, including BENIGN.
2. Have a human add `"label": "<TRUE_CLASS>"` to each row.
3. Run the fit script and set the printed `CS_VLM_TEMPERATURE` in `.env`. Re-check `thresholds.py` severity cut-offs after calibration.
4. Caveat: Qwen may split class tokens such as `WEAPON` into sub-tokens, so the first-token logprob is only a proxy. Full-class temperature scaling would need per-class sequence logprobs, which means scoring six completions per clip.

## 3. MediaMTX (optional): document only

**Today:** `services/mediamtx/mediamtx.yml` defines RTSP publisher paths `cam01`..`cam06` on `:8554`. `docker-compose.yml` has a `mediamtx` service under the `full` profile. Nothing publishes to it and nothing reads from it. `FileSource` in `services/vision/decode.py` reads local MP4s and owns the demo sync: active-camera windows, rewind to t=0 on the first MJPEG, `shift_wall` and reset rewinds. Ambient cam-04..06 are served as byte-range MP4 by the API.

**Needed if adopted:**
1. Publishers: one `ffmpeg -re -stream_loop -1 -i <clip> -c copy -f rtsp rtsp://127.0.0.1:8554/camNN` per camera (tmux or compose), or real cameras pushing to the same paths.
2. An `RtspSource` in `decode.py` with the `next_frames()` / `rewind()` / `close()` shape. `cv2.VideoCapture("rtsp://...")` works, but `rewind()` and window-following cannot seek a live stream. Demo reset and overlay sync would have to restart the publishers or accept live-edge semantics.
3. Pin the image tag (`bluenviron/mediamtx:latest` is unpinned) and keep it LAN or Tailscale only.
4. The dashboard would still need MJPEG or HLS/WebRTC for browsers. The config currently disables HLS and WebRTC.

Recommendation: keep FileSource for the demo. MediaMTX only matters for real cameras.
