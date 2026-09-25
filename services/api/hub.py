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
    CameraOnline,
    DemoControl,
    HealthStrip,
    IncidentClass,
    IncidentState,
    IncidentStateChange,
    IncidentUpsert,
    OverlayBoxes,
    Severity,
    event_to_dict,
)
from services.brain.adjudicate import EscalateRequest, adjudicate
from services.brain.call_brief import assemble_call_brief
from services.brain.guardrails import DEFAULT_GUARDRAILS
from services.brain.zrt_client import ZRTClient
from services.api import telemetry
from services.api.vision_bridge import vision_enabled
from services.voice import VoiceAgent

WALL_CAMS = [f"cam-{i:02d}" for i in range(1, 7)]
ALL_CAMS = [f"cam-{i:02d}" for i in range(1, 13)]

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
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


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
    on_reset: Callable[[], None] | None = field(default=None, repr=False)

    async def publish(self, ev: Any) -> None:
        envelope = event_to_dict(ev)
        if envelope.get("type") in _REPLAY_TYPES:
            # ponytail: in-memory demo replay; persist if sessions grow beyond one run.
            self._replay = [*self._replay, envelope][-200:]
        await self.broadcast(envelope)
        # Live Seville path publishes IncidentUpsert here — start 911 loop on SEVERE.
        if isinstance(ev, IncidentUpsert) and ev.incident is not None:
            await self._on_incident(ev.incident)

    def replay_events(self) -> list[dict[str, Any]]:
        return list(self._replay)

    def _voice_agent(self) -> VoiceAgent:
        if self._voice is None:
            self._voice = VoiceAgent(self.publish)
        return self._voice

    async def _on_incident(self, rec: Any) -> None:
        # Cross-cam handoff while a call is live → whereabouts + security re-alert.
        voice = self._voice_agent()
        active = voice.active_incident_id()
        if active and voice.busy() and rec.camera_id in {"cam-02", "cam-03", "cam-01"}:
            brief = assemble_call_brief(rec)
            await voice.notify_whereabouts(rec.camera_id, brief.address)
        await self._maybe_start_voice(rec)

    async def _maybe_start_voice(self, rec: Any) -> None:
        if getattr(rec, "severity", None) is not Severity.SEVERE:
            return
        ok, reason = DEFAULT_GUARDRAILS.can_dispatch(rec.incident_id)
        if not ok:
            # Still allow whereabouts if this is a follow-on cam during an active call.
            if self._voice and self._voice.busy():
                brief = assemble_call_brief(rec)
                await self._voice.notify_whereabouts(rec.camera_id, brief.address)
            await self.publish(
                DemoControl(
                    action="scenario",
                    scenario_id=f"dispatch_blocked:{reason}",
                    ts=_utcnow(),
                )
            )
            return
        DEFAULT_GUARDRAILS.record_dispatch(rec.incident_id)
        brief = assemble_call_brief(rec)
        now = _utcnow()
        rec.state = IncidentState.DISPATCHED
        rec.updated_at = now
        await self.publish(
            IncidentStateChange(
                incident_id=rec.incident_id,
                state=IncidentState.DISPATCHED,
                severity=Severity.SEVERE,
                ts=now,
                note="Simulated call started",
            )
        )
        await self._voice_agent().start_call(rec, brief)
        # Optional real phone — no-op until Naman sets CS_TWILIO_ENABLED + keys.
        try:
            from services.voice.twilio_bridge import place_call

            result = await asyncio.to_thread(place_call, rec.incident_id)
            if result.get("ok"):
                await self.publish(
                    DemoControl(
                        action="scenario",
                        scenario_id=f"twilio_call:{result.get('call_sid')}",
                        ts=_utcnow(),
                    )
                )
            elif not result.get("skipped"):
                await self.publish(
                    DemoControl(
                        action="scenario",
                        scenario_id=f"twilio_fail:{result.get('reason')}",
                        ts=_utcnow(),
                    )
                )
        except Exception as exc:  # noqa: BLE001 — never break voice script on Twilio
            await self.publish(
                DemoControl(
                    action="scenario",
                    scenario_id=f"twilio_error:{type(exc).__name__}",
                    ts=_utcnow(),
                )
            )

    async def seed(self, *, force: bool = False) -> None:
        if self._seeded and not force:
            return
        self._seeded = True
        now = _utcnow()
        for cid in ALL_CAMS:
            await self.publish(CameraOnline(camera_id=cid, online=True, ts=now))
        # Prefer wall cams online for the six-pane UI; keep ALL_CAMS for legacy.
        for cid in WALL_CAMS:
            await self.publish(CameraOnline(camera_id=cid, online=True, ts=now))
        await self._health()
        if not vision_enabled():
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
        await self.publish(
            DemoControl(action="reset", scenario_id=None, ts=_utcnow())
        )
        self.frames_screened = 0
        self.frames_escalated = 0
        telemetry.reset()
        self._seeded = False
        await self.seed(force=True)

    async def run_scenario(
        self, scenario_id: str, *, camera_id: str | None = None
    ) -> str:
        key = (scenario_id or "armed-intruder").strip().lower()
        cls, default_cam = SCENARIOS.get(key, (IncidentClass.WEAPON, "cam-01"))
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
            iid = await self.run_scenario(str(msg.get("scenario_id") or "armed-intruder"))
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
        # Wall has six real feeds (CLIP_BY_CAM); do not advertise phantom cam-07..12.
        await self.publish(
            HealthStrip(
                cameras_online=len(WALL_CAMS),
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
