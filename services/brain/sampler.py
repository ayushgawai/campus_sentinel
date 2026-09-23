"""Event-aware frame sampling for adjudication.

Playbook D: 16 frames from the 8-second window, weighted toward the
router's peak timestamp rather than spread evenly.
"""

from __future__ import annotations

import math


def peak_index_from_timestamps(
    timestamps: list[float],
    peak_ts: float,
) -> int:
    """Return index of the frame timestamp closest to peak_ts."""
    if not timestamps:
        raise ValueError("timestamps must be non-empty")
    return min(range(len(timestamps)), key=lambda i: abs(timestamps[i] - peak_ts))


def sample_indices(
    n_frames: int,
    peak_index: int,
    k: int = 16,
) -> list[int]:
    """Pick k frame indices with density peaked at peak_index (deterministic).

    Inverse-CDF sampling over a Gaussian weight around the peak so the
    8s window is still covered, but more samples land near the peak than
    a uniform or contiguous center crop would.
    """
    if n_frames < 0:
        raise ValueError("n_frames must be >= 0")
    if n_frames == 0:
        return []
    if k <= 0:
        raise ValueError("k must be > 0")
    if not (0 <= peak_index < n_frames):
        raise ValueError("peak_index out of range")
    if n_frames <= k:
        return list(range(n_frames))

    sigma = max(n_frames / 5.0, 1.0)
    weights = [
        math.exp(-0.5 * ((i - peak_index) / sigma) ** 2) for i in range(n_frames)
    ]
    total = sum(weights)
    cdf: list[float] = []
    acc = 0.0
    for w in weights:
        acc += w / total
        cdf.append(acc)
    cdf[-1] = 1.0

    chosen: set[int] = set()
    for j in range(k):
        q = (j + 0.5) / k
        idx = next(i for i, c in enumerate(cdf) if c >= q)
        chosen.add(idx)

    # Dedup fill: take highest remaining weight (near peak first).
    if len(chosen) < k:
        rest = sorted(
            (i for i in range(n_frames) if i not in chosen),
            key=lambda i: (-weights[i], abs(i - peak_index), i),
        )
        for i in rest:
            chosen.add(i)
            if len(chosen) >= k:
                break

    return sorted(chosen)


def sample_from_timestamps(
    timestamps: list[float],
    peak_ts: float,
    k: int = 16,
) -> list[int]:
    peak = peak_index_from_timestamps(timestamps, peak_ts)
    return sample_indices(len(timestamps), peak, k=k)
