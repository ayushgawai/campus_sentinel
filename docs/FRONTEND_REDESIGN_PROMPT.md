# Claude prompt: clean-sheet Campus Sentinel frontend

Copy everything below this line into Claude.

---

You are the product design lead and senior frontend engineer for Campus Sentinel, an AI-assisted campus security operations system for San Jose State University. Reimagine the product from a completely blank canvas using your best UI and UX judgment.

Do not inspect, imitate, restyle, or incrementally edit the current frontend. Do not preserve its layout, visual hierarchy, component structure, navigation, card patterns, typography, colors, or interaction model. You are not being asked to improve an existing dashboard. You are being asked to design the best possible interface for this product as if no frontend existed.

Create the new experience as a separate, additive frontend. Do not modify, delete, rename, or replace the existing frontend. It must remain available as a working backup. Do not describe where the current code or features live, and do not anchor your design to existing filenames or implementation details.

## Product outcome

Design a high-trust, real-time AI security command center that judges can understand within seconds during a live demo. It should feel advanced, precise, calm, and operational, not cinematic, militaristic, cluttered, or difficult to learn. It should look high-tech because information moves intelligently and relationships are clear, not because the screen is covered in glowing decoration.

The primary operator must be able to answer these questions instantly:

1. What is happening?
2. Where is it happening now?
3. Who or what is being tracked?
4. How certain is the system?
5. What has already been done?
6. Is the emergency call live, and what is being said?
7. What action can the operator safely take next?

Use plain language, sentence case, legible typography, clear severity semantics, and restrained motion. Give the product a distinctive visual identity grounded in university campus safety, live video intelligence, incident continuity, and trustworthy automation. Avoid generic SaaS dashboards, identical rounded cards, gratuitous gradients, cyberpunk neon, excessive monospace text, and decorative charts.

## Real system concept

Campus Sentinel watches six campus camera feeds in a single operator experience.

- Cameras 1, 2, and 3 form the intelligent incident path. One person of interest appears first in Camera 1, then moves to Camera 2, then Camera 3.
- Camera 1 is the MacQuarrie Hall ground-floor lobby and entrance.
- Camera 2 is the MacQuarrie Hall east corridor.
- Camera 3 is the MacQuarrie Hall west corridor and stairwell.
- Cameras 4, 5, and 6 are real ambient streams shown so the camera wall feels natural, but they never enter the expensive YOLO or Qwen analysis path.
- The site is San Jose State University.
- The canonical address is MacQuarrie Hall, One Washington Square, San Jose, CA 95192.
- The same person must keep one stable, human-readable identity through Cameras 1, 2, and 3. A reset begins again at Person 1 and Incident 1.
- Detection overlays must appear only while a person is visibly present. Empty frames must not retain stale or ghost boxes.
- The system may show a visible firearm classification and confidence only when backed by the current incident data.
- The frontend must never imply that Cameras 4, 5, or 6 are being analyzed by the AI pipeline.

The processing concept is intentionally resource-aware:

- YOLO performs person and weapon detection and tracking only on Cameras 1 through 3.
- The visual-language model validates and describes the incident once, then the result is reused for later camera handoffs instead of repeatedly loading the GPU.
- Qwen is used for bounded visual adjudication and for uncommon dispatcher questions.
- Deterministic facts answer routine dispatcher questions immediately.
- Parakeet provides speech-to-text for the live caller.
- Kokoro provides text-to-speech for Campus Sentinel.
- SignalWire carries the outbound demo phone call and two-way media stream.
- Cameras 4 through 6 remain stream-only.
- The interface must communicate the distinction between live data, measured readiness, cached intelligence, operator actions, and demo-only behavior.

## Current-camera truth and time-bounded knowledge

This is a critical product rule and should be visible in the interaction design.

Campus Sentinel may know only what has happened up to the current video time. It must not reveal a future camera, future direction, future event, or later frame before it appears on screen.

- While the person is on Camera 1, the call agent knows only the Camera 1 observation, current direction, visible weapon, description, address, and confirmed unknowns.
- After the real handoff to Camera 2, the shared call context updates to Camera 2 facts.
- After the real handoff to Camera 3, it updates to Camera 3 facts.
- Every handoff should update the active incident, map position, camera focus, call transcript, and emergency-call brain from one shared current state.
- Pre-described scene metadata may be used for demo speed and reliability, but only the facts for the current camera and current playback time may be exposed.
- Unknown identity, intent, injury status, exact weapon type, locked-door status, and other unseen facts must remain explicitly unknown.
- If model inference is unavailable, deterministic time-synchronized scene facts are an acceptable fallback. The UI must not pretend fallback facts came from a live model.

Design a clear, unobtrusive way to communicate current observation time, source, freshness, and camera handoff without overwhelming the operator.

## Required product areas

You have creative freedom over the information architecture. These capabilities must all be represented, but they do not have to remain separate pages if a better workflow exists.

### Live operations

- Six simultaneous live camera streams.
- Clear online, offline, reconnecting, no-signal, and loading states per camera.
- Recording/live indicator and measured frame rate.
- Camera number and canonical location.
- Current person boxes, stable Person 1 identity, weapon label, and confidence when available.
- No stale boxes after a subject leaves the frame.
- Automatic focus on the active camera.
- Split focus during a handoff when seeing both the previous and current camera improves comprehension.
- Fast expand and collapse for a single feed.
- A visible but calm severe-incident treatment.
- A direct path from an active camera to its incident details.
- A site-map or spatial view that shows Cameras 1 through 6, camera adjacency, the current camera, the observed movement path, and only defensible next-camera information.
- Optional operator-controlled auto-follow.
- Ambient Cameras 4 through 6 must continue streaming naturally while the incident progresses.

### Incident operations

- Incident queue with meaningful sorting and filtering.
- Incident detail with incident number, class, severity, state, camera, location, timestamps, current description, person description, rules or evidence, confidence, and chronological timeline.
- Lifecycle states: NEW, ALERTED, DISPATCH_PENDING, DISPATCHED, TRACKING, RESOLVED, and DISMISSED.
- Manual incident report for Weapon, Fight, Theft, Medical, and Running.
- Severity choices NONE, MINOR, and SEVERE where operationally appropriate.
- Call for help or dispatch action with a guarded pending state.
- Confirm action.
- Dismiss action with False alarm, Authorized activity, and Other reasons.
- Broadcast action with audience choices Everyone, Students, Faculty and staff, and Security team.
- Broadcast message limit of 280 characters and useful safety-message presets.
- Every operator action needs pending, success, rejected, conflict, offline, timeout, validation, and retry states.
- Never show a local success in live mode unless the backend confirms it.
- Preserve selection and context when moving between video, incident, and call views.

### Emergency call console

- Clearly distinguish an actual SignalWire demo call from an offline scripted simulation.
- Show call status such as not configured, ready, dialing, ringing if available, connected, active, failed, ended, and killed by safety switch.
- Show the complete real-time transcript with Campus Sentinel and dispatcher speakers clearly distinguished.
- Show the exact current camera and incident attached to the conversation.
- Show live structured tool results such as location lookup, person description, elapsed time, suspect status, and repeated answer.
- Make camera handoff updates obvious inside the transcript without making them look like ordinary speech.
- Provide an understandable indication when an answer came from deterministic current facts, bounded Qwen reasoning, or an explicit unknown response.
- Never show provider credentials, tokens, raw phone secrets, or internal prompt text.
- Never expose or dial an emergency number. The system calls only the configured verified demo handset.

The live call should begin naturally with the meaning of:

"Hi, I am Campus Sentinel AI from San Jose State University. I want to report an armed person with a visible long firearm at MacQuarrie Hall, One Washington Square, San Jose, California 95192."

The wording may be polished for natural speech, but it must identify the AI caller, organization, activity, building, and complete address before waiting for questions.

The call brain must give immediate factual answers for common dispatcher questions:

- Exact location and address.
- Current camera and current visible observation.
- Number of people of interest.
- Person description and clothing.
- Visible weapon.
- Direction of travel.
- Time first observed and elapsed tracking time.
- Whether campus security was alerted.
- Whether injuries, identity, intent, medical condition, or other unseen details are known.

Unexpected questions may use Qwen, but its response must be short, grounded only in the current fact packet, and explicitly decline unsupported details.

### System and readiness

- Six-camera online count derived from real stream/file availability.
- Core vision/model readiness.
- Qwen or resident-model readiness.
- Parakeet ASR readiness based on a real health probe.
- Kokoro TTS readiness based on a real health probe.
- SignalWire configured/enabled state without exposing secrets.
- GPU utilization when measured.
- Processing p95 latency when measured.
- Frames screened and frames escalated.
- Clear Pending, Warming, Ready, Degraded, Offline, and Unknown semantics.
- Never display fake measurements. Use an honest unavailable state instead.
- Operational explanations should be concise and tell the user what is affected.

### Demo control and reset

- One prominent but protected Reset demo action.
- Reset must not restart or reload the models.
- Reset clears incidents, transcript, call state, operator-action state, overlays, counters, replay state, tracking identity, and current video position.
- Reset returns the videos to the beginning and begins again with Person 1 and Incident 1.
- Reset must have a confirmation interaction that prevents accidental activation without slowing a deliberate demo reset.
- Support play, pause, playback speed, timeline seeking where safe, scenario selection, intro replay, auto-follow, and model pre-warm if those controls improve the demo.
- Clearly label controls that exist only for demonstration.
- A reset must never create duplicate services or place an accidental phone call.

### Global product behavior

- A concise product identity and branded entry/loading experience.
- A global current-time display where useful.
- A command or assist surface for quick access to incidents, site map, and call state.
- Keyboard navigation and efficient shortcuts for trained operators.
- Meaningful empty states before any incident exists.
- First-class disconnected, reconnecting, partially degraded, and recovered states.
- Toasts or status regions for operator action outcomes, with screen-reader announcements.
- No fabricated live data.
- No secret values in the browser.
- No raw frames sent through JSON events.

## Backend capabilities the design must consume

Do not redesign the backend contract or invent endpoints. Design the frontend around these capabilities.

### HTTP

- `GET /health`: API process health.
- `GET /voice/status`: SignalWire configuration state plus real Parakeet and Kokoro readiness.
- `GET /api/site`: canonical site and camera metadata.
- `POST /api/incidents/manual`: create an operator-reported incident.
- `POST /api/incidents/{incident_id}/dispatch`: request guarded dispatch and call flow.
- `POST /api/incidents/{incident_id}/confirm`: confirm or resolve an incident.
- `POST /api/incidents/{incident_id}/dismiss`: dismiss with a reason.
- `POST /api/broadcast`: send a site or incident-linked safety broadcast.
- `POST /signalwire/voice`: return the call-control XML for the configured demo call.
- `GET /signalwire/media`: upgrade to the live two-way call media WebSocket.
- `GET /mjpeg/{camera_id}`: live MJPEG camera stream.
- `GET /media/{camera_id}`: seekable or looping MP4 camera media with byte-range support.
- `OPTIONS`: CORS preflight.

Expected API outcomes include success, validation error, unknown incident, invalid state conflict, oversized body, unavailable dependency, timeout, and server failure.

### Live WebSocket events

- `incident.upsert`: complete current incident record.
- `incident.state_change`: lifecycle transition with timestamp, severity, and note.
- `overlay.boxes`: normalized 0-to-1 detection boxes for one camera and timestamp.
- `health.strip`: camera count, model residency, GPU, latency, screened count, and escalated count.
- `call.transcript_delta`: one live dispatcher or Campus Sentinel transcript line.
- `tool.call_live`: a structured call-tool invocation and result.
- `demo.control`: reset, scenario, pre-warm, security alert, provider call status, or failure signal.
- `camera.online`: online state for Cameras 1 through 6 only.

The WebSocket also accepts demo commands for start, stop, pause, scenario, state change, and reset. Reconnects receive a bounded replay of the current incident and call context.

## Design standards

- Desktop control-room use is primary, including 1440p and ultrawide screens.
- Provide a strong responsive strategy for laptop and tablet. On small screens, prioritize the active incident, active camera, and call status instead of squeezing all six streams into unreadable tiles.
- Meet WCAG 2.2 AA contrast and interaction requirements.
- Everything must be keyboard reachable with visible focus.
- Do not rely on color alone for severity, state, model readiness, or online status.
- Respect reduced-motion settings.
- Keep live video aspect ratios stable and avoid layout shifts.
- Use text content safely and never render incoming event text as HTML.
- Keep operational actions large enough for fast, accurate use.
- Destructive or high-impact actions require clear confirmation and state feedback.
- Use motion only to explain a handoff, new severe incident, state transition, or user action.

## Creative direction and process

Use your own expert judgment. Do not ask us to select a visual style before you begin.

1. Establish a distinct product design thesis specific to AI campus safety.
2. Define a compact color, typography, spacing, elevation, iconography, data-visualization, and motion system.
3. Explore at least three genuinely different information architectures with small wireframes.
4. Select the strongest direction and explain why it gives a judge immediate comprehension while remaining credible for a real operator.
5. Design every screen and every important empty, loading, active, degraded, error, confirmation, and success state.
6. Critique the design for generic AI-dashboard patterns and revise anything templated.
7. Validate the full armed-person journey from Camera 1 to Camera 2 to Camera 3, including the live phone conversation and reset.
8. Validate that no interface reveals future knowledge.
9. Only after the design system and interaction specification are coherent, implement the new frontend as a separate additive application without touching the existing frontend.

Spend visual boldness in one memorable place, ideally the live incident and camera-handoff experience. Keep everything else calm and disciplined.

## Required deliverables

Produce:

1. Product-design thesis and operator principles.
2. Information architecture and navigation rationale.
3. Three alternative low-fidelity layout concepts.
4. Selected direction with design tokens and component principles.
5. Detailed desktop, laptop, tablet, and small-screen specifications.
6. Complete screen inventory and state matrix.
7. The end-to-end Camera 1 to Camera 2 to Camera 3 incident journey.
8. The end-to-end SignalWire call journey, including transcript and grounded Q&A.
9. Accessibility and keyboard behavior.
10. Error, reconnect, degraded-service, and no-data behavior.
11. A high-fidelity new frontend implementation in a separate additive location.
12. A mapping showing how every HTTP capability and WebSocket event appears in the new experience.
13. A verification checklist demonstrating that every capability in this brief is represented and that the existing frontend remains untouched.

Do not use lorem ipsum. Use realistic Campus Sentinel content based only on this brief. Do not invent additional models, sensors, analytics, integrations, law-enforcement capabilities, biometric identification, face recognition, weapon certainty, or emergency-response authority.

The final result should feel like a new product, not a reskin.
