"""OSNet re-id stub — affinity without loading weights (GPU-safe).

Real OSNet weights swap later (Pratham). Demo uses appearance hash of the crop
bbox so cross-cam tracks can soft-match without a re-id model.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass


@dataclass(frozen=True)
class AppearanceVec:
    track_id: str
    camera_id: str
    digest: str  # hex


def appearance_digest(
    camera_id: str,
    track_id: str,
    *,
    x: float,
    y: float,
    w: float,
    h: float,
) -> AppearanceVec:
    """Stable demo embedding from geometry + ids (not a real re-id model)."""
    raw = f"{camera_id}|{track_id}|{x:.2f}|{y:.2f}|{w:.2f}|{h:.2f}".encode()
    return AppearanceVec(
        track_id=track_id,
        camera_id=camera_id,
        digest=hashlib.sha1(raw).hexdigest()[:16],
    )


def affinity(a: AppearanceVec, b: AppearanceVec) -> float:
    """1.0 identical digest, else Hamming-ish score in [0,1)."""
    if a.digest == b.digest:
        return 1.0
    # shared prefix length / 16
    n = 0
    for x, y in zip(a.digest, b.digest):
        if x != y:
            break
        n += 1
    return n / 16.0


if __name__ == "__main__":
    a = appearance_digest("cam-01", "t1", x=0.1, y=0.2, w=0.3, h=0.4)
    b = appearance_digest("cam-01", "t1", x=0.1, y=0.2, w=0.3, h=0.4)
    c = appearance_digest("cam-02", "t9", x=0.9, y=0.9, w=0.1, h=0.1)
    assert affinity(a, b) == 1.0
    assert affinity(a, c) < 1.0
    print("osnet stub OK")
