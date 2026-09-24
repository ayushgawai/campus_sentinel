"""Voice service — forced/demo agentic call loop (Pratham path, filled for demo).

Real Parakeet ASR / Kokoro TTS swap in later. Wire events match contracts/events.py.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Awaitable, Callable, Any

from contracts import (
    CallBrief,
    CallTranscriptDelta,
    IncidentRecord,
    ToolCallLive,
    call_brief_to_dict,
    utcnow,
)

from .tools import TOOL_HANDLERS, ToolName

PublishFn = Callable[[Any], Awaitable[None]]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class CallScriptStep:
    after_s: float
    speaker: str  # dispatcher | sentinel
    text: str = ""
    tool: ToolName | None = None


# Deterministic WEAPON demo exchange — Sentinel states simulated + refuses unverifiable facts.
WEAPON_SCRIPT: list[CallScriptStep] = [
    CallScriptStep(0.4, "sentinel", "This is Campus Sentinel on a simulated call with campus security."),
    CallScriptStep(1.2, "dispatcher", "What are you reporting?"),
    CallScriptStep(
        2.0,
        "sentinel",
        "Armed individual with a visible firearm on camera {camera}. Location: {address}.",
    ),
    CallScriptStep(3.2, "dispatcher", "Is the person conscious? Any injuries?"),
    CallScriptStep(
        4.0,
        "sentinel",
        "I cannot confirm consciousness or injury. I can only report what the camera shows.",
    ),
    CallScriptStep(5.0, "dispatcher", "Description and how long?"),
    CallScriptStep(5.6, "sentinel", tool="get_person_description"),
    CallScriptStep(6.4, "sentinel", tool="get_elapsed_time"),
    CallScriptStep(7.2, "sentinel", tool="lookup_location"),
    CallScriptStep(8.2, "dispatcher", "Copy. Units notified. Stay on the line."),
    CallScriptStep(
        9.0,
        "sentinel",
        "Acknowledged. Tracking continues on camera {camera}. This call remains simulated.",
    ),
]


class VoiceAgent:
    """Plays a scripted call; tools are lookups against CallBrief + IncidentRecord."""

    def __init__(self, publish: PublishFn) -> None:
        self.publish = publish
        self._task: asyncio.Task[None] | None = None

    def busy(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start_call(
        self,
        rec: IncidentRecord,
        brief: CallBrief,
        *,
        script: list[CallScriptStep] | None = None,
    ) -> None:
        if self.busy():
            return
        self._task = asyncio.create_task(
            self._run(rec, brief, script or WEAPON_SCRIPT), name=f"call-{rec.incident_id}"
        )

    async def cancel(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None

    async def _run(
        self,
        rec: IncidentRecord,
        brief: CallBrief,
        script: list[CallScriptStep],
    ) -> None:
        ctx = {
            "camera": rec.camera_id,
            "address": brief.address,
            "person": brief.person_description,
            "brief": brief,
            "record": rec,
            "brief_dict": call_brief_to_dict(brief),
        }
        try:
            for step in script:
                await asyncio.sleep(step.after_s)
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
                    # Spoken result line
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
                text = step.text.format(**{k: ctx[k] for k in ("camera", "address", "person")})
                await self.publish(
                    CallTranscriptDelta(
                        incident_id=rec.incident_id,
                        speaker=step.speaker,  # type: ignore[arg-type]
                        text=text,
                        ts=now,
                    )
                )
        except asyncio.CancelledError:
            raise
