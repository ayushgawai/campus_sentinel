"""Call Brief — facts only for the voice agentic loop.

Lookups from IncidentRecord + camera_map + tracking state.
Never add summary / recommendation / assessment / inferred narrative fields.
On a call: if a fact is missing, the system says it cannot confirm it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .incident import require_utc


@dataclass
class CallBrief:
    incident_id: str
    camera_id: str
    address: str
    person_description: str
    incident_started_at: datetime
    brief_generated_at: datetime
    peak_ts: datetime
    building: str | None = None
    coordinates: tuple[float, float] | None = None  # (lat, lon) if known
    entrances: list[str] = field(default_factory=list)
    dispatched_ts: datetime | None = None
    map_lookup_refs: list[str] = field(default_factory=list)
    schema_version: str = "1.0"

    def __post_init__(self) -> None:
        for name in ("incident_started_at", "brief_generated_at", "peak_ts"):
            require_utc(name, getattr(self, name))
        if self.dispatched_ts is not None:
            require_utc("dispatched_ts", self.dispatched_ts)


def call_brief_to_dict(brief: CallBrief) -> dict[str, Any]:
    return {
        "schema_version": brief.schema_version,
        "incident_id": brief.incident_id,
        "camera_id": brief.camera_id,
        "address": brief.address,
        "building": brief.building,
        "coordinates": list(brief.coordinates) if brief.coordinates else None,
        "entrances": list(brief.entrances),
        "person_description": brief.person_description,
        "incident_started_at": brief.incident_started_at.isoformat(),
        "brief_generated_at": brief.brief_generated_at.isoformat(),
        "peak_ts": brief.peak_ts.isoformat(),
        "dispatched_ts": brief.dispatched_ts.isoformat() if brief.dispatched_ts else None,
        "map_lookup_refs": list(brief.map_lookup_refs),
    }
