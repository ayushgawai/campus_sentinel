"""WebSocket / dashboard event envelopes.

Frozen. type strings are the wire contract — do not rename without a group message.
Never put raw video frames or pixel buffers in these messages.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Literal, Union

from .incident import IncidentRecord, IncidentState, Severity, incident_to_dict, require_utc


def _opt_utc(name: str, dt: datetime | None) -> None:
    if dt is not None:
        require_utc(name, dt)


class EventType(str, Enum):
    INCIDENT_UPSERT = "incident.upsert"
    INCIDENT_STATE_CHANGE = "incident.state_change"
    OVERLAY_BOXES = "overlay.boxes"
    HEALTH_STRIP = "health.strip"
    CALL_TRANSCRIPT_DELTA = "call.transcript_delta"
    TOOL_CALL_LIVE = "tool.call_live"
    DEMO_CONTROL = "demo.control"
    CAMERA_ONLINE = "camera.online"
    CALL_BRIEF = "call.brief"  # additive 2026-09-25, approved by api owner


@dataclass(frozen=True)
class BBox:
    x: float
    y: float
    w: float
    h: float
    track_id: str
    label: str = ""
    score: float | None = None


@dataclass
class IncidentUpsert:
    type: Literal["incident.upsert"] = EventType.INCIDENT_UPSERT.value
    incident: IncidentRecord | None = None
    # When serializing without the full object, callers may set incident_dict instead.
    incident_dict: dict[str, Any] | None = None


@dataclass
class IncidentStateChange:
    type: Literal["incident.state_change"] = EventType.INCIDENT_STATE_CHANGE.value
    incident_id: str = ""
    state: IncidentState = IncidentState.NEW
    severity: Severity | None = None
    ts: datetime | None = None
    note: str = ""

    def __post_init__(self) -> None:
        _opt_utc("ts", self.ts)


@dataclass
class OverlayBoxes:
    """Server-drawn overlay metadata only — no pixels."""

    type: Literal["overlay.boxes"] = EventType.OVERLAY_BOXES.value
    camera_id: str = ""
    ts: datetime | None = None
    boxes: list[BBox] = field(default_factory=list)

    def __post_init__(self) -> None:
        _opt_utc("ts", self.ts)


@dataclass
class HealthStrip:
    type: Literal["health.strip"] = EventType.HEALTH_STRIP.value
    cameras_online: int = 0
    cameras_total: int = 0
    models_resident: bool = False
    gpu_util: float | None = None
    p95_ms: float | None = None
    frames_screened: int = 0
    frames_escalated: int = 0
    ts: datetime | None = None

    def __post_init__(self) -> None:
        _opt_utc("ts", self.ts)


@dataclass
class CallTranscriptDelta:
    type: Literal["call.transcript_delta"] = EventType.CALL_TRANSCRIPT_DELTA.value
    incident_id: str = ""
    speaker: Literal["dispatcher", "sentinel"] = "sentinel"
    text: str = ""
    ts: datetime | None = None

    def __post_init__(self) -> None:
        _opt_utc("ts", self.ts)


@dataclass
class ToolCallLive:
    type: Literal["tool.call_live"] = EventType.TOOL_CALL_LIVE.value
    incident_id: str = ""
    tool: str = ""  # lookup_location | get_suspect_status | get_elapsed_time | get_person_description | repeat_last
    args: dict[str, Any] = field(default_factory=dict)
    result: dict[str, Any] = field(default_factory=dict)
    ts: datetime | None = None

    def __post_init__(self) -> None:
        _opt_utc("ts", self.ts)


@dataclass
class DemoControl:
    type: Literal["demo.control"] = EventType.DEMO_CONTROL.value
    action: Literal["reset", "scenario", "prewarm"] = "reset"
    scenario_id: str | None = None
    ts: datetime | None = None

    def __post_init__(self) -> None:
        _opt_utc("ts", self.ts)


@dataclass
class CameraOnline:
    type: Literal["camera.online"] = EventType.CAMERA_ONLINE.value
    camera_id: str = ""
    online: bool = True
    ts: datetime | None = None

    def __post_init__(self) -> None:
        _opt_utc("ts", self.ts)


@dataclass
class CallBriefEvent:
    """Facts-only brief the call is working from, on dispatch and each camera handoff."""

    type: Literal["call.brief"] = EventType.CALL_BRIEF.value
    incident_id: str = ""
    reason: Literal["dispatch", "handoff"] = "dispatch"
    brief: dict[str, Any] = field(default_factory=dict)  # call_brief_to_dict() output
    ts: datetime | None = None

    def __post_init__(self) -> None:
        _opt_utc("ts", self.ts)


SocketEvent = Union[
    IncidentUpsert,
    IncidentStateChange,
    OverlayBoxes,
    HealthStrip,
    CallTranscriptDelta,
    ToolCallLive,
    DemoControl,
    CameraOnline,
    CallBriefEvent,
]


def event_to_dict(ev: SocketEvent) -> dict[str, Any]:
    from enum import Enum as _Enum

    def enc(v: Any) -> Any:
        if isinstance(v, _Enum):
            return v.value
        if isinstance(v, datetime):
            return v.isoformat()
        if isinstance(v, IncidentRecord):
            return incident_to_dict(v)
        if isinstance(v, BBox):
            return {
                "x": v.x,
                "y": v.y,
                "w": v.w,
                "h": v.h,
                "track_id": v.track_id,
                "label": v.label,
                "score": v.score,
            }
        if isinstance(v, list):
            return [enc(x) for x in v]
        if isinstance(v, dict):
            return {k: enc(val) for k, val in v.items()}
        return v

    out: dict[str, Any] = {}
    for k, v in ev.__dict__.items():
        if k == "incident_dict" and v is None:
            continue
        if k == "incident" and v is None:
            continue
        if k == "incident" and isinstance(ev, IncidentUpsert) and ev.incident_dict is not None:
            continue
        out[k] = enc(v)
    if isinstance(ev, IncidentUpsert):
        if ev.incident is not None:
            out["incident"] = incident_to_dict(ev.incident)
        elif ev.incident_dict is not None:
            out["incident"] = ev.incident_dict
    return out
