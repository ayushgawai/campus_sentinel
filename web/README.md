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

## Current state: mock-driven

`services/api` does not exist yet, so the dashboard runs entirely on
`js/mock/emitter.js`, which publishes exactly the envelopes defined in
`contracts/events.py`. Nothing in the UI knows the data is synthetic.

## Going live

One switch in `js/config.js`:

```js
export const config = {
  SOURCE: 'live',                    // was 'mock'
  API_BASE: 'http://127.0.0.1:8080', // services/api origin
  MJPEG_PATH: '/mjpeg',
  WS_PATH: '/ws',
};
```

Then implement `createLiveSource()` in `js/bus.js`. It needs to:

1. open `wsUrl()` and publish each received envelope onto the bus unchanged, and
2. expose the same command methods the mock does — `start`, `stop`, `setPaused`,
   `runScenario`, `sendStateChange`, `reset`.

No UI module changes. Every panel reads normalised view models from the store,
never the wire format directly.

## What the API needs to serve

| Need | Shape |
|---|---|
| WebSocket `/ws` | The 8 `EventType` envelopes from `contracts/events.py` |
| MJPEG `/mjpeg/{camera_id}` | Annotated stream per camera. Panes fall back to a locally drawn placeholder while this 404s |
| Camera map | `data/camera_map.json` — coordinates, names, addresses, entrances, adjacency |
| Call Brief | `contracts/call_brief.py` payload, assembled by brain and delivered per call |

### Wire envelope — needs confirming with whoever builds `api/`

The dashboard assumes one JSON object per websocket message, shaped exactly
like `event_to_dict()` output, with the discriminator on a top-level `type`
field:

```json
{ "type": "overlay.boxes", "camera_id": "cam-01", "ts": "...", "boxes": [...] }
```

Not `{"event": "...", "data": {...}}`, and not newline-delimited batches. This
assumption lives in exactly one place — `createLiveSource()` in `js/bus.js` —
so it is cheap to change, but it should be agreed before `api/` is written.

## Call console

The call console (`js/ui/call.js`) takes over the lower half of the screen when
an incident is dispatched, and consumes `call.transcript_delta` and
`tool.call_live`. Three columns: the Call Brief the agent may read from, both
sides of the transcript, and tool calls landing live.

Today the mock plays a scripted exchange (`CALL_SCRIPTS` in
`js/mock/fixtures.js`) over those same two event types, so the voice service can
replace it without the console changing. Two things in the script are
deliberate and should survive editing:

- Sentinel opens by stating the call is **simulated**.
- When the dispatcher asks something unverifiable ("is the person conscious?"),
  Sentinel answers that it **cannot confirm** and reports only what the camera
  observed. That is the "never infer a fact on a call" rule made visible.

`callBriefFor()` in the mock stands in for brain's Call Brief assembly. In
production brain builds it; the browser should never assemble one.

## Layout

```
web/
├── index.html
├── css/
│   ├── tokens.css        design tokens
│   ├── layout.css        app shell grid
│   └── components.css    every component
└── js/
    ├── config.js         the mock/live switch
    ├── contracts.js      mirror of contracts/ + display vocabulary
    ├── transitions.js    mirror of the brain's state graph
    ├── normalize.js      wire payload -> view model
    ├── store.js          state + selectors
    ├── bus.js            transport, the single swap point
    ├── app.js            wiring + boot
    ├── mock/             fixtures + event emitter + call scripts
    └── ui/               one module per panel
```

## Integration checklist

Things that will cost time later if they are not settled now. The first two are
not documented anywhere upstream, so they are genuinely undecided rather than
just unwritten.

- [ ] **`BBox` units.** `contracts/events.py` does not state whether x/y/w/h are
      normalised 0..1 or pixels. This UI assumes normalised. Needs a one-line
      docstring from `services/vision`.
- [ ] **Websocket envelope shape** — see the table above.
- [ ] **Who computes `predicted_next`.** The map's prediction ring needs it.
      Unclear whether that is vision's camera-graph work or brain's. Currently
      mock-only, so the ring silently never fires against real data.
- [ ] **ID formats.** Mock uses `cam-01`..`cam-12` and `INC-0417`. If vision
      emits different camera ids or brain emits UUIDs, every lookup keyed on
      those strings misses silently — a blank pane, not a crash.
- [ ] **Who assembles the Call Brief.** Should be brain, per
      `contracts/call_brief.py`. The browser mock is a stand-in only.

## Three things to know before editing

**1. `contracts.js` and `transitions.js` are hand-kept copies.**
The Python in `contracts/` and `services/brain/state_machine.py` cannot be
imported by a browser, and nothing outside `web/` may be modified. If either
changes upstream, update these two files by hand.

**2. Severity names here are presentation only.**
`contracts/incident.py` freezes `Severity` as `NONE | MINOR | SEVERE`. The
mockup's four buckets are produced in `contracts.js`:

| Contract | UI |
|---|---|
| `SEVERE` | CRITICAL |
| `MINOR`, `fused_prob >= 0.8` | HIGH |
| `MINOR`, `fused_prob < 0.8` | MEDIUM |
| `NEW` | REVIEW badge |
| `DISMISSED` | FALSE ALARM badge |

`UI_HIGH_AT = 0.8` is a display threshold invented for the queue chips. It is
**not** a dispatch threshold — those live in `services/brain/thresholds.py` and
are owned by brain.

**3. Action buttons follow the brain's real state graph.**
`transitions.js` mirrors `ALLOWED`, so the UI can never request a transition the
backend would reject. Consequences:

- Dispatch from `NEW` auto-walks `ALERTED -> DISPATCH_PENDING -> DISPATCHED`
- Resolve on a dispatched incident passes through `TRACKING` first
- False alarm is unavailable once dispatch starts, because `DISMISSED` is only
  reachable from `NEW` or `ALERTED`
- Acknowledge only applies at `NEW`; Resolve is blocked at `NEW`

Each hop emits its own `incident.state_change`, so the timeline matches what the
brain's audit trail would record.

## Fields the UI wants that the contracts do not have

Handled without touching `contracts/`. The mock supplies these; the real api
will not, and every one degrades quietly (`js/normalize.js`).

| Field | Absent behaviour |
|---|---|
| `display_title` | falls back to `CLASS_TITLE[class_token]` |
| `track_path` | falls back to `[camera_id]`, no trail drawn |
| `predicted_next` | no prediction ring |
| `models_count` | tile shows the `models_resident` boolean |
| `gpu_temp_c` | temperature hidden |

Derived in the browser, no new fields needed: the `+N/s` screened rate (delta
between health ticks), the escalation percentage, each pane's tracked count
(`boxes.length`) and its router score (`max(box.score)`).

## Assumptions to confirm with other owners

- **`BBox` coordinates are normalised 0..1.** `contracts/events.py` does not
  specify units. If `services/vision` emits pixels instead, `js/ui/wall.js`
  needs a divide by the frame size.
- **Camera positions are mock data.** `js/mock/fixtures.js` holds twelve
  cameras with invented coordinates because `data/camera_map.json` is still
  empty. Nothing in `data/` was written.
- **Timestamps render in UTC** and are labelled as such, since the contracts
  require timezone-aware UTC and local time would disagree with the audit log.

## Simulation labelling

The dispatch path is a simulation. The top bar carries a permanent
`Simulation` tag, the Dispatch button's tooltip says no real call is placed, and
dispatch timeline entries are written `SIMULATED · campus security`. Keep all of
that in place.

## Accessibility

Keyboard reachable throughout, including the twelve SVG map pins (Enter/Space).
The queue is a `listbox` with `aria-selected` rows, severity filters expose
`aria-pressed`, the confidence meter is a `progressbar` with `aria-valuenow`,
toasts and the queue sit in `aria-live` regions, and the alert pulse plus the map
path animation respect `prefers-reduced-motion`.

Full WCAG conformance needs manual testing with real assistive technology and an
expert review; this covers the structural basics only.
