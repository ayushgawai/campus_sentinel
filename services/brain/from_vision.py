"""Map vision Escalation → brain EscalateRequest (Ayush glue).

Vision owns Escalation; brain owns adjudicate. Keep the field map in one place.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from contracts import IncidentClass

from .adjudicate import EscalateRequest

# Vision Seville JSON uses CAM-01; web/api use cam-01.
_CAM_ALIASES = {
    "CAM-01": "cam-01",
    "CAM-02": "cam-02",
    "CAM-03": "cam-03",
}


def normalize_camera_id(camera_id: str) -> str:
    return _CAM_ALIASES.get(camera_id, camera_id)


def class_hint_from_rules(rules: list[str]) -> IncidentClass | None:
    """Best-effort forced class for demo when VLM is offline."""
    lowered = [r.lower() for r in rules]
    joined = " ".join(lowered)
    # Demo primary: armed Seville chase → WEAPON (replaces former FALL path).
    if any(k in joined for k in ("weapon", "gun", "armed", "firearm", "fall", "person-down")):
        return IncidentClass.WEAPON
    if "fight" in joined:
        return IncidentClass.FIGHT
    if "theft" in joined:
        return IncidentClass.THEFT
    if "run" in joined or "sudden_acceleration" in joined or "dwell" in joined:
        return IncidentClass.RUN
    if "medical" in joined:
        return IncidentClass.MEDICAL
    return None


def escalate_request_from_vision(
    esc: Any,
    *,
    allow_placeholder_thresholds: bool = True,
    class_token_forced: IncidentClass | None = None,
    clip_uri: str = "",
    person_description: str = "",
    location_text: str = "",
    frames: list | None = None,
) -> EscalateRequest:
    """Accept a vision Escalation dataclass (or duck-typed object)."""
    camera_id = normalize_camera_id(str(esc.camera_id))
    rules = list(getattr(esc, "rules", []) or [])
    peak_ts = getattr(esc, "ts", None)
    if peak_ts is not None and not isinstance(peak_ts, datetime):
        raise TypeError("esc.ts must be datetime or None")
    imgs = list(frames or getattr(esc, "frames", None) or [])
    # Live VLM must not see the router's verdict. Hint only when no frames.
    forced = class_token_forced
    if not imgs:
        forced = forced or class_hint_from_rules(rules)
    return EscalateRequest(
        track_id=str(esc.track_id),
        camera_id=camera_id,
        router_score=float(esc.fused),
        rules_fired=rules,
        peak_ts=peak_ts,
        clip_uri=clip_uri,
        person_description=person_description,
        location_text=location_text or camera_id,
        class_token_forced=forced,
        frames=imgs,
        allow_placeholder_thresholds=allow_placeholder_thresholds,
    )
