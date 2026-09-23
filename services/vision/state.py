"""Rolling per-track state — last 1–2s of box, keypoints, torso, v_y (playbook C)."""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime

from .tracker import Track

# COCO-17
L_SHOULDER, R_SHOULDER = 5, 6
L_HIP, R_HIP = 11, 12


def _mid(
    kpts: list[tuple[float, float, float]], i: int, j: int
) -> tuple[float, float] | None:
    if len(kpts) <= max(i, j):
        return None
    (x1, y1, c1), (x2, y2, c2) = kpts[i], kpts[j]
    if c1 < 0.2 or c2 < 0.2:
        return None
    return ((x1 + x2) / 2, (y1 + y2) / 2)


def torso_angle_deg(kpts: list[tuple[float, float, float]]) -> float | None:
    """0 = upright (shoulders above hips), 90 = lying horizontal. Image y-down."""
    sh = _mid(kpts, L_SHOULDER, R_SHOULDER)
    hp = _mid(kpts, L_HIP, R_HIP)
    if sh is None or hp is None:
        return None
    dx, dy = sh[0] - hp[0], sh[1] - hp[1]
    # image up is -y
    return abs(math.degrees(math.atan2(dx, -dy)))


@dataclass(frozen=True)
class PoseSample:
    ts: datetime
    x: float
    y: float
    w: float
    h: float
    score: float
    vx: float
    vy: float
    torso_deg: float | None
    cx: float
    cy: float


def sample_from_track(ts: datetime, tr: Track) -> PoseSample:
    return PoseSample(
        ts=ts,
        x=tr.x,
        y=tr.y,
        w=tr.w,
        h=tr.h,
        score=tr.score,
        vx=tr.vx,
        vy=tr.vy,
        torso_deg=torso_angle_deg(tr.keypoints),
        cx=tr.x + tr.w / 2,
        cy=tr.y + tr.h / 2,
    )


@dataclass
class TrackMemory:
    """1–2 seconds of pose for one track_id."""

    window_s: float = 2.0
    samples: deque[PoseSample] = field(default_factory=deque)

    def push(self, sample: PoseSample) -> None:
        self.samples.append(sample)
        cutoff = sample.ts.timestamp() - self.window_s
        while self.samples and self.samples[0].ts.timestamp() < cutoff:
            self.samples.popleft()
