"""Frame sources for the vision router.

Playbook: mediamtx RTSP is the live path (Naman clips). Until those exist,
SyntheticSource is the forced/demo decoder so the rest of the router can run.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from contracts import utcnow

try:
    import numpy as np
except ImportError:  # check.py forced path still works
    np = None  # type: ignore[assignment]


@dataclass(frozen=True)
class Frame:
    camera_id: str
    ts: datetime
    image: object  # HxWx3 uint8 when numpy is present
    # Pixel-space box of the synthetic person (xywh). Detector forced-mode
    # follows this; live YOLO ignores it.
    person_xywh: tuple[float, float, float, float]


class SyntheticSource:
    """Deterministic moving-person frames. No files, no RTSP."""

    def __init__(
        self,
        camera_ids: list[str],
        *,
        width: int = 640,
        height: int = 640,
        fps: float = 15.0,
        start: datetime | None = None,
    ) -> None:
        if not camera_ids:
            raise ValueError("camera_ids must be non-empty")
        if fps <= 0:
            raise ValueError("fps must be > 0")
        self.camera_ids = list(camera_ids)
        self.width = width
        self.height = height
        self.fps = fps
        self._dt = 1.0 / fps
        self._i = 0
        self._t0 = start or utcnow()

    def _person(self, camera_id: str, i: int) -> tuple[float, float, float, float]:
        # Phase-offset per camera so two panes are not identical.
        phase = self.camera_ids.index(camera_id) * 18
        w, h = 56.0, 140.0
        x = 40.0 + ((i + phase) * 6) % (self.width - w - 80)
        y = self.height * 0.35
        return (x, y, w, h)

    def _draw(self, xywh: tuple[float, float, float, float]):
        if np is None:
            return None
        img = np.zeros((self.height, self.width, 3), dtype=np.uint8)
        img[:] = (28, 32, 40)
        x, y, w, h = (int(v) for v in xywh)
        img[y : y + h, x : x + w] = (200, 200, 210)
        # crude head so pose models have a blob above the torso
        hx, hy, hs = x + w // 4, max(0, y - 28), w // 2
        img[hy : hy + hs, hx : hx + hs] = (220, 200, 180)
        return img

    def next_frames(self) -> list[Frame]:
        ts = self._t0 + timedelta(seconds=self._i * self._dt)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        out: list[Frame] = []
        for cam in self.camera_ids:
            xywh = self._person(cam, self._i)
            out.append(
                Frame(
                    camera_id=cam,
                    ts=ts,
                    image=self._draw(xywh),
                    person_xywh=xywh,
                )
            )
        self._i += 1
        return out
