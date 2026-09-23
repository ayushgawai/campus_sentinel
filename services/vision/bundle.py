"""16-frame adjudication bundle from the 8s ring (playbook D).

Sampling is Ayush's brain.sampler — peak-weighted, not uniform.
Prefill facts only: track_id, camera_id, peak timestamp, target person.
Never router_score / fused_prob.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from contracts.incident import require_utc
from services.brain.sampler import sample_from_timestamps

from .ring import RingBuffer


@dataclass(frozen=True)
class FrameBundle:
    camera_id: str
    track_id: str
    peak_ts: datetime
    person_hint: str
    timestamps: list[float]
    images: list[object]
    indices: list[int]

    def to_classify_kwargs(self) -> dict:
        """Matches services.brain.zrt_client.ZRTClient.classify keyword args."""
        return {
            "track_id": self.track_id,
            "camera_id": self.camera_id,
            "peak_ts_iso": self.peak_ts.isoformat(),
            "person_hint": self.person_hint,
            "frames": list(self.images),
        }

    def fact_text(self) -> str:
        """Prefill text — facts only, no scores or verdicts."""
        hint = self.person_hint or "unspecified"
        return (
            f"camera_id={self.camera_id} track_id={self.track_id} "
            f"peak_ts={self.peak_ts.isoformat()} target_person={hint} "
            f"n_frames={len(self.images)}"
        )


def build_bundle(
    ring: RingBuffer,
    camera_id: str,
    *,
    peak_ts: datetime | None = None,
    track_id: str = "",
    person_hint: str = "",
    k: int = 16,
) -> FrameBundle:
    items = ring.window(camera_id)
    if not items:
        raise ValueError(f"ring empty for camera_id={camera_id!r}")
    if peak_ts is None:
        peak_ts = items[-1].ts
    require_utc("peak_ts", peak_ts)
    stamps = [item.ts.timestamp() for item in items]
    idxs = sample_from_timestamps(stamps, peak_ts.timestamp(), k=k)
    return FrameBundle(
        camera_id=camera_id,
        track_id=track_id,
        peak_ts=peak_ts,
        person_hint=person_hint,
        timestamps=[stamps[i] for i in idxs],
        images=[items[i].image for i in idxs],
        indices=idxs,
    )
