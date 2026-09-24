"""ByteTrack — boxes → continuous people + direction of travel (playbook C)."""

from __future__ import annotations

from dataclasses import dataclass, field

from .detector import Detection


def _iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ax2, ay2, bx2, by2 = ax + aw, ay + ah, bx + bw, by + bh
    ix1, iy1 = max(ax, bx), max(ay, by)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def _xywh(d: Detection) -> tuple[float, float, float, float]:
    return (d.x, d.y, d.w, d.h)


@dataclass
class Track:
    track_id: str
    x: float
    y: float
    w: float
    h: float
    score: float
    keypoints: list[tuple[float, float, float]]
    vx: float = 0.0  # pixels / step — direction of travel
    vy: float = 0.0
    hits: int = 1
    time_since_update: int = 0


@dataclass
class ByteTracker:
    """Minimal ByteTrack: high-score match, then low-score match, then birth.

    Kalman is omitted on purpose — IoU association is enough for the demo
    slice and keeps the forced path dependency-free.
    """

    high_thresh: float = 0.5
    low_thresh: float = 0.1
    match_iou: float = 0.3
    max_age: int = 15
    _next: int = 1
    _tracks: list[Track] = field(default_factory=list)

    def update(self, dets: list[Detection]) -> list[Track]:
        for t in self._tracks:
            t.time_since_update += 1

        high = [d for d in dets if d.score >= self.high_thresh]
        low = [d for d in dets if self.low_thresh <= d.score < self.high_thresh]

        unmatched_tracks = list(self._tracks)
        unmatched_high = list(high)

        def _match(
            tracks: list[Track],
            detections: list[Detection],
        ) -> tuple[list[tuple[Track, Detection]], list[Track], list[Detection]]:
            pairs: list[tuple[float, int, int]] = []
            for i, tr in enumerate(tracks):
                for j, det in enumerate(detections):
                    pairs.append((_iou((tr.x, tr.y, tr.w, tr.h), _xywh(det)), i, j))
            pairs.sort(reverse=True)
            used_t: set[int] = set()
            used_d: set[int] = set()
            matched: list[tuple[Track, Detection]] = []
            for iou, i, j in pairs:
                if iou < self.match_iou or i in used_t or j in used_d:
                    continue
                used_t.add(i)
                used_d.add(j)
                matched.append((tracks[i], detections[j]))
            left_t = [tr for i, tr in enumerate(tracks) if i not in used_t]
            left_d = [d for j, d in enumerate(detections) if j not in used_d]
            return matched, left_t, left_d

        matched_h, unmatched_tracks, unmatched_high = _match(
            unmatched_tracks, unmatched_high
        )
        for tr, det in matched_h:
            self._apply(tr, det)

        matched_l, unmatched_tracks, _ = _match(unmatched_tracks, low)
        for tr, det in matched_l:
            self._apply(tr, det)

        for det in unmatched_high:
            tid = f"t-{self._next}"
            self._next += 1
            self._tracks.append(
                Track(
                    track_id=tid,
                    x=det.x,
                    y=det.y,
                    w=det.w,
                    h=det.h,
                    score=det.score,
                    keypoints=list(det.keypoints),
                )
            )

        self._tracks = [
            t for t in self._tracks if t.time_since_update <= self.max_age
        ]
        return [t for t in self._tracks if t.time_since_update == 0]

    def _apply(self, tr: Track, det: Detection) -> None:
        cx, cy = tr.x + tr.w / 2, tr.y + tr.h / 2
        ncx, ncy = det.x + det.w / 2, det.y + det.h / 2
        tr.vx = ncx - cx
        tr.vy = ncy - cy
        tr.x, tr.y, tr.w, tr.h = det.x, det.y, det.w, det.h
        tr.score = det.score
        tr.keypoints = list(det.keypoints)
        tr.hits += 1
        tr.time_since_update = 0
