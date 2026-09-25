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


def load_camera_map(path: Path | None = None) -> dict[str, Any]:
    p = path or _DEFAULT_MAP
    if not p.is_file():
        return {}
    try:
        return json.loads(p.read_text())
    except json.JSONDecodeError:
        return {}


def _norm_cam(cid: str) -> str:
    s = str(cid).strip().lower().replace("_", "-")
    if s.startswith("cam") and not s.startswith("cam-"):
        # cam01 → cam-01
        digits = "".join(ch for ch in s if ch.isdigit())
        if digits:
            return f"cam-{int(digits):02d}"
    return s


def site_config(camera_map: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return canonical site facts used by both the API and voice agent."""
    cmap = camera_map if camera_map is not None else load_camera_map()
    site = cmap.get("site")
    return dict(site) if isinstance(site, dict) else {}


def scene_facts(
    camera_id: str, camera_map: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Return only the current camera's pre-described demo facts."""
    cmap = camera_map if camera_map is not None else load_camera_map()
    want = _norm_cam(camera_id)
    for camera in cmap.get("cameras") or []:
        if isinstance(camera, dict) and want in {
            _norm_cam(str(camera.get("camera_id") or "")),
            _norm_cam(str(camera.get("legacy_id") or "")),
        }:
            facts = camera.get("scene_facts")
            return dict(facts) if isinstance(facts, dict) else {}
    return {}


def assemble_call_brief(
    rec: IncidentRecord,
    *,
    camera_map: dict[str, Any] | None = None,
    map_path: Path | None = None,
) -> CallBrief:
    cmap = camera_map if camera_map is not None else load_camera_map(map_path)
    cams = cmap.get("cameras") if isinstance(cmap.get("cameras"), list) else None
    entry: dict[str, Any] = {}
    want = _norm_cam(rec.camera_id)
    if isinstance(cams, list):
        for c in cams:
            if not isinstance(c, dict):
                continue
            ids = {_norm_cam(str(c.get("camera_id") or ""))}
            if c.get("legacy_id"):
                ids.add(_norm_cam(str(c["legacy_id"])))
            if want in ids:
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
    # Fold map-only logistics into spoken address facts (no contract change).
    extras: list[str] = []
    if entry.get("floor"):
        extras.append(f"floor {entry['floor']}")
    if entry.get("cross_streets"):
        extras.append("near " + " / ".join(entry["cross_streets"]))
    if entry.get("vehicle_access"):
        extras.append(str(entry["vehicle_access"]))
    if extras:
        address = f"{address} ({'; '.join(extras)})"
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


def unknowns_for_voice() -> list[str]:
    """Facts the system must refuse to invent (spoken, not a contract field)."""
    return ["breathing", "pulse", "name", "intent", "injuries"]
