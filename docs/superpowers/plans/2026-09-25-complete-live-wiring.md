# Complete Live Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire every user-facing live demo action, grounded conversational voice path, site fact, and service-health indicator through the real backend and verify one controlled SignalWire call.

**Architecture:** Keep `DemoHub` as the in-memory demo authority and the stdlib API as the only HTTP/WebSocket boundary. Reuse existing contracts, call tools, ZRT client, transcript events, and plain-JS UI; add no dependencies. Common dispatcher questions use deterministic facts while unexpected questions use text-only grounded Qwen.

**Tech Stack:** Python 3.12 stdlib asyncio/urllib, existing HP Z Runtime Qwen, existing YOLO pipeline, SignalWire Compatibility API, local faster-whisper and Kokoro services, plain ES modules.

**Spec:** `docs/superpowers/specs/2026-09-25-complete-live-wiring-design.md`

## Global Constraints

- Keep Qwen at GPU fraction 0.40 and max model length 8192.
- Never run a second API, YOLO, Qwen, ASR, TTS, or web process on the same port.
- Never dial an emergency number; the configured verified demo handset is the only destination.
- Secrets remain in gitignored `.env` and never appear in logs, tests, commits, or the frontend.
- Cameras 4-6 stream for appearance but never enter YOLO/Qwen.
- Reuse frozen incident and event contracts; do not add a `CallBrief` event.
- Use `apply_patch` for edits, TDD for behavior, and pull with rebase before every push.

---

### Task 1: Canonical MacQuarrie Site Facts

**Files:**
- Modify: `data/camera_map.json`
- Modify: `services/brain/call_brief.py`
- Modify: `services/brain/check.py`
- Modify: `web/js/site.js`
- Modify: `web/README.md`

**Interfaces:**
- Produces: `site_config() -> dict[str, Any]`, `scene_facts(camera_id: str) -> dict[str, Any]`
- Produces: Cameras 1-3 mapped to lobby, east corridor, and west corridor at MacQuarrie Hall.

- [ ] Add failing brain checks asserting Camera 1's full MacQuarrie address, coordinates, entrance, and current scene facts; assert Camera 2/3 facts are distinct and no future camera facts appear in Camera 1.
- [ ] Run `python3 -m services.brain.check` and confirm the new assertions fail.
- [ ] Enrich `camera_map.json`; add `site_config()` and `scene_facts()` using the existing loader.
- [ ] Replace UI camera names/graph with the same six configured zones and remove broad location-word replacement while preserving raw camera-ID formatting.
- [ ] Run brain checks and `git diff --check`; commit the site-fact slice.

### Task 2: Live Incident Store and Operator REST API

**Files:**
- Modify: `services/api/hub.py`
- Modify: `services/api/server.py`
- Modify: `services/api/check.py`
- Modify: `web/js/config.js`
- Modify: `web/js/actions.js`

**Interfaces:**
- Produces: `DemoHub.get_incident(id)`, `manual_incident(payload)`, `dispatch_incident(id)`, `confirm_incident(id)`, `dismiss_incident(id, reason)`, `broadcast_message(payload)`.
- Produces: GET `/api/site`; POST manual/dispatch/confirm/dismiss/broadcast routes.

- [ ] Extend `services.api.check` with raw HTTP helpers and failing assertions for route success, validation failures, unknown IDs, state broadcasts, and reset clearing the store.
- [ ] Run `python3 -m services.api.check` and confirm 404/failure evidence.
- [ ] Add the bounded JSON-body reader (64 KiB maximum), path matching, response codes 400/404/409/413, and CORS.
- [ ] Store every incident upsert/state change in `DemoHub`; implement operator methods with existing contracts and guardrails.
- [ ] Add frontend confirm/dismiss routes and remove live-mode local-success fallbacks; display returned backend failures through the existing operator status UI.
- [ ] Run API/brain/voice checks and direct curl route probes; commit the live-action slice.

### Task 3: Six-Camera Heartbeats and Real Readiness

**Files:**
- Modify: `services/api/hub.py`
- Modify: `services/api/server.py`
- Modify: `services/api/check.py`
- Modify: `services/voice/signalwire_bridge.py`
- Modify: `web/index.html`
- Modify: `web/js/modelStatus.js`

**Interfaces:**
- Produces: `service_ready(url: str) -> bool`; `/voice/status` booleans reflect `/health` responses.
- Produces: heartbeat events for `cam-01` through `cam-06` only.

- [ ] Add failing checks asserting no cam-07..12 seed/heartbeat events and actual endpoint readiness rather than environment presence.
- [ ] Run API/voice checks and confirm failure.
- [ ] Restrict seed to `WALL_CAMS`, publish periodic file-backed online state, and add short-timeout service health probes.
- [ ] Permit HTTP(S) API connections in CSP without relaxing script/style policy; keep mock voice rows unchanged.
- [ ] Run checks and a browser console inspection with zero unknown-camera warnings; commit the health slice.

### Task 4: Grounded Live Dispatcher Q&A

**Files:**
- Modify: `services/brain/zrt_client.py`
- Modify: `services/voice/agent.py`
- Modify: `services/voice/media_bridge.py`
- Modify: `services/api/hub.py`
- Modify: `services/api/server.py`
- Modify: `services/voice/check.py`

**Interfaces:**
- Produces: `ZRTClient.answer_dispatcher(facts: dict[str, Any], question: str) -> str`.
- Produces: `VoiceAgent.start_live_call(rec, brief)`, `answer_dispatcher(incident_id, question)`.
- Consumes: `scene_facts(camera_id)` from Task 1.

- [ ] Add failing voice checks for the exact introduction, deterministic location/weapon/injury/direction answers, unknown refusal, current-camera handoff, and one mocked Qwen fallback.
- [ ] Run `python3 -m services.voice.check` and confirm failure.
- [ ] Add a temperature-zero, text-only Qwen completion capped at 80 tokens and grounded to serialized current facts.
- [ ] Add real-call mode that speaks only Sentinel lines, holds the call context, answers common questions deterministically, and invokes Qwen only for unmatched questions.
- [ ] Give `MediaStreamBridge` an async dispatcher-question callback; invoke it after publishing ASR text and keep answer/TTS serialization through the existing queue.
- [ ] Select live versus scripted mode from SignalWire configuration; wire the bridge callback through `ApiServer` and `DemoHub`.
- [ ] Run voice/API checks plus the temporary model probe; commit the conversational voice slice.

### Task 5: Full Frontend/Backend Acceptance Without Calling

**Files:**
- Modify: `web/README.md`
- Modify: `context.md`
- Modify: `Makefile`

**Interfaces:**
- Consumes all earlier routes/events.
- Produces accurate operator documentation and runnable aggregate checks.

- [ ] Update the existing self-checks to cover the complete route/event matrix and replace obsolete Twilio/reset markers.
- [ ] Run brain, API, forced-vision, and voice self-checks plus tracked Python compilation and `git diff --check`.
- [ ] Use the live browser to exercise report, dispatch, broadcast, confirm, dismiss, reset, all four pages, address rendering, model readiness, and console logs.
- [ ] Correct any discrepancy, rerun the relevant failing check, and commit documentation/check updates.

### Task 6: Controlled Runtime Restart and SignalWire Call

**Files:**
- Modify: `.env` only for local enable/disable state (gitignored)
- Modify: `context.md` with verified runtime outcome

**Interfaces:**
- Consumes `/signalwire/voice`, `/signalwire/media`, ASR 8093, TTS 8092, API 8080, Qwen 8000.

- [ ] Record the current PID/listener inventory; leave the single healthy Qwen and web process running.
- [ ] Stop `sentinel-api`, verify 8080 free, start one `sentinel-asr` and one `sentinel-tts`, wait for both `/health`, then start one `sentinel-api`.
- [ ] Verify exact process counts, local/public health, `/voice/status`, cXML callback, and Funnel state.
- [ ] Enable SignalWire, restart only the API, reset the demo, and trigger one severe incident/call to the configured verified handset.
- [ ] Observe SignalWire call status, media WebSocket, ASR transcript, deterministic and Qwen answers, Kokoro audio, camera handoff, and UI transcript.
- [ ] Disable outbound calling after the test, update `context.md` with exact results, run final checks, commit, pull --rebase, and push.

### Task 7: Frontend Redesign Prompt Without Frontend Changes

**Files:**
- Create: `docs/FRONTEND_REDESIGN_PROMPT.md`

**Interfaces:**
- Consumes the verified final feature inventory and current frontend file map.
- Produces a standalone prompt the user can give Claude to design a replacement frontend while preserving the current implementation as backup.

- [ ] Inventory every page, panel, action, event, state, model, camera behavior, incident lifecycle, voice interaction, safety rule, runtime metric, demo control, and backend endpoint from the verified system.
- [ ] Write a self-contained Claude prompt requiring a distinctive professional design system, responsive/accessibility requirements, complete screen/state coverage, interaction specifications, and an additive `web-v2/` output that does not touch `web/`.
- [ ] Explicitly prohibit invented live capabilities, destructive replacement, secret exposure, and removal of the existing frontend.
- [ ] Review the prompt against the final application and commit it separately.
