"""Router: decode → ring → YOLO → ByteTrack → state → rules → VadCLIP → fusion → overlay.boxes."""

from __future__ import annotations

import os
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
from services import activity
from services.usage import add as usage_add
from .vadclip import WEAPON, VadClip, VadScore

# Once CLIP sees a weapon on a person, keep that box red this long (s):
# CLIP scores one crop per second and flickers between hits.
ARMED_HOLD_S = 4.0
# A frame repeats the last one when fewer than this share of sampled pixels
# moved by more than PIXEL_DIFF (0-255). The Seville clips are 5 fps files
# holding ~2 fps of real motion; codec noise on repeats stays far below this.
PIXEL_DIFF = 20
SAME_FRAME_SHARE = 0.001


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
    labels: dict[str, str] | None = None,
) -> OverlayBoxes:
    boxes = [
        BBox(
            x=t.x,
            y=t.y,
            w=t.w,
            h=t.h,
            track_id=t.track_id,
            label=(labels or {}).get(t.track_id) or "person",
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
        weapon_timeline=None,
    ) -> None:
        self.source = source if source is not None else SyntheticSource(
            camera_ids, fps=fps
        )
        camera_ids = list(getattr(self.source, "camera_ids", camera_ids))
        self.camera_ids = camera_ids
        src_fps = getattr(self.source, "fps", fps)
        self.detector = PoseDetector(
            forced=forced,
            conf=float(os.environ.get("CS_VISION_CONF", "0.50")),
        )
        self.vadclip = VadClip(forced=forced, forced_label=forced_vadclip)
        self.fps = float(src_fps)
        self.forced_rule = forced_rule
        # Who holds a weapon: precomputed per frame when given (see
        # weapon_timeline.py), else CLIP's live per-person label.
        self.weapon_timeline = weapon_timeline
        self.reset_tracking()

    def reset_tracking(self) -> None:
        """Reset per-run state while keeping YOLO and VadCLIP resident."""
        self.ring = RingBuffer(window_s=8.0)
        self._trackers: dict[str, ByteTracker] = {
            cid: ByteTracker() for cid in self.camera_ids
        }
        self._mem: dict[tuple[str, str], TrackMemory] = {}
        self._last_tracks: dict[str, list[Track]] = {
            cid: [] for cid in self.camera_ids
        }
        self._last_rules: dict[tuple[str, str], list[str]] = {}
        self._peak: dict[str, Escalation] = {}
        self.last_escalations: list[Escalation] = []
        self._last_overlay: dict[str, OverlayBoxes] = {}
        self._prev_small: dict[str, object] = {}
        self._armed_until: dict[tuple[str, str], float] = {}

    def _changed(self, fr) -> bool:
        """False when this frame repeats the camera's previous one."""
        img = getattr(fr, "image", None)
        if img is None:
            return True
        import numpy as np

        small = np.asarray(img[::10, ::10], dtype=np.int16)
        prev = self._prev_small.get(fr.camera_id)
        self._prev_small[fr.camera_id] = small
        if prev is None or getattr(prev, "shape", None) != small.shape:
            return True
        moved = np.abs(small - prev) > PIXEL_DIFF
        return float(moved.mean()) >= SAME_FRAME_SHARE

    def step(self) -> list[OverlayBoxes]:
        frames = self.source.next_frames()
        if not frames:
            return []
        for fr in frames:
            self.ring.push(fr)
        fresh = [fr for fr in frames if self._changed(fr)]
        activity.pulse("decode", len(frames))
        dets = self.detector.detect_batch(fresh) if fresh else []
        if fresh:
            activity.pulse("yolo", len(fresh))
        if fresh and not getattr(self.detector, "forced", False):
            usage_add("yolo26s-pose", frames=len(fresh))
        det_by = {fr.camera_id: d for fr, d in zip(fresh, dets)}
        self.last_escalations = []
        overlays: list[OverlayBoxes] = []
        for fr in frames:
            if fr.camera_id not in det_by:
                # Repeated frame: same people, same boxes; no YOLO, no tracker tick.
                last = self._last_overlay.get(fr.camera_id)
                overlays.append(
                    OverlayBoxes(
                        camera_id=fr.camera_id,
                        ts=fr.ts,
                        boxes=list(last.boxes) if last is not None else [],
                    )
                )
                continue
            cam_dets = det_by[fr.camera_id]
            tracks = self._trackers[fr.camera_id].update(cam_dets)
            self._last_tracks[fr.camera_id] = tracks
            armed_now: set[str] = set()
            if self.weapon_timeline is not None:
                clip_t = (int(getattr(self.source, "_i", 0)) - 1) / max(self.fps, 1.0)
                armed_now = set(self.weapon_timeline.armed(fr.camera_id, clip_t, tracks))
            fused_by: dict[str, float] = {}
            label_by: dict[str, str] = {}
            for tr in tracks:
                key = (fr.camera_id, tr.track_id)
                mem = self._mem.setdefault(key, TrackMemory())
                mem.push(sample_from_track(fr.ts, tr))
                rules = evaluate(mem, fps=self.fps, forced=self.forced_rule)
                now_s = fr.ts.timestamp()
                if self.weapon_timeline is not None:
                    # The timeline decides who is armed; per-person CLIP would
                    # only add 20-40 ms per person per step (video stalls).
                    vs = VadScore(0.0, "")
                    seen_armed = tr.track_id in armed_now
                else:
                    vs = self.vadclip.score(fr, tr)
                    seen_armed = vs.label == WEAPON
                if seen_armed:
                    self._armed_until[key] = now_s + ARMED_HOLD_S
                if self._armed_until.get(key, 0.0) > now_s:
                    # An armed person escalates to Qwen through the weapon rule.
                    rules = [*rules, WEAPON]
                shown = list(rules)
                if vs.label and vs.label not in shown:
                    shown.append(vs.label)
                self._last_rules[key] = shown
                fused = fuse(tr.score, rules, vadclip=vs.score)
                fused_by[tr.track_id] = fused
                if self._armed_until.get(key, 0.0) > now_s:
                    label_by[tr.track_id] = WEAPON
                elif vs.label and vs.label != WEAPON:
                    label_by[tr.track_id] = f"{vs.label}"
                elif rules:
                    label_by[tr.track_id] = str(rules[0])
                else:
                    label_by[tr.track_id] = "person"
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
            ov = tracks_to_overlay(fr.camera_id, fr.ts, tracks, fused_by, labels=label_by)
            self._last_overlay[fr.camera_id] = ov
            overlays.append(ov)
        people = sum(len(o.boxes) for o in overlays)
        activity.pulse("bytetrack", people)
        if self.weapon_timeline is not None:
            activity.pulse("weapons", sum(b.label == WEAPON for o in overlays for b in o.boxes))
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
