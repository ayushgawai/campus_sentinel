"""Lookups only — never generation (playbook §04-E)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

ToolName = str  # lookup_location | get_suspect_status | get_elapsed_time | get_person_description | repeat_last

Handler = Callable[[dict[str, Any]], tuple[dict[str, Any], dict[str, Any]]]


def _lookup_location(ctx: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    brief = ctx["brief"]
    args = {"camera_id": brief.camera_id}
    result = {
        "address": brief.address,
        "building": brief.building,
        "entrances": list(brief.entrances),
        "spoken": f"Location on file: {brief.address}.",
    }
    return args, result


def _get_person_description(ctx: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    brief = ctx["brief"]
    args = {"incident_id": brief.incident_id}
    desc = brief.person_description or "unknown"
    result = {
        "person_description": desc,
        "spoken": f"Description from camera: {desc}.",
    }
    return args, result


def _get_elapsed_time(ctx: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    brief = ctx["brief"]
    now = datetime.now(timezone.utc)
    started = brief.incident_started_at
    secs = max(0, int((now - started).total_seconds()))
    args = {"incident_id": brief.incident_id}
    result = {
        "elapsed_s": secs,
        "spoken": f"Elapsed since first detection approximately {secs} seconds.",
    }
    return args, result


def _get_suspect_status(ctx: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    rec = ctx["record"]
    args = {"incident_id": rec.incident_id}
    result = {
        "state": rec.state.value,
        "class_token": rec.class_token.value,
        "spoken": (
            f"Current system state {rec.state.value}, class {rec.class_token.value}. "
            "I cannot confirm intent or injuries."
        ),
    }
    return args, result


def _repeat_last(ctx: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    brief = ctx["brief"]
    args = {}
    result = {
        "spoken": (
            f"Repeating: camera {brief.camera_id}, {brief.address}, "
            f"{brief.person_description}."
        ),
    }
    return args, result


TOOL_HANDLERS: dict[str, Handler] = {
    "lookup_location": _lookup_location,
    "get_person_description": _get_person_description,
    "get_elapsed_time": _get_elapsed_time,
    "get_suspect_status": _get_suspect_status,
    "repeat_last": _repeat_last,
}
