"""Router: decode → ring → YOLO → ByteTrack → state → rules → VadCLIP → fusion → overlay.boxes."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from contracts import BBox, OverlayBoxes

from .bundle import FrameBundle, build_bundle
from .decode import SyntheticSource
from .detector import PoseDetector
from .fusion import fuse, should_escalate
from .ring import RingBuffer
from .rules import evaluate
from .state import TrackMemory, sample_from_track
from .tracker import ByteTracker, Track
from .vadclip import VadClip


@dataclass
class Escalation:
    camera_id: str
    track_id: str
    ts: datetime
    fused: float
    rules: list[str]
    vadclip: float = 0.0


def tracks_to_overlay(
    camera_id: str,
    ts,
    tracks: list[Track],
    scores: dict[str, float] | None = None,
) -> OverlayBoxes:
    boxes = [
        BBox(
            x=t.x,
            y=t.y,
            w=t.w,
            h=t.h,
            track_id=t.track_id,
            label="person",
            score=(scores or {}).get(t.track_id, t.score),
        )
        for t in tracks
    ]
    return OverlayBoxes(camera_id=camera_id, ts=ts, boxes=boxes)


class VisionRouter:
    def __init__(
        self,
        camera_ids: list[str],
        *,
        forced: bool = True,
        fps: float = 15.0,
        forced_rule: str | None = None,
        forced_vadclip: str | None = None,
        source=None,
    ) -> None:
        self.source = source if source is not None else SyntheticSource(
            camera_ids, fps=fps
        )
        camera_ids = list(getattr(self.source, "camera_ids", camera_ids))
        src_fps = getattr(self.source, "fps", fps)
        self.ring = RingBuffer(window_s=8.0)
        self.detector = PoseDetector(forced=forced)
        self.vadclip = VadClip(forced=forced, forced_label=forced_vadclip)
        self.fps = float(src_fps)
        self.forced_rule = forced_rule
        self._trackers: dict[str, ByteTracker] = {
            cid: ByteTracker() for cid in camera_ids
        }
        self._mem: dict[tuple[str, str], TrackMemory] = {}
        self._last_tracks: dict[str, list[Track]] = {cid: [] for cid in camera_ids}
        self._last_rules: dict[tuple[str, str], list[str]] = {}
        self._peak: dict[str, Escalation] = {}
        self.last_escalations: list[Escalation] = []

    def step(self) -> list[OverlayBoxes]:
        frames = self.source.next_frames()
        if not frames:
            return []
        for fr in frames:
            self.ring.push(fr)
        dets = self.detector.detect_batch(frames)
        self.last_escalations = []
        overlays: list[OverlayBoxes] = []
        for fr, cam_dets in zip(frames, dets):
            tracks = self._trackers[fr.camera_id].update(cam_dets)
            self._last_tracks[fr.camera_id] = tracks
            fused_by: dict[str, float] = {}
            for tr in tracks:
                key = (fr.camera_id, tr.track_id)
                mem = self._mem.setdefault(key, TrackMemory())
                mem.push(sample_from_track(fr.ts, tr))
                rules = evaluate(mem, fps=self.fps, forced=self.forced_rule)
                vs = self.vadclip.score(fr, tr)
                shown = list(rules)
                if vs.label:
                    shown.append(vs.label)
                self._last_rules[key] = shown
                fused = fuse(tr.score, rules, vadclip=vs.score)
                fused_by[tr.track_id] = fused
                prev = self._peak.get(fr.camera_id)
                if prev is None or fused >= prev.fused:
                    self._peak[fr.camera_id] = Escalation(
                        camera_id=fr.camera_id,
                        track_id=tr.track_id,
                        ts=fr.ts,
                        fused=fused,
                        rules=shown,
                        vadclip=vs.score,
                    )
                if should_escalate(fused):
                    self.last_escalations.append(
                        Escalation(
                            camera_id=fr.camera_id,
                            track_id=tr.track_id,
                            ts=fr.ts,
                            fused=fused,
                            rules=list(shown),
                            vadclip=vs.score,
                        )
                    )
            overlays.append(
                tracks_to_overlay(fr.camera_id, fr.ts, tracks, fused_by)
            )
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
        peak = self._peak.get(camera_id)
        if peak_ts is None and peak is not None:
            peak_ts = peak.ts
        if not track_id:
            if peak is not None:
                track_id = peak.track_id
            else:
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
