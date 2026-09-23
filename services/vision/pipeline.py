"""Router front: decode → ring → YOLO26s-pose → ByteTrack → overlay.boxes."""

from __future__ import annotations

from contracts import BBox, OverlayBoxes

from .decode import SyntheticSource
from .detector import PoseDetector
from .ring import RingBuffer
from .tracker import ByteTracker, Track


def tracks_to_overlay(camera_id: str, ts, tracks: list[Track]) -> OverlayBoxes:
    boxes = [
        BBox(
            x=t.x,
            y=t.y,
            w=t.w,
            h=t.h,
            track_id=t.track_id,
            label="person",
            score=t.score,
        )
        for t in tracks
    ]
    return OverlayBoxes(camera_id=camera_id, ts=ts, boxes=boxes)


class VisionRouter:
    """Wednesday-morning slice. Fusion / VadCLIP / OSNet are not here."""

    def __init__(
        self,
        camera_ids: list[str],
        *,
        forced: bool = True,
        fps: float = 15.0,
    ) -> None:
        self.source = SyntheticSource(camera_ids, fps=fps)
        self.ring = RingBuffer(window_s=8.0)
        self.detector = PoseDetector(forced=forced)
        self._trackers: dict[str, ByteTracker] = {
            cid: ByteTracker() for cid in camera_ids
        }

    def step(self) -> list[OverlayBoxes]:
        frames = self.source.next_frames()
        for fr in frames:
            self.ring.push(fr)
        dets = self.detector.detect_batch(frames)
        overlays: list[OverlayBoxes] = []
        for fr, cam_dets in zip(frames, dets):
            tracks = self._trackers[fr.camera_id].update(cam_dets)
            overlays.append(tracks_to_overlay(fr.camera_id, fr.ts, tracks))
        return overlays
