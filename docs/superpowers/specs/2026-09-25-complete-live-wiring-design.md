# Complete Live Wiring Design

Date: 2026-09-25

## Goal

Make every user-facing Sentinel demo control operate against the live backend,
then run one controlled end-to-end SignalWire call. Keep the existing six-camera
demo and GPU safety limits. Mock mode remains for offline UI development, but no
live-mode action may silently fall back to browser-only state.

“Complete all pending” here means all user-visible UI, API, camera metadata,
voice, health, and runtime items listed in `context.md`. Intentional research
deferrals (MediaMTX, OSNet weights, LoRA, 12-camera media, and temperature
calibration) remain out of this demo-critical pass because they neither wire a
visible control nor fit the GB10 stability budget.

## Baseline Before Changes

- Local and `origin/main` both point to `981c0f3`; no Manav change is waiting.
- Brain, API, voice, forced-vision, and tracked-Python compile checks pass.
- One Qwen/ZRT, one API/YOLO, and one web server are running; no duplicate
  process was found.
- Kokoro and ASR are not listening on their configured ports.
- Manual report, dispatch, broadcast, confirm, and dismiss all return HTTP 404.
- `/voice/status` reports configured environment variables instead of actual
  service reachability, while the UI cannot fetch it under the current CSP.
- The UI receives events for cameras 7-12 and discards them with warnings.
- The UI place denylist corrupts valid call text, including addresses and access
  instructions.
- SignalWire credentials and FROM number validate, but calling is disabled and
  its media event dialect has not been tested on a real call.

## Canonical Site and Scene Facts

`data/camera_map.json` is the canonical operational source. Cameras 1-3 become
MacQuarrie Hall zones matching the video sequence:

- Camera 1: ground-floor lobby / entry.
- Camera 2: east corridor.
- Camera 3: west corridor / stairwell approach.

Each entry contains the full address, floor, coordinates, entrances, cross
streets/access notes, neighbors, and demo scene facts. Scene facts describe only
observable details: subject count, appearance, visible weapon, direction, and
explicit unknowns. Future-camera facts are revealed only when the tracked person
actually hands off to that camera.

The backend exposes this map at `GET /api/site`. The live UI loads it before
mounting and uses its names/graph; static defaults remain only for mock/offline
startup. Legitimate locations are no longer passed through the broad denylist.

MacQuarrie Hall's configured address is One Washington Square, San Jose,
California 95192. Base building coordinates are approximately
37.333553, -121.881899; per-camera coordinates use small offsets within the
building footprint.

## Live Incident State and REST Actions

`DemoHub` keeps the current incidents in memory alongside its existing replay
buffer. Every upsert and state change updates this store. Reset clears both.

The stdlib API adds bounded JSON parsing and these routes:

- `POST /api/incidents/manual`
- `POST /api/incidents/{id}/dispatch`
- `POST /api/incidents/{id}/confirm`
- `POST /api/incidents/{id}/dismiss`
- `POST /api/broadcast`
- `GET /api/site`

Inputs are allowlisted, body size is capped, unknown incidents return 404, and
invalid state requests return 409. Manual reports use the existing incident
contract and `operator_report` marker. Dispatch passes through existing
guardrails and the same voice path as automatic severe incidents. Confirm and
dismiss publish real state changes. Broadcast publishes a visible audit/tool
event without pretending that SMS or a campus mass-notification provider exists.

All API responses include CORS headers, and OPTIONS advertises GET/POST/OPTIONS.
The frontend removes its live-mode local fallback: an unavailable backend is
shown as a failed action, not a successful local mutation.

## Call Brief and Conversational Voice

No new wire-contract event is needed. The existing incident, transcript, and
tool events already contain the fields consumed by the call UI; avoiding a new
`CallBrief` event keeps the frozen event contract stable.

Real calls no longer play synthetic dispatcher lines. The real-call flow is:

1. A severe incident creates a grounded call brief from camera metadata and the
   currently revealed scene facts.
2. Sentinel publishes and speaks the fixed introduction: automated identity,
   observed emergency, full address, precise zone, current camera, and promise
   to stay on the line.
3. SignalWire audio is transcribed locally.
4. Common dispatcher questions use deterministic fact/tool answers for minimum
   latency: location, callback number, subject count/description, weapon,
   injuries/unknowns, direction, elapsed time, and repeat.
5. Unexpected questions use a short text-only Qwen request grounded exclusively
   in the current call brief and scene facts. No frames or future timeline are
   sent during the call.
6. The answer is published to the existing transcript and spoken by Kokoro.
7. Camera handoffs update the same call context and produce concise live updates.

Answers are serialized so ASR chunks cannot create overlapping speech. Missing
facts produce “unknown” or “I cannot confirm,” never an inference. The existing
script remains available only when SignalWire is disabled for an offline demo.

## Camera and Health Wiring

- Seed and heartbeat only Cameras 1-6.
- Publish periodic `camera.online` heartbeats based on configured media files;
  publish false when a configured file is unavailable.
- `/voice/status` probes the actual ASR and Kokoro `/health` endpoints with short
  timeouts and reports SignalWire configuration separately.
- CSP allows the configured HTTP(S) API probe while retaining the existing
  script/style restrictions.
- The System page therefore reports speech readiness from running services, not
  environment-variable presence.

## Runtime and One Controlled Test

Runtime changes are serialized:

1. Keep the single Qwen and web processes if healthy.
2. Stop the existing API session once.
3. Verify ports 8080, 8092, and 8093 are free.
4. Start exactly one Kokoro and one ASR tmux session and prewarm them.
5. Start exactly one API session with the existing 0.40 Qwen and YOLO limits.
6. Verify process counts, health, public callback XML, WebSocket state, and every
   REST action using a resettable test incident.
7. Enable SignalWire only after all local checks pass.
8. Reset once, trigger one severe incident, place one call to the verified demo
   handset, and observe call state, media connection, ASR, Qwen fallback,
   transcript, TTS, camera handoff, and UI state.
9. Disable outbound calling again after the test unless the user explicitly
   requests it remain armed.

## Acceptance Checks

- Fresh self-checks cover REST validation/state updates, six-camera heartbeats,
  deterministic voice answers, Qwen unknown handling, and SignalWire request
  construction.
- Browser verification covers all four pages, real site metadata, correct model
  readiness, manual report, dispatch, broadcast, confirm, dismiss, reset, and
  the live transcript.
- No console warnings for cameras 7-12 and no corrupted address text.
- Exactly one process listens on each required port.
- One real call connects and either completes the full media exchange or records
  the precise provider-protocol blocker without substituting a fake success.
- `context.md` and `web/README.md` match the verified behavior.
