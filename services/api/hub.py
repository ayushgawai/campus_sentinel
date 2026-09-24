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
    event_to_dict,
)
from services.brain.adjudicate import EscalateRequest, adjudicate
from services.brain.zrt_client import ZRTClient

WALL_CAMS = [f"cam-{i:02d}" for i in range(1, 7)]
ALL_CAMS = [f"cam-{i:02d}" for i in range(1, 13)]

SCENARIOS: dict[str, tuple[IncidentClass, str]] = {
    # demo bar ids (web/js/mock/fixtures.js SCENARIOS)
    "person-down": (IncidentClass.FALL, "cam-05"),
    "forced-entry": (IncidentClass.THEFT, "cam-02"),
    "loitering": (IncidentClass.RUN, "cam-03"),
    # class-token aliases
    "fall": (IncidentClass.FALL, "cam-01"),
    "fight": (IncidentClass.FIGHT, "cam-01"),
    "theft": (IncidentClass.THEFT, "cam-02"),
    "run": (IncidentClass.RUN, "cam-03"),
    "medical": (IncidentClass.MEDICAL, "cam-01"),
    "benign": (IncidentClass.BENIGN, "cam-01"),
}

BroadcastFn = Callable[[dict[str, Any]], Awaitable[None]]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class DemoHub:
    broadcast: BroadcastFn
    frames_screened: int = 2_842_232
    frames_escalated: int = 17
    paused: bool = False
    _overlay_task: asyncio.Task[None] | None = field(default=None, repr=False)
    _health_task: asyncio.Task[None] | None = field(default=None, repr=False)
    _rng: random.Random = field(default_factory=lambda: random.Random(20260923))
    _seeded: bool = False

    async def publish(self, ev: Any) -> None:
        await self.broadcast(event_to_dict(ev))

    async def seed(self, *, force: bool = False) -> None:
        if self._seeded and not force:
            return
        self._seeded = True
        now = _utcnow()
        for cid in ALL_CAMS:
            await self.publish(CameraOnline(camera_id=cid, online=True, ts=now))
        await self._health()
        await self._overlays()
        # One real adjudicated incident so the queue is never empty on live.
        await self.run_scenario("person-down")

    async def start_loops(self) -> None:
        if self._health_task is not None:
            return
        self._health_task = asyncio.create_task(self._health_loop())
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
        await self.publish(
            DemoControl(action="reset", scenario_id=None, ts=_utcnow())
        )
        self.frames_screened = 2_842_232
        self.frames_escalated = 17
        self._seeded = False
        await self.seed(force=True)

    async def run_scenario(
        self, scenario_id: str, *, camera_id: str | None = None
    ) -> str:
        key = (scenario_id or "person-down").strip().lower()
        cls, default_cam = SCENARIOS.get(key, (IncidentClass.FALL, "cam-05"))
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
            iid = await self.run_scenario(str(msg.get("scenario_id") or "person-down"))
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
        self.frames_screened += 30
        await self.publish(
            HealthStrip(
                cameras_online=len(ALL_CAMS),
                cameras_total=len(ALL_CAMS),
                models_resident=True,
                gpu_util=0.68,
                p95_ms=182.0,
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
