"""Self-check for brain skeleton — runs with ZRT down (forced mode)."""

from __future__ import annotations

import sys
from pathlib import Path

# repo root on path
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from contracts import IncidentClass, IncidentState, Severity  # noqa: E402
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
        class_token_forced=IncidentClass.FALL,
        track_id="t1",
        camera_id="cam-1",
        peak_ts_iso="2026-09-23T00:00:00+00:00",
    )
    assert r.forced and r.class_token is IncidentClass.FALL
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

    print("brain self-check OK")


if __name__ == "__main__":
    main()
