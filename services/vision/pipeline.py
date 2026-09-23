"""Router front: decode → ring → YOLO26s-pose → ByteTrack → overlay.boxes."""

from __future__ import annotations

from datetime import datetime

from contracts import BBox, OverlayBoxes

from .bundle import FrameBundle, build_bundle
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
        self._last_tracks: dict[str, list[Track]] = {cid: [] for cid in camera_ids}

    def step(self) -> list[OverlayBoxes]:
        frames = self.source.next_frames()
        for fr in frames:
            self.ring.push(fr)
        dets = self.detector.detect_batch(frames)
        overlays: list[OverlayBoxes] = []
        for fr, cam_dets in zip(frames, dets):
            tracks = self._trackers[fr.camera_id].update(cam_dets)
            self._last_tracks[fr.camera_id] = tracks
            overlays.append(tracks_to_overlay(fr.camera_id, fr.ts, tracks))
        return overlays

    def bundle(
        self,
        camera_id: str,
        *,
        peak_ts: datetime | None = None,
        track_id: str = "",
        person_hint: str = "",
        k: int = 16,
    ) -> FrameBundle:
        """16 peak-weighted frames for brain.zrt_client.classify (no scores)."""
        if not track_id:
            live = self._last_tracks.get(camera_id) or []
            track_id = live[0].track_id if live else ""
        return build_bundle(
            self.ring,
            camera_id,
            peak_ts=peak_ts,
            track_id=track_id,
            person_hint=person_hint,
            k=k,
        )
