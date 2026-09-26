"""Frame sources for the vision router.

Playbook: mediamtx RTSP is the live path (Naman clips). Until those exist,
SyntheticSource is the forced/demo decoder so the rest of the router can run.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any
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


def skip_count(already: int, fps: float, elapsed_s: float) -> int:
    """How many frames to grab-drop so the next read is at wall-clock time."""
    if fps <= 0:
        return 0
    target = int(elapsed_s * fps)
    return max(0, target - already)


def active_camera_ids(
    windows: dict[str, list[list[float]]] | None, elapsed_s: float
) -> set[str] | None:
    """Return scheduled cameras, or None when every camera should be processed."""
    if windows is None:
        return None
    return {
        camera_id
        for camera_id, spans in windows.items()
        if any(start <= elapsed_s < end for start, end in spans)
    }


class FileSource:
    """Decode local mp4s (Naman clips) until mediamtx RTSP exists.

    realtime=True: grab-drop so the decoded frame matches wall time, same
    pace as `ffmpeg -re` on the MJPEG wall. run_seville stays False (every frame).
    """

    def __init__(
        self,
        paths: dict[str, str],
        *,
        start: datetime | None = None,
        realtime: bool = False,
        active_windows: dict[str, list[list[float]]] | None = None,
    ) -> None:
        if not paths:
            raise ValueError("paths must be non-empty")
        self._paths = dict(paths)
        self.camera_ids = list(paths)
        self.realtime = realtime
        self.active_windows = active_windows
        self._start = start
        self._open_caps()

    def _open_caps(self) -> None:
        import cv2

        self._caps = {}
        # Latest decoded BGR frame per camera (active or not): the MJPEG wall
        # streams these, so video and boxes share one clock.
        self.last_bgr: dict[str, Any] = {}
        self.fps = 15.0
        fps_locked = False
        for cid, path in self._paths.items():
            cap = cv2.VideoCapture(path)
            if not cap.isOpened():
                raise FileNotFoundError(f"cannot open clip {path}")
            raw = cap.get(cv2.CAP_PROP_FPS)
            if raw and raw > 1 and not fps_locked:
                self.fps = float(raw)
                fps_locked = True
            self._caps[cid] = cap
        self._dt = 1.0 / self.fps
        self._i = 0
        self._t0 = self._start or utcnow()
        self._wall0 = time.monotonic()
        self.width = int(next(iter(self._caps.values())).get(cv2.CAP_PROP_FRAME_WIDTH) or 640)
        self.height = int(next(iter(self._caps.values())).get(cv2.CAP_PROP_FRAME_HEIGHT) or 640)
        self._upscale = 1.0
        short = min(self.width, self.height)
        if short and short < 320:
            self._upscale = 320.0 / short
            self.width = int(self.width * self._upscale)
            self.height = int(self.height * self._upscale)

    def rewind(self) -> None:
        """Re-open from t=0 and reset the wall clock (mjpeg -re just started)."""
        self.close()
        self._open_caps()

    def shift_wall(self, paused_s: float) -> None:
        """Do not skip the pause interval when the hub unpauses."""
        if paused_s > 0:
            self._wall0 += paused_s

    def _catch_up(self) -> bool:
        """Grab-drop until wall-clock frame. False on EOF."""
        if not self.realtime:
            return True
        n = skip_count(self._i, self.fps, time.monotonic() - self._wall0)
        for _ in range(n):
            for cap in self._caps.values():
                if not cap.grab():
                    return False
            self._i += 1
        return True

    def next_frames(self) -> list[Frame]:
        import cv2

        if not self._catch_up():
            return []
        ts = self._t0 + timedelta(seconds=self._i * self._dt)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        out: list[Frame] = []
        active = active_camera_ids(self.active_windows, self._i * self._dt)
        for cid in self.camera_ids:
            ok, bgr = self._caps[cid].read()
            if not ok:
                return []
            self.last_bgr[cid] = bgr
            if active is not None and cid not in active:
                continue
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            if getattr(self, "_upscale", 1.0) != 1.0:
                rgb = cv2.resize(
                    rgb,
                    (self.width, self.height),
                    interpolation=cv2.INTER_LINEAR,
                )
            out.append(
                Frame(
                    camera_id=cid,
                    ts=ts,
                    image=rgb,
                    person_xywh=(0.0, 0.0, 1.0, 1.0),
                )
            )
        self._i += 1
        return out

    def close(self) -> None:
        for cap in getattr(self, "_caps", {}).values():
            cap.release()
        self._caps = {}
