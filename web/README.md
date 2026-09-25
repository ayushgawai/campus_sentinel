# Sentinel console (web/)

Officer dashboard for Campus Sentinel. Plain HTML, CSS and JavaScript —
no build step, no npm dependencies, no internet required for the UI shell.

## Run it

From the repo root:

```bash
python3 -m http.server 8090 --bind 127.0.0.1 --directory web
```

From a laptop over SSH:

```bash
ssh -L 8090:localhost:8090 <user>@<nano-host>
```

Then open http://localhost:8090/

Mock timeline by default. Live events: http://localhost:8090/?ws=\<websocket url\>

`?nosplash=1` skips the intro.

## What is on screen

- **Live Operations** — six-camera wall, auto focus and split focus on active incidents
- **Assist button** — opens the floating sidebar (Incidents, Site plan, Call)
- **Incidents** — queue and detail with confirm / dismiss
- **Call Console** — transcript thread and live tool cards (SIMULATED)
- **System** — site and health summary, camera list
- **Splash** — branded intro before the console

## Demo controls

| Key | Action |
|-----|--------|
| Shift+D | Open / close Demo control |
| Shift+R | Reset demo to t=0 |
| I | Toggle incident sidebar |
| Esc | Close expand map, dismiss dialog, demo, or sidebar |

- **Scenarios** — full run, medical fall only, or quiet (selectable in Demo control)
- **Playback** — play / pause, 1× 2× 4× speed, scrubber with event markers (mock)
- **Auto follow** — Live → Call on dispatch → Live on tracking
- **Pre-warm** — mark models warm for the ready checklist
- **Replay intro** — play splash again, then restart the demo
- **Camera sources** — optional local video per camera; stored in this browser only (IndexedDB), never uploaded or committed

## How it connects to the backend

Transport (`web/js/transport.js`) runs a mock player or a WebSocket from `?ws=`.
Validated events map to `contracts/events.py`:

| Event | Role |
|-------|------|
| `incident.upsert` | Create / update an incident |
| `incident.state_change` | State transitions |
| `overlay.boxes` | Detection boxes on a camera |
| `health.strip` | System health tiles |
| `call.transcript_delta` | Call transcript lines |
| `tool.call_live` | Tool results during a call |
| `demo.control` | Reset / scenario / prewarm |
| `camera.online` | Camera online / offline |

Field names follow `contracts/` exactly. Change points:

- `web/js/transport.js` — connection and mock vs live
- `web/js/site.js` — Camera 1–6 ids, adjacency, site label
- `web/js/actions.js` — confirm, dismiss, demo reset (REST hooks pending)

## Mock only today

- Predicted next camera ring on the site plan
- Clip segment from local camera video at incident time
- Confirm and dismiss applied in the UI / mock path only

Open asks for `services/api`:

- WebSocket URL for live events
- REST routes for confirm, dismiss and demo reset
- `CallBrief` event (when available)
- Bounding-box units (UI assumes normalised 0–1)
- MJPEG / stream URLs per camera

## Rules this UI keeps

- **SIMULATED** on every call and dispatch surface
- No emergency number is ever dialed from the UI
- Cameras shown only as Camera 1 to 6; no place names in UI or mock copy
- Event text rendered with `textContent`, never as HTML
- Strict Content Security Policy (no inline script or style)

## Files

```
web/
  index.html
  README.md
  assets/          logo.png, logo.svg, logo-mark.png, logo-inverse.png
  css/tokens.css   brand and card tokens
  css/app.css      layout and components
  js/main.js       boot
  js/transport.js  mock or WebSocket
  js/store.js      state + reducers
  js/mock.js       deterministic demo timeline
  js/actions.js    confirm / dismiss / demo controls
  js/site.js       cameras and adjacency
  js/cameraSources.js  local video (browser only)
  js/validate.js   event shape checks
  js/ui/           pages and chrome (cameras, sidebar, map, call, …)
```
