"""Voice service — officer-driven 911 script + tool lookups (demo).

Real Parakeet ASR / Kokoro TTS / SignalWire stream transport is wired separately.
Until then this agent simulates the dispatcher and keeps whereabouts up to date.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from contracts import (
    CallBrief,
    CallTranscriptDelta,
    DemoControl,
    IncidentRecord,
    ToolCallLive,
    call_brief_to_dict,
    utcnow,
)
from services.brain.call_brief import scene_facts, site_config
from services.brain.zrt_client import ZRTClient

from .tools import TOOL_HANDLERS, ToolName

PublishFn = Callable[[Any], Awaitable[None]]


@dataclass
class CallScriptStep:
    after_s: float
    speaker: str  # dispatcher | sentinel
    text: str = ""
    tool: ToolName | None = None


# Officer Q&A for WEAPON demo. Sentinel only speaks map/camera facts + tools.
WEAPON_SCRIPT: list[CallScriptStep] = [
    CallScriptStep(0.3, "sentinel", "Campus Sentinel on a simulated line with campus security dispatch."),
    CallScriptStep(0.8, "dispatcher", "Go ahead — what are you reporting?"),
    CallScriptStep(
        0.6,
        "sentinel",
        "Armed individual with a visible firearm on camera {camera}. Location: {address}.",
    ),
    CallScriptStep(0.9, "dispatcher", "Is the person conscious? Any injuries? Names?"),
    CallScriptStep(
        0.5,
        "sentinel",
        "I cannot confirm consciousness, injury, pulse, or identity. I only report what the cameras show.",
    ),
    CallScriptStep(0.8, "dispatcher", "Give me a description of the subject."),
    CallScriptStep(0.4, "sentinel", tool="get_person_description"),
    CallScriptStep(0.7, "dispatcher", "Exact location and how long have you been tracking?"),
    CallScriptStep(0.4, "sentinel", tool="lookup_location"),
    CallScriptStep(0.4, "sentinel", tool="get_elapsed_time"),
    CallScriptStep(0.8, "dispatcher", "Direction of travel? Which camera next?"),
    CallScriptStep(
        0.5,
        "sentinel",
        "Subject last seen on {camera}. Adjacent cameras are monitored; I will update if they reappear.",
    ),
    CallScriptStep(0.8, "dispatcher", "Copy. Security is notified. Stay on the line for updates."),
    CallScriptStep(
        0.5,
        "sentinel",
        "Acknowledged. I will keep reporting camera handoffs. This call remains simulated — not a live PSAP.",
    ),
]


class VoiceAgent:
    """Plays officer script; accepts live whereabouts updates when subject hits cam-02/03."""

    def __init__(self, publish: PublishFn, *, zrt: ZRTClient | None = None) -> None:
        self.publish = publish
        self._zrt = zrt or ZRTClient()
        self._task: asyncio.Task[None] | None = None
        self._live = False
        self._incident_id: str | None = None
        self._camera = ""
        self._address = ""
        self._person = ""
        self._visible = True
        self._live_brief: CallBrief | None = None
        self._update_q: asyncio.Queue[tuple[str, str]] = asyncio.Queue()

    def busy(self) -> bool:
        return self._live or (self._task is not None and not self._task.done())

    def active_incident_id(self) -> str | None:
        return self._incident_id if self.busy() else None

    async def start_call(
        self,
        rec: IncidentRecord,
        brief: CallBrief,
        *,
        script: list[CallScriptStep] | None = None,
    ) -> None:
        if self.busy():
            return
        self._update_q = asyncio.Queue()
        self._incident_id = rec.incident_id
        self._camera = rec.camera_id
        self._address = brief.address
        self._person = brief.person_description
        self._live_brief = brief
        self._visible = True
        self._task = asyncio.create_task(
            self._run(rec, brief, script or WEAPON_SCRIPT),
            name=f"call-{rec.incident_id}",
        )

    async def start_live_call(self, rec: IncidentRecord, brief: CallBrief) -> None:
        if self.busy():
            return
        self._live = True
        self._incident_id = rec.incident_id
        self._camera = rec.camera_id
        self._address = brief.address
        self._person = brief.person_description
        self._live_brief = brief
        self._visible = True
        facts = scene_facts(rec.camera_id)
        site = site_config()
        text = (
            f"Hi, I am Campus Sentinel AI from {site.get('name', 'San Jose State University')}. "
            f"I want to report an armed person with a visible "
            f"{facts.get('visible_weapon', 'weapon')} at "
            f"{brief.building or 'MacQuarrie Hall'}, {site.get('address', brief.address)}. "
            f"Current camera observation: {facts.get('current_observation', rec.description)}."
        )
        await self.publish(
            CallTranscriptDelta(
                incident_id=rec.incident_id,
                speaker="sentinel",
                text=text,
                ts=utcnow(),
            )
        )
        await self.publish(
            DemoControl(
                action="scenario",
                scenario_id=f"security_alert:{rec.camera_id}",
                ts=utcnow(),
            )
        )

    async def answer_dispatcher(self, incident_id: str, question: str) -> str:
        if not self._live or incident_id != self._incident_id:
            return "There is no active Campus Sentinel call for that incident."
        facts = scene_facts(self._camera)
        facts.update(
            camera_id=self._camera,
            address=self._address,
            person_description=self._person,
        )
        q = question.lower()
        if any(word in q for word in ("where", "location", "address")):
            observation = (
                facts.get("current_observation", "")
                if self._visible
                else "The person is not currently visible; this is the last confirmed camera."
            )
            answer = f"The person is at {self._address}. {observation}".strip()
        elif any(word in q for word in ("weapon", "gun", "firearm")):
            answer = f"The cameras show a visible {facts.get('visible_weapon', 'weapon')}."
        elif any(word in q for word in ("hurt", "injur", "medical", "conscious", "breath", "pulse")):
            answer = "I cannot confirm any injuries or medical condition from the cameras."
        elif any(word in q for word in ("direction", "travel", "going", "headed")):
            answer = f"The person is {facts.get('direction', 'moving in an unconfirmed direction')}."
        elif any(word in q for word in ("describe", "description", "wearing", "clothing", "look like")):
            answer = f"The person appears to be {self._person.rstrip('.').lower()}."
        elif any(word in q for word in ("how many", "count", "number of")):
            answer = f"The cameras currently show {facts.get('subject_count', 1)} person of interest."
        elif any(word in q for word in ("name", "identity", "who is", "intent", "why")):
            answer = "I cannot confirm the person's identity or intent from the cameras."
        else:
            try:
                answer = await asyncio.to_thread(self._zrt.answer_dispatcher, facts, question)
            except Exception:
                answer = "The cameras do not confirm that detail."
        await self.publish(
            CallTranscriptDelta(
                incident_id=incident_id,
                speaker="sentinel",
                text=answer,
                ts=utcnow(),
            )
        )
        return answer

    def update_visual(self, camera_id: str, visible: bool) -> None:
        """Keep live answers aligned with the latest overlay without model work."""
        if self._live and camera_id == self._camera:
            self._visible = visible

    async def notify_whereabouts(self, camera_id: str, address: str) -> None:
        """Vision escalated the chase on another camera — update the live call."""
        if not self.busy() or not self._incident_id:
            return
        if self._live:
            await self._publish_update(camera_id, address)
        else:
            await self._update_q.put((camera_id, address))

    async def cancel(self) -> None:
        self._live = False
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None
        self._incident_id = None

    async def _publish_update(self, camera_id: str, address: str) -> None:
        self._camera = camera_id
        self._address = address
        self._visible = True
        if self._live_brief is not None:
            self._live_brief.camera_id = camera_id
            self._live_brief.address = address
        await self.publish(
            CallTranscriptDelta(
                incident_id=self._incident_id or "",
                speaker="sentinel",
                text=(
                    f"Update: the person is now on {camera_id}, {address}. "
                    "Campus security has been re-alerted for this handoff."
                ),
                ts=utcnow(),
            )
        )
        await self.publish(
            DemoControl(
                action="scenario",
                scenario_id=f"security_alert:{camera_id}",
                ts=utcnow(),
            )
        )

    async def _drain_updates(self, rec: IncidentRecord) -> None:
        while True:
            try:
                cam, address = self._update_q.get_nowait()
            except asyncio.QueueEmpty:
                return
            await self._publish_update(cam, address)
            await self.publish(
                ToolCallLive(
                    incident_id=rec.incident_id,
                    tool="lookup_location",
                    args={"camera_id": cam},
                    result={
                        "address": address,
                        "spoken": f"Location on file: {address}.",
                    },
                    ts=utcnow(),
                )
            )

    async def _run(
        self,
        rec: IncidentRecord,
        brief: CallBrief,
        script: list[CallScriptStep],
    ) -> None:
        ctx: dict[str, Any] = {
            "camera": rec.camera_id,
            "address": brief.address,
            "person": brief.person_description,
            "brief": brief,
            "record": rec,
            "brief_dict": call_brief_to_dict(brief),
        }
        try:
            await self.publish(
                CallTranscriptDelta(
                    incident_id=rec.incident_id,
                    speaker="sentinel",
                    text=(
                        "Simulated 911 demo call to "
                        f"{os.environ.get('CS_DEMO_TO_NUMBER', 'configured demo phone')} started."
                    ),
                    ts=utcnow(),
                )
            )
            await self.publish(
                DemoControl(
                    action="scenario",
                    scenario_id=f"security_alert:{rec.camera_id}",
                    ts=utcnow(),
                )
            )
            for step in script:
                await self._drain_updates(rec)
                await asyncio.sleep(step.after_s)
                await self._drain_updates(rec)
                ctx["camera"] = self._camera or rec.camera_id
                ctx["address"] = self._address or brief.address
                ctx["person"] = self._person or brief.person_description
                now = utcnow()
                if step.tool:
                    handler = TOOL_HANDLERS[step.tool]
                    args, result = handler(ctx)
                    await self.publish(
                        ToolCallLive(
                            incident_id=rec.incident_id,
                            tool=step.tool,
                            args=args,
                            result=result,
                            ts=now,
                        )
                    )
                    spoken = str(result.get("spoken") or result.get("text") or "")
                    if spoken:
                        await self.publish(
                            CallTranscriptDelta(
                                incident_id=rec.incident_id,
                                speaker="sentinel",
                                text=spoken,
                                ts=utcnow(),
                            )
                        )
                    continue
                text = step.text.format(
                    camera=ctx["camera"],
                    address=ctx["address"],
                    person=ctx["person"],
                )
                await self.publish(
                    CallTranscriptDelta(
                        incident_id=rec.incident_id,
                        speaker=step.speaker,  # type: ignore[arg-type]
                        text=text,
                        ts=now,
                    )
                )
            for _ in range(20):
                await self._drain_updates(rec)
                await asyncio.sleep(0.5)
        except asyncio.CancelledError:
            raise
        finally:
            self._incident_id = None
