"""Shared frozen contracts for Campus Sentinel services."""

from .call_brief import CallBrief, call_brief_to_dict
from .events import (
    BBox,
    CallBriefEvent,
    CallTranscriptDelta,
    CameraOnline,
    DemoControl,
    EventType,
    HealthStrip,
    IncidentStateChange,
    IncidentUpsert,
    OverlayBoxes,
    SocketEvent,
    ToolCallLive,
    UsageTick,
    event_to_dict,
)
from .incident import (
    IncidentClass,
    IncidentRecord,
    IncidentState,
    Severity,
    TimelineEvent,
    incident_to_dict,
    utcnow,
)

__all__ = [
    "BBox",
    "CallBrief",
    "CallBriefEvent",
    "CallTranscriptDelta",
    "CameraOnline",
    "DemoControl",
    "EventType",
    "HealthStrip",
    "IncidentClass",
    "IncidentRecord",
    "IncidentState",
    "IncidentStateChange",
    "IncidentUpsert",
    "OverlayBoxes",
    "Severity",
    "SocketEvent",
    "UsageTick",
    "TimelineEvent",
    "ToolCallLive",
    "call_brief_to_dict",
    "event_to_dict",
    "incident_to_dict",
    "utcnow",
]
