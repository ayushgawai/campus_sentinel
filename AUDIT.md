# AUDIT.md — Campus Sentinel vs target architecture
Last audited: 2026-09-24 (ayush). Evidence from code reads + ZGX runtime checks.

## Challenges to the task prompt (do not treat as bugs)
1. **Hero demo is WEAPON (Seville chase), not medical/fall.** Contract divert 2026-09-24 in `context.md`. Priority item “C5 because VadCLIP has no fall class / medical hero” is **outdated**. Pose rule `fall` still exists for MEDICAL-ish posture; wire class for the demo is **WEAPON**.
2. **Severity outcomes** in code are `NONE | MINOR | SEVERE` (two thresholds), not exactly “severe+confident / severe+unsure / minor”. Close enough; don’t invent a third fuse axis without a group decision.
3. **Location from Completion B** would violate the invariant “location only from camera_map”. D6 implemented as **person description only**; address stays map-authored.
4. **`unknowns` on CallBrief** would be a `contracts/` change — deferred. Voice script already refuses breathing/pulse/injuries; helper `unknowns_for_voice()` documents the list without schema bump.

## Critical checks (done first)
| Check | Result | Evidence |
|-------|--------|----------|
| YOLO is POSE variant | **PASS** | `yolo26s-pose.pt` → Ultralytics `task=pose`, `kpt_shape=[17,3]` |
| Confidence from LOGPROBS | **PASS (partial)** | `ZRTClient` requests `logprobs:true`; `_parse_class_token` reads `logprobs.content[0].logprob`; `logprob_to_prob` → fuse. **Not** a model-written confidence field. Missing: held-out temperature calibration curve (uses raw exp). |

## Table

| Step | Status | Verified how | Class | Action |
|------|--------|--------------|-------|--------|
| A1 Clip store | Partial | Listed `campus_sentinel_media/feeds/` Seville 3 + ambient 3 (~18MB). Not 12 full wall clips. | INTENTIONAL short-term / MISSED for “12” | Left; need Naman 12-pack later |
| A2 scenario.json | Was missing | Glob found none → **added** `data/scenario.json` | MISSED → fixed | Created demo timeline |
| A3 camera_map.json | Partial | Had address/building/entrances/coords; missing floor, cross_streets, vehicle_access, neighbor bearings | MISSED → fixed | Enriched all 6 cams |
| B1 MediaMTX | Stub | `mediamtx.yml` paths only; decode uses FileSource | INTENTIONAL | Leave |
| B2 Decode NVDEC 640×360 | Partial | OpenCV FileSource; not explicitly NVDEC/640 | UNVERIFIED / soft miss | Leave (works) |
| B3 Ring 8s | Present | `services/vision/ring.py` + bundle | OK | — |
| C1 Scheduler | Fixed 0.5s | `CS_VISION_STEP_S` | INTENTIONAL | Leave |
| C2 YOLO26s-pose TRT | Present | Pose weights on disk; runtime `CS_VISION_YOLO=pt` on CUDA (engine preferred later) | INTENTIONAL device | Leave |
| C3 ByteTrack | Present | `tracker.py` ByteTracker + direction; `check.py` id-stability assert | OK | — |
| C4 Rolling state | Present | `state.py` TrackMemory 1–2s pose samples | OK | — |
| C5 Temporal rules | Present | `rules.py` FALL/RUN/SUDDEN_ACCEL/LONG_DWELL + tests | OK | Not “hero fall” — see challenges |
| C6 VadCLIP | Present | `vadclip.py` ~1fps; live upserts show vadclip scores | OK | CLIP load warning in logs — investigate later |
| C7 Fusion | Present | `fusion.py` weighted sum + escalate threshold | OK | Fixed broken Mac import |
| D1 Peak-weighted 16 | Present | `sampler.py` via `bundle.py` | OK | — |
| D2 ZRT :8000 | Present | Live `zrt status` Ready; client hits `/v1` | OK | — |
| D3 Qwen FP8 | Present | Served model id matches | OK | Keep **0.55** GPU fraction |
| D4 Prefill facts only | Present | Prompt bans router scores; `_post_json` rejects `router_score`/`fused_prob` | OK | — |
| D5 Completion A + logprobs | Present | See critical check; no temp calibration fit | Partial OK | Calibration = later |
| D6 Completion B | Was missing | No describe path | MISSED → fixed | `ZRTClient.describe` + adjudicate wire |
| D7 Fuse C×D | Present | `fuse_probs` in adjudicate | OK | — |
| D8 Dedupe | Partial | Cooldown/cap in vision_bridge; new incident ids each fire | Partial | Leave for now |
| E1 Thresholds | Present | `bench/thresholds.json` + `thresholds.py` | OK | — |
| E2 State machine | Present | `state_machine.py` + check | OK | — |
| E3 Idempotency | Present | action keys on SM | OK | — |
| E4 Guardrails | Was thin | No hourly/kill | MISSED → fixed | `guardrails.py` + hub voice gate |
| E5 Call Brief | Present | `call_brief.py`; map enriched; no contract `unknowns` | Partial → improved | Map fields folded into address |
| E6 Audit/timeline | Present | `audit.py` + timeline on record | OK | describe audit too |
| E7 Agentic tools | Present | `services/voice` tools + WS `tool.call_live` | OK | Scripted ASR/TTS stand-in |
| F1 Officer UI | Indraneel | `web/index.html`; lab proves overlays/call | Partial | Leave UI to Indraneel |
| F2 Security broadcast | Lab HITL | lab.html draft+approve | Partial | Not real SMS |
| F3 Twilio/Parakeet/Kokoro | Absent | Voice is AI↔AI script | INTENTIONAL short-term / MISSED for full F3 | Not in this pass |
| Loop tracking OSNet | Stub | `osnet.py` digest affinity | INTENTIONAL stub | — |
| Loop learning LoRA | Absent | — | MISSED (out of scope this pass) | — |

## What we fixed this pass
1. **D6** Completion B (`describe`) → fills `person_description` for the call.
2. **A3** camera_map: floor, cross_streets, vehicle_access, neighbors+bearings.
3. **A2** `data/scenario.json` demo timeline.
4. **E4** guardrails (kill switch, one dispatch/incident, hourly cap) on SEVERE voice.
5. **fusion.py** Mac import break repaired.
6. Call brief speaks richer map logistics without contract change.

## What we did not / could not
- Full MediaMTX / NVDEC / 12-cam pack / Twilio+Parakeet+Kokoro / OSNet weights / LoRA / officer map prediction / temperature calibration fit.
- Raising Qwen GPU fraction (forbidden — coexistence).
- Splitting into five containers (intentional).

## Need from the team
- **Naman:** real ambient/12 clips + confirm scenario timings against Seville peek.
- **Pratham:** optional TRT YOLO again at 0.55; fix VadCLIP “random init” warning if real.
- **Indraneel:** wire officer UI to live Completion B person text + tool calls; next-cam prediction when OSNet lands.
- **Group:** ack CallBrief `unknowns` field if you want it on the wire contract.
