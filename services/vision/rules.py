"""Temporal rules on rolling pose (playbook C.5).

Locked names: fall, run, sudden_acceleration, long_dwell.
Fight / theft are VadCLIP + VLM (six-class). There is no FIRE class.
"""

from __future__ import annotations

from .state import TrackMemory

FALL = "fall"
RUN = "run"
SUDDEN_ACCEL = "sudden_acceleration"
LONG_DWELL = "long_dwell"


def evaluate(
    mem: TrackMemory,
    *,
    fps: float = 15.0,
    forced: str | None = None,
) -> list[str]:
    if forced:
        return [forced]
    if len(mem.samples) < 6:
        return []
    s = list(mem.samples)
    fired: list[str] = []
    if _fall(s):
        fired.append(FALL)
    if _run(s, fps):
        fired.append(RUN)
    if _accel(s):
        fired.append(SUDDEN_ACCEL)
    if _dwell(s, fps):
        fired.append(LONG_DWELL)
    return fired


def _fall(s: list) -> bool:
    """Upright → fast descent → orientation flip → stays low."""
    angles = [p.torso_deg for p in s if p.torso_deg is not None]
    if len(angles) < 4:
        return False
    n = len(s)
    early = s[: max(2, n // 3)]
    late = s[-(max(2, n // 3)) :]
    early_up = any(p.torso_deg is not None and p.torso_deg < 35 for p in early)
    late_flat = any(p.torso_deg is not None and p.torso_deg > 55 for p in late)
    # image y-down: falling is +vy
    fast_down = max(p.vy for p in s) > 8.0
    stay_low = late[-1].cy > early[0].cy + 40
    return early_up and fast_down and late_flat and stay_low


def _run(s: list, fps: float) -> bool:
    speed = sum(abs(p.vx) for p in s) / len(s) * fps
    return speed > 180.0


def _accel(s: list) -> bool:
    dvs = [abs(s[i].vx - s[i - 1].vx) for i in range(1, len(s))]
    return max(dvs, default=0.0) > 14.0


def _dwell(s: list, fps: float) -> bool:
    if len(s) < fps * 1.5:
        return False
    dx = s[-1].cx - s[0].cx
    dy = s[-1].cy - s[0].cy
    return (dx * dx + dy * dy) ** 0.5 < 18.0
