"""Per-camera ring buffer — last 8 seconds of frames (playbook C / D)."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta

from contracts.incident import require_utc

from .decode import Frame


@dataclass(frozen=True)
class RingItem:
    ts: datetime
    image: object
    person_xywh: tuple[float, float, float, float]


class RingBuffer:
    """Keep the last `window_s` seconds per camera. Evict by timestamp."""

    def __init__(self, window_s: float = 8.0) -> None:
        if window_s <= 0:
            raise ValueError("window_s must be > 0")
        self.window_s = window_s
        self._buf: dict[str, deque[RingItem]] = {}

    def push(self, frame: Frame) -> None:
        require_utc("frame.ts", frame.ts)
        q = self._buf.setdefault(frame.camera_id, deque())
        q.append(
            RingItem(
                ts=frame.ts,
                image=frame.image,
                person_xywh=frame.person_xywh,
            )
        )
        cutoff = frame.ts - timedelta(seconds=self.window_s)
        while q and q[0].ts < cutoff:
            q.popleft()

    def window(self, camera_id: str) -> list[RingItem]:
        return list(self._buf.get(camera_id, ()))

    def timestamps(self, camera_id: str) -> list[float]:
        return [item.ts.timestamp() for item in self.window(camera_id)]
