"""IncidentRecord — shared across vision → brain → api → web.

Frozen schema. Do not add or rename fields without a group message.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def require_utc(name: str, dt: datetime) -> None:
    if dt.tzinfo is None or dt.utcoffset() != timedelta(0):
        raise ValueError(f"{name} must be timezone-aware UTC")


class IncidentState(str, Enum):
    NEW = "NEW"
    ALERTED = "ALERTED"
    DISPATCH_PENDING = "DISPATCH_PENDING"
    DISPATCHED = "DISPATCHED"
    TRACKING = "TRACKING"
    RESOLVED = "RESOLVED"
    DISMISSED = "DISMISSED"


class IncidentClass(str, Enum):
    """VLM Completion A — single token from this six-class set.

    2026-09-24 group decision: FALL replaced by WEAPON — Seville armed-chase
    is the demo primary. Pose rule name "fall" may still fire internally;
    the wire class token is WEAPON.
    """

    WEAPON = "WEAPON"
    FIGHT = "FIGHT"
    THEFT = "THEFT"
    RUN = "RUN"
    MEDICAL = "MEDICAL"
    BENIGN = "BENIGN"


class Severity(str, Enum):
    """Three threshold outcomes in ACT (plain code, not the model)."""

    NONE = "NONE"  # dismiss / no escalation
    MINOR = "MINOR"  # message campus security
    SEVERE = "SEVERE"  # dispatch path + broadcast to security


@dataclass(frozen=True)
class TimelineEvent:
    ts: datetime
    state: IncidentState
    note: str = ""

    def __post_init__(self) -> None:
        require_utc("ts", self.ts)


@dataclass
class IncidentRecord:
    incident_id: str
    track_id: str
    camera_id: str
    peak_ts: datetime
    class_token: IncidentClass
    class_logprob_calibrated: float
    router_score: float
    fused_prob: float
    severity: Severity
    description: str
    location_text: str
    person_description: str
    state: IncidentState
    clip_uri: str  # file:// or http(s); never raw pixel payloads
    created_at: datetime
    updated_at: datetime
    rules_fired: list[str] = field(default_factory=list)
    timeline: list[TimelineEvent] = field(default_factory=list)
    dismissed_reason: str | None = None
    schema_version: str = "1.1"

    def __post_init__(self) -> None:
        for name in ("peak_ts", "created_at", "updated_at"):
            require_utc(name, getattr(self, name))
        for ev in self.timeline:
            require_utc("timeline.ts", ev.ts)


def incident_to_dict(rec: IncidentRecord) -> dict[str, Any]:
    """JSON-friendly dict (enums → values, datetimes → ISO-8601)."""

    def enc(v: Any) -> Any:
        if isinstance(v, Enum):
            return v.value
        if isinstance(v, datetime):
            return v.isoformat()
        if isinstance(v, TimelineEvent):
            return {"ts": enc(v.ts), "state": enc(v.state), "note": v.note}
        if isinstance(v, list):
            return [enc(x) for x in v]
        return v

    return {
        "schema_version": rec.schema_version,
        "incident_id": rec.incident_id,
        "track_id": rec.track_id,
        "camera_id": rec.camera_id,
        "peak_ts": enc(rec.peak_ts),
        "class_token": enc(rec.class_token),
        "class_logprob_calibrated": rec.class_logprob_calibrated,
        "router_score": rec.router_score,
        "fused_prob": rec.fused_prob,
        "severity": enc(rec.severity),
        "description": rec.description,
        "location_text": rec.location_text,
        "person_description": rec.person_description,
        "rules_fired": list(rec.rules_fired),
        "clip_uri": rec.clip_uri,
        "created_at": enc(rec.created_at),
        "updated_at": enc(rec.updated_at),
        "state": enc(rec.state),
        "timeline": enc(rec.timeline),
        "dismissed_reason": rec.dismissed_reason,
    }
