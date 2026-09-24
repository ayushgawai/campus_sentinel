"""Assemble CallBrief from IncidentRecord (+ optional camera_map).

Facts only — no narrative/recommendation fields (contracts/call_brief.py).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from contracts import CallBrief, IncidentRecord, utcnow

_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_MAP = _ROOT / "data" / "camera_map.json"


def _load_camera_map(path: Path | None = None) -> dict[str, Any]:
    p = path or _DEFAULT_MAP
    if not p.is_file():
        return {}
    try:
        return json.loads(p.read_text())
    except json.JSONDecodeError:
        return {}


def assemble_call_brief(
    rec: IncidentRecord,
    *,
    camera_map: dict[str, Any] | None = None,
    map_path: Path | None = None,
) -> CallBrief:
    cmap = camera_map if camera_map is not None else _load_camera_map(map_path)
    cams = cmap.get("cameras") if isinstance(cmap.get("cameras"), list) else None
    entry: dict[str, Any] = {}
    if isinstance(cams, list):
        for c in cams:
            if isinstance(c, dict) and c.get("camera_id") == rec.camera_id:
                entry = c
                break
    elif isinstance(cmap, dict) and rec.camera_id in cmap:
        maybe = cmap[rec.camera_id]
        if isinstance(maybe, dict):
            entry = maybe

    address = (
        entry.get("address")
        or entry.get("location")
        or rec.location_text
        or rec.camera_id
    )
    building = entry.get("building") or entry.get("name")
    coords = entry.get("coordinates")
    coord_t: tuple[float, float] | None = None
    if isinstance(coords, (list, tuple)) and len(coords) == 2:
        coord_t = (float(coords[0]), float(coords[1]))
    entrances = list(entry.get("entrances") or [])

    return CallBrief(
        incident_id=rec.incident_id,
        camera_id=rec.camera_id,
        address=str(address),
        person_description=rec.person_description or "unknown",
        incident_started_at=rec.created_at,
        brief_generated_at=utcnow(),
        peak_ts=rec.peak_ts,
        building=str(building) if building else None,
        coordinates=coord_t,
        entrances=entrances,
        dispatched_ts=None,
        map_lookup_refs=[str(_DEFAULT_MAP.name)] if _DEFAULT_MAP.is_file() else [],
    )
