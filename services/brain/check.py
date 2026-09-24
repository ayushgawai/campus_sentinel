"""Self-check for brain skeleton — runs with ZRT down (forced mode)."""

from __future__ import annotations

import sys
from pathlib import Path

# repo root on path
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from contracts import IncidentClass, IncidentState, Severity  # noqa: E402
from services.brain.adjudicate import EscalateRequest, adjudicate  # noqa: E402
from services.brain.audit import AuditLog  # noqa: E402
from services.brain.call_brief import assemble_call_brief
from services.brain.from_vision import (  # noqa: E402
    escalate_request_from_vision,
    normalize_camera_id,
)
from services.brain.fuse import fuse_probs, logprob_to_prob  # noqa: E402
from services.brain.sampler import sample_indices  # noqa: E402
from services.brain.state_machine import StateMachine  # noqa: E402
from services.brain.thresholds import severity_from_fused  # noqa: E402
from services.brain.zrt_client import ZRTClient  # noqa: E402


def main() -> None:
    # sampler: peak in the middle of 48 frames → 16 clustered near center
    idxs = sample_indices(48, peak_index=24, k=16)
    assert len(idxs) == 16 and idxs == sorted(idxs)
    assert min(idxs) >= 0 and max(idxs) < 48
    # denser near peak than at the edges (not a flat contiguous crop)
    near = sum(1 for i in idxs if abs(i - 24) <= 6)
    far = sum(1 for i in idxs if abs(i - 24) >= 18)
    assert near > far, (idxs, near, far)
    assert min(idxs) < 12 and max(idxs) > 36, "should still span the window"

    # forced ZRT — no network
    zrt = ZRTClient(forced=True)
    assert zrt.health() is True
    r = zrt.classify(
        class_token_forced=IncidentClass.WEAPON,
        track_id="t1",
        camera_id="cam-1",
        peak_ts_iso="2026-09-23T00:00:00+00:00",
    )
    assert r.forced and r.class_token is IncidentClass.WEAPON
    try:
        ZRTClient(forced=False).classify(
            track_id="t1",
            camera_id="cam-1",
            peak_ts_iso="2026-09-23T00:00:00+00:00",
        )
        raise AssertionError("live classify must raise until frames are wired")
    except NotImplementedError:
        pass

    # state machine + idempotency
    sm = StateMachine("inc-1")
    sm.transition(IncidentState.ALERTED, action="alert")
    sm.transition(IncidentState.ALERTED, action="alert")  # retry
    assert sm.state is IncidentState.ALERTED
    sm.transition(IncidentState.DISPATCH_PENDING, action="arm_dispatch")
    sm.transition(IncidentState.DISPATCHED, action="dispatch")
    sm.transition(IncidentState.TRACKING, action="start_track")
    sm.transition(IncidentState.RESOLVED, action="resolve")
    assert sm.state is IncidentState.RESOLVED
    sm2 = StateMachine("inc-2")
    sm2.transition(IncidentState.ALERTED, action="alert")
    sm2.transition(IncidentState.RESOLVED, action="resolve_minor")  # minor close
    try:
        StateMachine("inc-3").transition(IncidentState.TRACKING, action="bad")
        raise AssertionError("invalid transition should raise")
    except ValueError:
        pass

    assert severity_from_fused(0.1, allow_placeholder=True) is Severity.NONE
    assert severity_from_fused(0.6, allow_placeholder=True) is Severity.MINOR
    assert severity_from_fused(0.9, allow_placeholder=True) is Severity.SEVERE
    try:
        severity_from_fused(0.9)
        raise AssertionError("placeholder thresholds must not be silent")
    except RuntimeError:
        pass

    # fuse: weighted router + VLM; logprob 0 → exp(0) = 1.0
    assert abs(logprob_to_prob(0.0) - 1.0) < 1e-9
    assert abs(fuse_probs(0.5, 0.5) - 0.5) < 1e-9
    assert fuse_probs(0.0, 1.0) == 0.60  # default w_vlm
    assert fuse_probs(1.0, 0.0) == 0.40  # default w_router
    try:
        fuse_probs(-0.1, 0.5)
        raise AssertionError("out-of-range router must raise")
    except ValueError:
        pass
    try:
        fuse_probs(0.5, 1.5)
        raise AssertionError("out-of-range vlm must raise")
    except ValueError:
        pass

    # adjudicate + audit (forced ZRT → ALERTED for WEAPON)
    audit = AuditLog()
    req = EscalateRequest(
        track_id="t-esc-1",
        camera_id="cam-lobby",
        router_score=0.85,
        rules_fired=["fall_velocity"],
        class_token_forced=IncidentClass.WEAPON,
        allow_placeholder_thresholds=True,
    )
    result = adjudicate(req, zrt=ZRTClient(forced=True), audit=audit)
    assert result.record.class_token is IncidentClass.WEAPON
    assert result.record.camera_id == "cam-lobby"
    assert result.record.state is IncidentState.ALERTED
    assert result.record.severity is Severity.SEVERE
    assert result.record.clip_uri == ""  # no fabricated path
    assert abs(result.record.class_logprob_calibrated - 0.0) < 1e-9  # log(1.0)
    assert result.fused_prob > 0.8
    entries = audit.entries()
    assert len(entries) >= 2
    assert any(e.action == "adjudicate" for e in entries)
    assert any(e.action.startswith("state:") for e in entries)
    # same track again → new incident id (no silent reuse)
    result2 = adjudicate(req, zrt=ZRTClient(forced=True), audit=audit)
    assert result2.record.incident_id != result.record.incident_id
    # low router + BENIGN forced → DISMISSED; logprob matches fuse vlm_prob
    low = adjudicate(
        EscalateRequest(
            track_id="t-benign",
            camera_id="cam-lobby",
            router_score=0.05,
            class_token_forced=IncidentClass.BENIGN,
            allow_placeholder_thresholds=True,
        ),
        zrt=ZRTClient(forced=True),
    )
    assert low.record.state is IncidentState.DISMISSED
    assert low.record.severity is Severity.NONE
    assert abs(low.vlm_prob - 0.05) < 1e-9
    assert abs(logprob_to_prob(low.record.class_logprob_calibrated) - 0.05) < 1e-9
    # placeholder thresholds refused by default
    try:
        adjudicate(
            EscalateRequest(
                track_id="t-guard",
                camera_id="cam-lobby",
                router_score=0.9,
                class_token_forced=IncidentClass.WEAPON,
            ),
            zrt=ZRTClient(forced=True),
        )
        raise AssertionError("placeholder thresholds must require explicit ack")
    except RuntimeError:
        pass

    # vision Escalation → EscalateRequest (duck-typed; no vision import)
    assert normalize_camera_id("CAM-01") == "cam-01"
    from dataclasses import dataclass
    from datetime import datetime, timezone

    @dataclass
    class _Esc:
        camera_id: str
        track_id: str
        ts: datetime
        fused: float
        rules: list[str]
        vadclip: float = 0.0

    mapped = escalate_request_from_vision(
        _Esc(
            camera_id="CAM-01",
            track_id="t-9",
            ts=datetime(2026, 9, 24, tzinfo=timezone.utc),
            fused=0.91,
            rules=["weapon", "sudden_acceleration"],
        )
    )
    assert mapped.camera_id == "cam-01"
    assert mapped.router_score == 0.91
    assert mapped.class_token_forced is IncidentClass.WEAPON
    via = adjudicate(mapped, zrt=ZRTClient(forced=True))
    assert via.record.camera_id == "cam-01"
    assert via.record.class_token is IncidentClass.WEAPON

    brief = assemble_call_brief(via.record)
    assert brief.incident_id == via.record.incident_id
    assert brief.camera_id == "cam-01"

    print("brain self-check OK")


if __name__ == "__main__":
    main()
