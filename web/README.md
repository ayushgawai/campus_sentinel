# web/ — officer dashboard

Playbook tier F. Plain HTML + CSS + ES modules. **No build step, no framework,
no `npm install`.** Serve the folder and open it.

```bash
cd web
python3 -m http.server 8000
# open http://localhost:8000
```

ES modules need a real HTTP origin, so opening `index.html` from the filesystem
(`file://`) will not work.

## Self-check

```bash
node web/check.mjs
```

Covers `cameras.js`, `scenarios.js`, `contracts.js`, `transitions.js`,
`normalize.js` and `store.js` against payloads shaped like real
`event_to_dict()` output. No DOM, no dependencies. Two of the assertions guard
hand-kept copies that would otherwise rot silently — see *Mirrored files* below.

## It runs live

The dashboard talks to `services/api` and has no mock source. Start the backend
first, or every pane sits empty:

```bash
python3 -m services.api                         # :8080
CS_VISION_SEVILLE=1 python3 -m services.api     # with the live vision bridge
```

Then point `API_BASE` in `js/config.js` at it. That is the only knob.

## What the API actually serves

Everything the UI shows comes from this surface. There is nothing else.

| Endpoint | Purpose |
|---|---|
| `GET /ws` | The 8 `EventType` envelopes from `contracts/events.py`, one JSON object per message, discriminated on a top-level `type` field |
| `GET /mjpeg/{camera_id}` | Annotated stream, via `ffmpeg`. `CLIP_BY_CAM` in `services/api/server.py` has clips for `cam-01`..`cam-06` only |
| `GET /health` | `{"ok": true, "service": "api"}` |

Commands travel back over the same socket as `{cmd, ...}`, handled by
`handle_cmd` in `services/api/hub.py`: `start`, `stop`, `setPaused`,
`runScenario`, `sendStateChange`, `reset`.

Command replies are **not** events — they carry an `ok` flag instead of a
`type`, so `js/bus.js` routes them to `onAck` subscribers. That matters for
`runScenario`, where the incident id the brain assigns only comes back on the
ack.

## Layout

```
web/
├── index.html
├── check.mjs             node self-check
├── css/
│   ├── tokens.css        design tokens
│   ├── layout.css        app shell grid
│   └── components.css    every component
└── js/
    ├── config.js         API origin and paths
    ├── contracts.js      mirror of contracts/ + display vocabulary
    ├── transitions.js    mirror of the brain's state graph
    ├── cameras.js        mirror of data/camera_map.json
    ├── scenarios.js      scenario ids the hub accepts
    ├── normalize.js      wire payload -> view model
    ├── store.js          state + selectors
    ├── bus.js            websocket transport
    ├── app.js            wiring + boot
    └── ui/               one module per panel
```

Nothing is seeded client-side. The board fills from `/ws` and empties on the
`demo.control` reset envelope, so a reset triggered from any client lands the
same way.

## Mirrored files

Three files in `js/` are hand-kept copies of things the browser cannot import.
If the source changes, update the copy.

| Copy | Source of truth |
|---|---|
| `js/contracts.js` | `contracts/incident.py`, `contracts/events.py` |
| `js/transitions.js` | `services/brain/state_machine.py` :: `ALLOWED` |
| `js/cameras.js` | `data/camera_map.json` |

`check.mjs` asserts `cameras.js` still matches the JSON field by field, because
that one is the easiest to forget. The two Python mirrors are not machine-checked
— treat them as review-critical.

Camera pin positions on the map are **derived** from the lat/lon in
`data/camera_map.json`, projected onto the panel's 0..1 space. Relative geography
is real; absolute scale is not meaningful (the six cameras span roughly 100m by
180m).

## Three things to know before editing

**1. Severity names here are presentation only.**
`contracts/incident.py` freezes `Severity` as `NONE | MINOR | SEVERE`. The queue
buckets are produced in `contracts.js`:

| Contract | UI |
|---|---|
| `SEVERE` | CRITICAL |
| `MINOR` | MEDIUM |
| `NONE` | NONE badge, and the record arrives already `DISMISSED` |
| state `NEW` | REVIEW badge |
| state `DISMISSED` | FALSE ALARM badge |

There used to be a HIGH bucket splitting `MINOR` at `fused_prob >= 0.8`. It was
removed as unreachable: `bench/thresholds.json` sets `severe_at` to `0.80`, and
`severity_from_fused` returns `SEVERE` at `>= severe_at`, so `MINOR` implies
`fused_prob < 0.80`. `check.mjs` fails if `severe_at` moves above `0.8`, which
would make a display split meaningful again.

**2. Action buttons follow the brain's real state graph.**
`transitions.js` mirrors `ALLOWED`, so the UI never offers a transition the graph
would reject:

- Dispatch from `NEW` auto-walks `ALERTED -> DISPATCH_PENDING -> DISPATCHED`
- Resolve on a dispatched incident passes through `TRACKING` first
- False alarm is unavailable once dispatch starts, because `DISMISSED` is only
  reachable from `NEW` or `ALERTED`
- Acknowledge only applies at `NEW`; Resolve is blocked at `NEW`

Each hop emits its own `incident.state_change`. Note that this is currently the
**only** guard — see the gap list below.

**3. The transcript panel is not opened by the Dispatch button.**
`DemoHub.publish()` starts the `VoiceAgent` on any SEVERE `incident.upsert`, with
no operator involvement, and there is no `call.started` envelope. So the arrival
of the first `call.transcript_delta` is what creates the call and reveals the
panel (`store.ensureCall`). Dispatch only walks the state chain.

The panel takes the cell directly below the camera wall, replacing the campus
map; the incident detail panel stays visible alongside it. Closing it marks the
call dismissed so later deltas keep accumulating without popping it back open.

## Known gaps — all of them backend work

None of these are fixable inside `web/`.

- **No Call Brief on the wire.** `services/brain/call_brief.py` assembles a real
  `CallBrief` and `DemoHub._maybe_start_voice` passes it to the voice agent, but
  it is never serialized. No event type carries one. The console's brief column
  was removed for this reason; it needs a new envelope or a
  `GET /call_brief/{incident_id}`.
- **No call lifecycle events.** No `call.started`, no `call.ended`. The console's
  status pill therefore reports whether *deltas are arriving*, not whether the
  call is live.
- **One call at a time.** `VoiceAgent.busy()` plus the single `_voice` instance on
  the hub means a second SEVERE incident gets no call at all, silently.
- **Voice script timing.** `WEAPON_SCRIPT` in `services/voice/agent.py` reads its
  `after_s` values like absolute timeline offsets but consumes them as cumulative
  `asyncio.sleep` calls, stretching the exchange to about 52 seconds with a 9
  second pause before the closing line.
- **No camera map endpoint**, hence `js/cameras.js`.
- **`location_text` and `person_description` are unset on the live path.**
  `escalate_request_from_vision` in `services/brain/from_vision.py` passes
  neither, so `adjudicate` falls back to the bare `camera_id` and the string
  `"unknown"`. The queue shows `cam-01` rather than a readable location.
- **`description` carries a debug tag.** `adjudicate` appends `[zrt-live]` or
  `[zrt-forced]`, which renders verbatim in the operator's evidence paragraph.
- **`clip_uri` is always empty** — `vision_bridge` never sets it. Nothing in the
  UI reads it yet.
- **No GPU or latency telemetry.** `DemoHub._health()` sends `gpu_util=0.68` and
  `p95_ms=182.0` as literal constants every tick, so those tiles were removed
  rather than shown frozen. `frames_screened` also starts from a hardcoded
  2,842,232.
- **`camera.online` is never false.** Published once in `hub.seed()`, always
  `True`, with no liveness monitor. The wall's "degraded" state cannot trigger.
  The hub also reports 12 cameras online while only 6 have clips.
- **State transitions are echoed, not enforced.** `hub.send_state_change` wraps
  whatever state string the browser sent and rebroadcasts it. It never consults
  `services/brain/state_machine.py`, the `StateMachine` built inside `adjudicate`
  is discarded, and `DemoHub` keeps no incident store. Nothing is written to
  `services/brain/audit.py` for operator actions, and an illegal transition from
  any other client would be accepted and fanned out.
- **No `track_path` or `predicted_next`.** The map trail and prediction ring were
  removed. Ownership of cross-camera prediction was never settled.

## Simulation labelling

The dispatch path is a simulation. The top bar carries a permanent `Simulation`
tag, the Dispatch button's tooltip says no real call is placed, and dispatch
timeline entries are written `SIMULATED · campus security`. The voice agent opens
by stating the call is simulated and answers "I cannot confirm" when asked
something it holds no fact for. Keep all of that in place.

## Accessibility

Keyboard reachable throughout, including the SVG map pins (Enter/Space). The
queue is a `listbox` with `aria-selected` rows, severity filters expose
`aria-pressed`, the confidence meter is a `progressbar` with `aria-valuenow`,
toasts, the queue and both transcript columns sit in `aria-live` regions, and the
alert pulse respects `prefers-reduced-motion`.

Full WCAG conformance needs manual testing with real assistive technology and an
expert review; this covers the structural basics only.
