"""Voice service — officer-driven 911 script + tool lookups (demo).

Real Parakeet ASR / Kokoro TTS / SignalWire stream transport is wired separately.
Until then this agent simulates the dispatcher and keeps whereabouts up to date.
"""

from __future__ import annotations

import asyncio
import os
import re
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

from . import scene
from .demo_call import DEMO_CALL, OPENING
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
    CallScriptStep(0.3, "sentinel", "Sentinel AI on a simulated line with campus security dispatch."),
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


def handoff_line(camera_id: str, building: str = "") -> str:
    """Spoken handoff: a place name only, never camera ids or map notes."""
    place = str(scene_facts(camera_id).get("spoken_location") or "").strip()
    if not place:
        place = f"another part of {building}" if building else "another camera view"
    return (
        f"Update: the person has moved to {place}. "
        "Campus security has been re-alerted."
    )


def count_answer(people: int, armed: int) -> str:
    """Live person count from the tracker overlay, not a static fact."""
    if people <= 0:
        return "I don't see anyone on the current camera right now."
    who = "one person" if people == 1 else f"{people} people"
    if armed <= 0:
        return f"The current camera shows {who}."
    if people == 1:
        return "The current camera shows one person, and they are armed."
    which = "one of them is" if armed == 1 else f"{armed} of them are"
    return f"The current camera shows {who}; {which} armed."


class VoiceAgent:
    """Plays officer script; accepts live whereabouts updates when subject hits cam-02/03."""

    def __init__(self, publish: PublishFn, *, zrt: ZRTClient | None = None) -> None:
        self.publish = publish
        # Clip clock of the camera wall (seconds); answers describe that moment.
        self.clock: Callable[[], float] = lambda: 0.0
        self._zrt = zrt or ZRTClient()
        self._task: asyncio.Task[None] | None = None
        self._live = False
        self._incident_id: str | None = None
        self._camera = ""
        self._address = ""
        self._building = ""
        self._site_address = ""
        self._person = ""
        self._visible = True
        self._last_answer = ""
        self._unknown_answer_index = 0
        self._live_brief: CallBrief | None = None
        # camera_id -> (people, armed) from the latest overlay.boxes.
        self._counts: dict[str, tuple[int, int]] = {}
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
        self._building = brief.building or "MacQuarrie Hall"
        self._site_address = str(site_config().get("address", brief.address)).replace(
            ", CA ", ", California "
        )
        self._person = brief.person_description
        self._live_brief = brief
        self._visible = True
        self._unknown_answer_index = 0
        self._task = asyncio.create_task(
            self._run(rec, brief, script or WEAPON_SCRIPT),
            name=f"call-{rec.incident_id}",
        )

    async def start_scripted_call(self, rec: IncidentRecord) -> None:
        """Demo recording: the scripted 911 call, each line at its clip second."""
        if self.busy():
            return
        self._incident_id = rec.incident_id
        self._camera = rec.camera_id
        self._task = asyncio.create_task(
            self._run_scripted(rec.incident_id), name=f"demo-call-{rec.incident_id}"
        )

    async def _run_scripted(self, incident_id: str) -> None:
        start = self.clock()
        lines = [
            line for i, line in enumerate(DEMO_CALL) if i < OPENING or line[0] >= start
        ]
        try:
            for i, (at_s, speaker, text) in enumerate(lines):
                # The opening is always spoken; later lines wait for their second.
                wait = 1.5 if i < OPENING and at_s < start else at_s - self.clock()
                if wait > 0:
                    await asyncio.sleep(wait)
                await self.publish(
                    CallTranscriptDelta(
                        incident_id=incident_id,
                        speaker=speaker,  # type: ignore[arg-type]
                        text=text,
                        ts=utcnow(),
                    )
                )
            await asyncio.sleep(3600)  # stay "on the line" until Reset
        finally:
            self._incident_id = None

    async def start_live_call(self, rec: IncidentRecord, brief: CallBrief) -> None:
        if self.busy():
            return
        self._live = True
        self._incident_id = rec.incident_id
        self._camera = rec.camera_id
        self._address = brief.address
        self._building = brief.building or "MacQuarrie Hall"
        self._person = brief.person_description
        self._live_brief = brief
        self._visible = True
        self._unknown_answer_index = 0
        facts = scene_facts(rec.camera_id)
        site = site_config()
        self._site_address = str(site.get("address", brief.address)).replace(
            ", CA ", ", California "
        )
        text = (
            f"Hi, this is Sentinel AI at "
            f"{site.get('spoken_name', site.get('name', 'San Jose State'))}. "
            f"I'm reporting armed people inside {self._building}, "
            "One Washington Square."
        )
        self._last_answer = text
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
            return "There is no active Sentinel AI call for that incident."
        facts = scene_facts(self._camera)
        facts.update(
            camera_id=self._camera,
            address=self._address,
            person_description=self._person,
        )
        if self._camera in self._counts:
            # Live tracker count replaces the static map fact.
            facts["subject_count"], facts["armed_count"] = self._counts[self._camera]
        q = question.lower()
        if q.strip(" .,!?") in {
            "ok", "okay", "copy", "got it", "understood", "thanks", "thank you"
        }:
            return ""
        # Fixed questions answer instantly from the scene script at this clip second.
        fixed = scene.answer(question, self.clock())
        if fixed:
            self._last_answer = fixed
            await self.publish(
                CallTranscriptDelta(
                    incident_id=incident_id, speaker="sentinel", text=fixed, ts=utcnow()
                )
            )
            return fixed
        if "repeat" in q or "say that again" in q:
            if "address" in q:
                answer = f"{self._site_address}."
            else:
                answer = self._last_answer
        elif "emergency" in q or "what are you reporting" in q:
            answer = f"I'm reporting an armed person at {self._building}."
        elif "address" in q or q.strip(" ?.!") == "where are you":
            answer = f"{self._site_address}."
        elif "where" in q or "location" in q:
            answer = (
                f"The person is in {facts['spoken_location']}."
                if self._visible
                and facts.get("spoken_location")
                else "I don't see the person now; this is their last confirmed camera."
            )
        elif not self._visible and any(
            word in q
            for word in (
                "weapon", "gun", "firearm", "direction", "travel", "going",
                "headed", "describe", "description", "wearing", "clothing",
                "look like",
            )
        ):
            answer = "They aren't visible, so I can't verify that now."
        elif any(word in q for word in ("weapon", "gun", "firearm")):
            answer = f"The cameras show a visible {facts.get('visible_weapon', 'weapon')}."
        elif any(word in q for word in ("hurt", "injur", "medical", "conscious", "breath", "pulse")):
            answer = "I can't verify their medical condition from this camera."
        elif any(word in q for word in ("direction", "travel", "going", "headed")):
            answer = f"The person is {facts.get('direction', 'moving in an unconfirmed direction')}."
        elif any(word in q for word in ("describe", "description", "wearing", "clothing", "look like")):
            answer = f"The person appears to be {self._person.rstrip('.').lower()}."
        elif any(word in q for word in ("how many", "count", "number of")):
            answer = count_answer(*self._counts.get(self._camera, (0, 0)))
        elif any(word in q for word in ("name", "identity", "who is", "intent", "why")):
            answer = "I can't identify the person or their intent from this footage."
        else:
            if not q.rstrip().endswith("?") and not q.lstrip().startswith(
                (
                    "what", "where", "when", "who", "how", "is ", "are ",
                    "can ", "could ", "do ", "does ", "did ", "has ", "have ",
                    "please ", "tell me",
                )
            ):
                return ""
            answer = ""  # no model round-trip on the call: instant fallback below
            refusal = answer.strip().lower()
            if not answer or refusal.startswith(
                ("the cameras do not confirm", "i cannot confirm", "i can't confirm")
            ):
                answers = (
                    "I don't see that on the current camera.",
                    "That isn't visible in the current camera view.",
                )
                answer = answers[self._unknown_answer_index % len(answers)]
                self._unknown_answer_index += 1
            else:
                answer = re.split(r"(?<=[.!?])\s+", answer, maxsplit=1)[0]
        self._last_answer = answer
        await self.publish(
            CallTranscriptDelta(
                incident_id=incident_id,
                speaker="sentinel",
                text=answer,
                ts=utcnow(),
            )
        )
        return answer

    def update_visual(
        self, camera_id: str, visible: bool, people: int | None = None, armed: int = 0
    ) -> None:
        """Keep live answers aligned with the latest overlay without model work."""
        self._counts[camera_id] = (int(visible) if people is None else people, armed)
        if self._live and camera_id == self._camera:
            self._visible = visible

    async def notify_whereabouts(self, camera_id: str, address: str) -> None:
        """Vision escalated the chase on another camera — update the live call."""
        if not self.busy() or not self._incident_id:
            return
        if camera_id == self._camera:
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
        previous = self._camera
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
                text=scene.update_line(previous.upper(), camera_id.upper()),
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
