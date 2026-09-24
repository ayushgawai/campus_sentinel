"""Escalate → IncidentRecord (playbook D+E entry).

Forced/demo path works offline. Live classify posts the 16-frame bundle to ZRT.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass, field
from datetime import datetime

from contracts import (
    IncidentClass,
    IncidentRecord,
    IncidentState,
    Severity,
    TimelineEvent,
    utcnow,
)
from contracts.incident import require_utc

from .audit import AuditLog
from .fuse import fuse_probs, logprob_to_prob
from .state_machine import StateMachine
from .thresholds import severity_from_fused
from .zrt_client import ZRTClient


@dataclass
class EscalateRequest:
    track_id: str
    camera_id: str
    router_score: float
    rules_fired: list[str] = field(default_factory=list)
    peak_ts: datetime | None = None  # vision peak; wall-clock only as last resort
    clip_uri: str = ""
    person_description: str = ""
    location_text: str = ""
    description: str = ""
    class_token_forced: IncidentClass | None = None
    # 16 sampled frames for live classify. Empty → forced/demo only.
    frames: list = field(default_factory=list)
    # Must be True for demos/tests until Naman's bench thresholds land.
    allow_placeholder_thresholds: bool = False


@dataclass
class EscalateResult:
    record: IncidentRecord
    machine: StateMachine
    vlm_prob: float
    fused_prob: float


def adjudicate(
    req: EscalateRequest,
    *,
    zrt: ZRTClient | None = None,
    audit: AuditLog | None = None,
    incident_id: str | None = None,
) -> EscalateResult:
    """Build an IncidentRecord from a router escalation.

    Uses forced ZRT classify when the client is in forced mode or
    class_token_forced is set. Never puts router scores into the VLM call.
    """
    zrt = zrt or ZRTClient(forced=True)
    audit = audit or AuditLog()
    now = utcnow()
    iid = incident_id or f"inc-{uuid.uuid4().hex[:10]}"
    peak = req.peak_ts or now
    require_utc("peak_ts", peak)

    classify = zrt.classify(
        class_token_forced=req.class_token_forced,
        track_id=req.track_id,
        camera_id=req.camera_id,
        peak_ts_iso=peak.isoformat(),
        person_hint=req.person_description,
        frames=list(req.frames) or None,
    )
    vlm_prob = logprob_to_prob(classify.logprob)
    calibrated_logprob = classify.logprob
    if classify.forced:
        # Forced path: demo confidence, keep record logprob consistent with fuse.
        vlm_prob = 1.0 if classify.class_token is not IncidentClass.BENIGN else 0.05
        calibrated_logprob = math.log(vlm_prob)

    fused = fuse_probs(req.router_score, vlm_prob)
    severity = severity_from_fused(
        fused, allow_placeholder=req.allow_placeholder_thresholds
    )

    description = req.description
    if not description:
        description = (
            f"{classify.class_token.value.lower()} on {req.camera_id}"
            if classify.class_token is not IncidentClass.BENIGN
            else "no actionable event"
        )

    machine = StateMachine(iid)
    if severity is Severity.NONE:
        machine.transition(IncidentState.DISMISSED, action="dismiss_none")
        dismissed_reason = "fused_prob below minor threshold"
        state = IncidentState.DISMISSED
    else:
        machine.transition(IncidentState.ALERTED, action="alert")
        dismissed_reason = None
        state = IncidentState.ALERTED

    record = IncidentRecord(
        incident_id=iid,
        track_id=req.track_id,
        camera_id=req.camera_id,
        peak_ts=peak,
        class_token=classify.class_token,
        class_logprob_calibrated=calibrated_logprob,
        router_score=req.router_score,
        fused_prob=fused,
        severity=severity,
        description=description,
        location_text=req.location_text or req.camera_id,
        person_description=req.person_description or "unknown",
        state=state,
        clip_uri=req.clip_uri,  # empty until vision supplies a real URI
        created_at=now,
        updated_at=now,
        rules_fired=list(req.rules_fired),
        timeline=[
            TimelineEvent(ts=now, state=IncidentState.NEW, note="created"),
            TimelineEvent(ts=now, state=state, note=machine.state.value),
        ],
        dismissed_reason=dismissed_reason,
    )

    audit.record(
        incident_id=iid,
        action="adjudicate",
        reason=f"class={classify.class_token.value} severity={severity.value}",
        confidence=fused,
        detail={
            "router_score": req.router_score,
            "vlm_prob": vlm_prob,
            "forced": classify.forced,
            "rules_fired": list(req.rules_fired),
        },
        ts=now,
    )
    audit.record(
        incident_id=iid,
        action=f"state:{state.value}",
        reason=dismissed_reason or "alert campus security",
        confidence=fused,
        ts=now,
    )

    return EscalateResult(
        record=record, machine=machine, vlm_prob=vlm_prob, fused_prob=fused
    )
