"""Demo hub — fans contracts/events.py envelopes to all WS clients.

Drives forced-ZRT adjudicate for scenarios so the live dashboard path
hits the real brain without needing vision on main yet.
"""

from __future__ import annotations

import asyncio
import json
import random
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Awaitable

from contracts import (
    BBox,
    CallBriefEvent,
    CameraOnline,
    DemoControl,
    HealthStrip,
    IncidentClass,
    IncidentRecord,
    IncidentState,
    IncidentStateChange,
    IncidentUpsert,
    OverlayBoxes,
    Severity,
    TimelineEvent,
    call_brief_to_dict,
    event_to_dict,
    incident_to_dict,
)
from services.brain.adjudicate import EscalateRequest, adjudicate
from services.brain.call_brief import assemble_call_brief, scene_facts
from services.brain.guardrails import DEFAULT_GUARDRAILS
from services.brain.zrt_client import ZRTClient
from services.api import telemetry
from services.api.vision_bridge import ARMED_LABEL, vision_enabled
from services.voice import VoiceAgent

WALL_CAMS = [f"cam-{i:02d}" for i in range(1, 7)]

SCENARIOS: dict[str, tuple[IncidentClass, str]] = {
    # Primary demo: Seville armed chase
    "armed-intruder": (IncidentClass.WEAPON, "cam-01"),
    "person-down": (IncidentClass.WEAPON, "cam-01"),  # legacy UI id → WEAPON
    "forced-entry": (IncidentClass.THEFT, "cam-02"),
    "loitering": (IncidentClass.RUN, "cam-03"),
    "weapon": (IncidentClass.WEAPON, "cam-01"),
    "fall": (IncidentClass.WEAPON, "cam-01"),  # legacy alias
    "fight": (IncidentClass.FIGHT, "cam-01"),
    "theft": (IncidentClass.THEFT, "cam-02"),
    "run": (IncidentClass.RUN, "cam-03"),
    "medical": (IncidentClass.MEDICAL, "cam-01"),
    "benign": (IncidentClass.BENIGN, "cam-01"),
}

BroadcastFn = Callable[[dict[str, Any]], Awaitable[None]]
_REPLAY_TYPES = {
    "incident.upsert",
    "incident.state_change",
    "call.transcript_delta",
    "tool.call_live",
    "call.brief",
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _scripted(rec: Any) -> bool:
    """Demo-panel scenarios are scripted, never a real detection."""
    return any(
        str(rule).startswith("scenario:") for rule in getattr(rec, "rules_fired", [])
    )


def _real_weapon_detection(rec: Any) -> bool:
    """Only a vision-detected WEAPON may place a real SignalWire call."""
    rules = getattr(rec, "rules_fired", [])
    return (
        getattr(rec, "class_token", None) is IncidentClass.WEAPON
        and not _scripted(rec)
        and "operator_report" not in rules
    )


@dataclass
class DemoHub:
    broadcast: BroadcastFn
    # Counters start at zero and only move when real work happens: the vision
    # bridge adds one per decoded frame, adjudicate adds one per escalation.
    frames_screened: int = 0
    frames_escalated: int = 0
    paused: bool = False
    _overlay_task: asyncio.Task[None] | None = field(default=None, repr=False)
    _health_task: asyncio.Task[None] | None = field(default=None, repr=False)
    _rng: random.Random = field(default_factory=lambda: random.Random(20260923))
    _seeded: bool = False
    _voice: VoiceAgent | None = field(default=None, repr=False)
    _replay: list[dict[str, Any]] = field(default_factory=list, repr=False)
    _incidents: dict[str, IncidentRecord] = field(default_factory=dict, repr=False)
    _incident_seq: int = field(default=0, repr=False)
    _dispatch_lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)
    # Camera of the last call.brief per incident: one brief per real handoff.
    _brief_camera: dict[str, str] = field(default_factory=dict, repr=False)
    on_reset: Callable[[], None] | None = field(default=None, repr=False)
    camera_ready: Callable[[str], bool] | None = field(default=None, repr=False)

    async def publish(self, ev: Any) -> None:
        if isinstance(ev, OverlayBoxes) and self._voice is not None:
            self._voice.update_visual(
                ev.camera_id,
                bool(ev.boxes),
                people=len(ev.boxes),
                armed=sum(1 for box in ev.boxes if box.label == ARMED_LABEL),
            )
        if isinstance(ev, IncidentUpsert) and ev.incident is not None:
            self._incidents[ev.incident.incident_id] = ev.incident
        elif isinstance(ev, IncidentStateChange):
            rec = self._incidents.get(ev.incident_id)
            if rec is not None:
                rec.state = ev.state
                rec.updated_at = ev.ts or _utcnow()
                if ev.severity is not None:
                    rec.severity = ev.severity
                rec.timeline.append(
                    TimelineEvent(ts=rec.updated_at, state=ev.state, note=ev.note)
                )
        envelope = event_to_dict(ev)
        if envelope.get("type") in _REPLAY_TYPES:
            # ponytail: in-memory demo replay; persist if sessions grow beyond one run.
            self._replay = [*self._replay, envelope][-200:]
        await self.broadcast(envelope)
        # Live Seville path publishes IncidentUpsert here — start 911 loop on SEVERE.
        if isinstance(ev, IncidentUpsert) and ev.incident is not None:
            await self._on_incident(ev.incident)

    async def _publish_brief(self, brief: Any, reason: str) -> None:
        self._brief_camera[brief.incident_id] = brief.camera_id
        await self.publish(
            CallBriefEvent(
                incident_id=brief.incident_id,
                reason=reason,  # type: ignore[arg-type]
                brief=call_brief_to_dict(brief),
                ts=_utcnow(),
            )
        )

    def replay_events(self) -> list[dict[str, Any]]:
        return list(self._replay)

    def get_incident(self, incident_id: str) -> IncidentRecord | None:
        return self._incidents.get(incident_id)

    def _voice_agent(self) -> VoiceAgent:
        if self._voice is None:
            self._voice = VoiceAgent(self.publish)
        return self._voice

    async def _on_incident(self, rec: Any) -> None:
        # Cross-cam handoff while a call is live → whereabouts + security re-alert.
        voice = self._voice_agent()
        active = voice.active_incident_id()
        if (
            active
            and rec.incident_id == active
            and voice.busy()
            and rec.camera_id in {"cam-02", "cam-03", "cam-01"}
        ):
            brief = assemble_call_brief(rec)
            if self._brief_camera.get(rec.incident_id) != rec.camera_id:
                await self._publish_brief(brief, "handoff")
            await voice.notify_whereabouts(rec.camera_id, brief.address)
            return
        if "operator_report" not in getattr(rec, "rules_fired", []):
            await self._maybe_start_voice(rec)

    async def _maybe_start_voice(self, rec: Any, *, operator_requested: bool = False) -> bool:
        if getattr(rec, "severity", None) is not Severity.SEVERE:
            return False
        async with self._dispatch_lock:
            if self._voice_agent().busy():
                await self.publish(
                    DemoControl(
                        action="scenario",
                        scenario_id="dispatch_blocked:voice_busy",
                        ts=_utcnow(),
                    )
                )
                return False
            from services.voice.signalwire_bridge import load_config, place_call

            provider = load_config()
            ok, reason = DEFAULT_GUARDRAILS.can_dispatch(rec.incident_id)
            if ok and provider and _scripted(rec) and not operator_requested:
                # With real calling on, a scripted scenario gets no voice at
                # all: no call, and no simulated line holding voice busy.
                ok, reason = False, "scripted_scenario"
            if not ok:
                await self.publish(
                    DemoControl(
                        action="scenario",
                        scenario_id=f"dispatch_blocked:{reason}",
                        ts=_utcnow(),
                    )
                )
                return False
            if operator_requested:
                await self.send_state_change(
                    rec.incident_id,
                    "DISPATCH_PENDING",
                    "Operator requested dispatch",
                )
            DEFAULT_GUARDRAILS.record_dispatch(rec.incident_id)
            brief = assemble_call_brief(rec)
            now = _utcnow()
            rec.state = IncidentState.DISPATCHED
            rec.updated_at = now
            signalwire = provider if _real_weapon_detection(rec) else None
            await self.publish(
                IncidentStateChange(
                    incident_id=rec.incident_id,
                    state=IncidentState.DISPATCHED,
                    severity=Severity.SEVERE,
                    ts=now,
                    note="SignalWire call started" if signalwire else "Simulated call started",
                )
            )
            await self._publish_brief(brief, "dispatch")
            if not signalwire:
                await self._voice_agent().start_call(rec, brief)
                return True
            await self._voice_agent().start_live_call(rec, brief)
            placed = False
            try:
                result = await asyncio.to_thread(place_call, rec.incident_id, config=signalwire)
                placed = bool(result.get("ok"))
                if placed:
                    await self.publish(
                        DemoControl(
                            action="scenario",
                            scenario_id=f"signalwire_call:{result.get('call_sid')}",
                            ts=_utcnow(),
                        )
                    )
                elif not result.get("skipped"):
                    await self.publish(
                        DemoControl(
                            action="scenario",
                            scenario_id=f"signalwire_fail:{result.get('reason')}",
                            ts=_utcnow(),
                        )
                    )
            except Exception as exc:  # noqa: BLE001 — never break the voice script
                await self.publish(
                    DemoControl(
                        action="scenario",
                        scenario_id=f"signalwire_error:{type(exc).__name__}",
                        ts=_utcnow(),
                    )
                )
            if not placed:
                # No call exists, so the voice line must not stay busy and
                # block the next real dispatch.
                await self._voice_agent().cancel()
            return True

    async def answer_dispatcher(self, incident_id: str, question: str) -> str:
        return await self._voice_agent().answer_dispatcher(incident_id, question)

    async def seed(self, *, force: bool = False, run_scenario: bool = False) -> None:
        if self._seeded and not force:
            return
        self._seeded = True
        now = _utcnow()
        for cid in WALL_CAMS:
            await self.publish(CameraOnline(camera_id=cid, online=True, ts=now))
        await self._health()
        if not vision_enabled() and run_scenario:
            await self._overlays()
            # Scenario seed only when not on live Seville vision.
            await self.run_scenario("armed-intruder")

    async def start_loops(self) -> None:
        if self._health_task is not None:
            return
        self._health_task = asyncio.create_task(self._health_loop())
        # Live vision bridge publishes real overlay.boxes; skip synthetic ones.
        if not vision_enabled():
            self._overlay_task = asyncio.create_task(self._overlay_loop())

    async def stop_loops(self) -> None:
        for t in (self._health_task, self._overlay_task):
            if t is not None:
                t.cancel()
                try:
                    await t
                except asyncio.CancelledError:
                    pass
        self._health_task = None
        self._overlay_task = None

    async def set_paused(self, paused: bool) -> bool:
        self.paused = paused
        if paused:
            await self.stop_loops()
        else:
            await self.start_loops()
        return self.paused

    async def reset(self) -> None:
        if self._voice is not None:
            await self._voice.cancel()
        if self.on_reset is not None:
            self.on_reset()
        self._replay.clear()
        self._incidents.clear()
        self._brief_camera.clear()
        self._incident_seq = 0
        DEFAULT_GUARDRAILS._dispatched.clear()
        DEFAULT_GUARDRAILS._hour_hits.clear()
        await self.publish(
            DemoControl(action="reset", scenario_id=None, ts=_utcnow())
        )
        self.frames_screened = 0
        self.frames_escalated = 0
        telemetry.reset()
        self._seeded = False
        await self.seed(force=True, run_scenario=False)

    async def manual_incident(self, payload: dict[str, Any]) -> IncidentRecord:
        camera_id = str(payload.get("camera_id") or "")
        if camera_id not in WALL_CAMS:
            raise ValueError("camera_id must be cam-01 through cam-06")
        try:
            class_token = IncidentClass(str(payload.get("class_token") or ""))
            severity = Severity(str(payload.get("severity") or ""))
        except ValueError as exc:
            raise ValueError("invalid class_token or severity") from exc
        note = str(payload.get("note") or "").strip()[:500]
        self._incident_seq += 1
        now = _utcnow()
        facts = scene_facts(camera_id)
        rec = IncidentRecord(
            incident_id=f"INC-{self._incident_seq:04d}",
            track_id="T-1",
            camera_id=camera_id,
            peak_ts=now,
            class_token=class_token,
            class_logprob_calibrated=0.0,
            router_score=0.0,
            fused_prob=0.0,
            severity=severity,
            description=note or "Reported by operator",
            location_text="",
            person_description=str(facts.get("person_description") or "Unknown"),
            state=IncidentState.ALERTED,
            clip_uri="",
            created_at=now,
            updated_at=now,
            rules_fired=["operator_report"],
            timeline=[TimelineEvent(ts=now, state=IncidentState.ALERTED, note="Operator reported incident")],
        )
        rec.location_text = assemble_call_brief(rec).address
        await self.publish(IncidentUpsert(incident=rec))
        return rec

    async def dispatch_incident(self, incident_id: str) -> IncidentRecord:
        rec = self._require_incident(incident_id)
        if rec.state is not IncidentState.ALERTED:
            raise RuntimeError(f"incident is already {rec.state.value}")
        rec.severity = Severity.SEVERE
        if not await self._maybe_start_voice(rec, operator_requested=True):
            if self._voice is not None and self._voice.busy():
                raise RuntimeError("a voice call is already active")
            raise RuntimeError("dispatch was blocked")
        return rec

    async def confirm_incident(self, incident_id: str) -> IncidentRecord:
        rec = self._require_incident(incident_id)
        if rec.state in {IncidentState.RESOLVED, IncidentState.DISMISSED}:
            raise RuntimeError(f"incident is already {rec.state.value}")
        await self.send_state_change(incident_id, "RESOLVED", "Officer confirmed")
        return rec

    async def dismiss_incident(self, incident_id: str, reason: str) -> IncidentRecord:
        rec = self._require_incident(incident_id)
        if rec.state is not IncidentState.ALERTED:
            raise RuntimeError(f"cannot dismiss incident in {rec.state.value}")
        rec.dismissed_reason = reason[:200] or "Officer dismissed"
        await self.send_state_change(incident_id, "DISMISSED", rec.dismissed_reason)
        return rec

    async def broadcast_message(self, payload: dict[str, Any]) -> dict[str, Any]:
        message = str(payload.get("message") or "").strip()
        audience = payload.get("audience")
        if not message or not isinstance(audience, list) or not audience:
            raise ValueError("message and audience are required")
        incident_id = str(payload.get("incident_id") or "")
        if incident_id:
            rec = self._require_incident(incident_id)
            now = _utcnow()
            rec.timeline.append(
                TimelineEvent(
                    ts=now,
                    state=rec.state,
                    note=f"Broadcast to {', '.join(map(str, audience))}: {message[:280]}",
                )
            )
            rec.updated_at = now
            await self.publish(IncidentUpsert(incident=rec))
        return {"ok": True, "incident_id": incident_id or None}

    def _require_incident(self, incident_id: str) -> IncidentRecord:
        rec = self.get_incident(incident_id)
        if rec is None:
            raise KeyError(incident_id)
        return rec

    async def run_scenario(
        self, scenario_id: str, *, camera_id: str | None = None
    ) -> str:
        key = (scenario_id or "armed-intruder").strip().lower()
        if key not in SCENARIOS:
            # Never fabricate a WEAPON incident for an id we do not know.
            raise ValueError(f"unknown scenario: {key}")
        cls, default_cam = SCENARIOS[key]
        cam = camera_id or default_cam
        result = adjudicate(
            EscalateRequest(
                track_id=f"T-{self._rng.randint(1, 9)}",
                camera_id=cam,
                router_score=0.88 if cls is not IncidentClass.BENIGN else 0.12,
                rules_fired=[f"scenario:{key}"],
                class_token_forced=cls,
                allow_placeholder_thresholds=True,
                location_text=f"demo · {cam}",
                person_description="Adult, demo scenario.",
            ),
            zrt=ZRTClient(forced=True),
        )
        self.frames_escalated += 1
        await self.publish(IncidentUpsert(incident=result.record))
        await self.publish(
            DemoControl(action="scenario", scenario_id=key, ts=_utcnow())
        )
        return result.record.incident_id

    async def send_state_change(
        self, incident_id: str, state: str, note: str = ""
    ) -> None:
        await self.publish(
            IncidentStateChange(
                incident_id=incident_id,
                state=IncidentState(state),
                severity=None,
                ts=_utcnow(),
                note=note or "",
            )
        )

    async def handle_cmd(self, msg: dict[str, Any]) -> dict[str, Any] | None:
        cmd = msg.get("cmd") or msg.get("action")
        if cmd in (None, "start"):
            await self.seed()
            await self.start_loops()
            return {"ok": True, "cmd": "start"}
        if cmd == "stop":
            await self.stop_loops()
            return {"ok": True, "cmd": "stop"}
        if cmd == "setPaused":
            paused = await self.set_paused(bool(msg.get("paused", True)))
            return {"ok": True, "cmd": "setPaused", "paused": paused}
        if cmd == "runScenario":
            try:
                iid = await self.run_scenario(str(msg.get("scenario_id") or "armed-intruder"))
            except ValueError as exc:
                return {"ok": False, "cmd": "runScenario", "error": str(exc)}
            return {"ok": True, "cmd": "runScenario", "incident_id": iid}
        if cmd == "sendStateChange":
            await self.send_state_change(
                str(msg.get("incident_id") or ""),
                str(msg.get("state") or "RESOLVED"),
                str(msg.get("note") or ""),
            )
            return {"ok": True, "cmd": "sendStateChange"}
        if cmd == "reset":
            await self.reset()
            return {"ok": True, "cmd": "reset"}
        return {"ok": False, "error": f"unknown cmd: {cmd}"}

    async def _health(self) -> None:
        # Every field is measured. gpu_util and p95_ms go out as null rather than
        # a placeholder when there is no GPU to read or no router work yet.
        gpu_util, p95_ms, models_resident = await telemetry.sample()
        online = 0
        for camera_id in WALL_CAMS:
            ready = self.camera_ready(camera_id) if self.camera_ready else True
            online += int(ready)
            await self.publish(CameraOnline(camera_id=camera_id, online=ready, ts=_utcnow()))
        await self.publish(
            HealthStrip(
                cameras_online=online,
                cameras_total=len(WALL_CAMS),
                models_resident=models_resident,
                gpu_util=gpu_util,
                p95_ms=p95_ms,
                frames_screened=self.frames_screened,
                frames_escalated=self.frames_escalated,
                ts=_utcnow(),
            )
        )

    async def _overlays(self) -> None:
        now = _utcnow()
        for cid in WALL_CAMS:
            n = 1 + (ord(cid[-1]) % 3)
            boxes = [
                BBox(
                    x=0.1 + 0.15 * i,
                    y=0.35,
                    w=0.08,
                    h=0.22,
                    track_id=f"T-{i + 1}",
                    label="person",
                    score=0.55 + 0.1 * i,
                )
                for i in range(n)
            ]
            await self.publish(OverlayBoxes(camera_id=cid, ts=now, boxes=boxes))

    async def _health_loop(self) -> None:
        try:
            while True:
                if not self.paused:
                    await self._health()
                await asyncio.sleep(1.0)
        except asyncio.CancelledError:
            raise

    async def _overlay_loop(self) -> None:
        try:
            while True:
                if not self.paused:
                    await self._overlays()
                await asyncio.sleep(0.4)
        except asyncio.CancelledError:
            raise


def dumps(obj: dict[str, Any]) -> bytes:
    return json.dumps(obj, separators=(",", ":")).encode("utf-8")
