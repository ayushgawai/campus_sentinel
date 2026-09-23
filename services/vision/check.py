"""Self-check for the Wednesday-morning vision slice.

Forced path runs with no GPU and no weights (synthetic + forced boxes).
Live YOLO is optional: skipped unless weights are on disk.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from contracts import BBox, EventType, OverlayBoxes, event_to_dict  # noqa: E402
from services.brain.sampler import sample_from_timestamps  # noqa: E402
from services.vision.bundle import build_bundle  # noqa: E402
from services.vision.decode import SyntheticSource  # noqa: E402
from services.vision.detector import DEFAULT_PT, N_KPTS, PoseDetector  # noqa: E402
from services.vision.pipeline import VisionRouter  # noqa: E402
from services.vision.ring import RingBuffer  # noqa: E402
from services.vision.tracker import ByteTracker  # noqa: E402


def main() -> None:
    cams = ["cam-1", "cam-2"]
    src = SyntheticSource(cams, fps=15.0)
    ring = RingBuffer(window_s=8.0)
    det = PoseDetector(forced=True)
    trackers = {c: ByteTracker() for c in cams}

    last_ids: dict[str, str] = {}
    for _ in range(30):
        frames = src.next_frames()
        batch = det.detect_batch(frames)
        assert len(batch) == 2
        for fr, dets in zip(frames, batch):
            ring.push(fr)
            assert fr.ts.tzinfo is not None
            assert len(dets) == 1
            assert len(dets[0].keypoints) == N_KPTS
            tracks = trackers[fr.camera_id].update(dets)
            assert len(tracks) == 1
            tid = tracks[0].track_id
            if fr.camera_id in last_ids:
                assert tid == last_ids[fr.camera_id], "ByteTrack must keep the id"
            last_ids[fr.camera_id] = tid
            # After a few steps the synthetic person is moving right.
            if src._i > 3:
                assert tracks[0].vx > 0

    # 8s window at 15 fps → at most ~120 frames, never older than 8s
    w = ring.window("cam-1")
    assert w, "ring should hold frames"
    span = (w[-1].ts - w[0].ts).total_seconds()
    assert span <= 8.01, span

    # 16-frame peak-weighted bundle (brain sampler, no scores on the wire)
    peak = w[len(w) // 2].ts
    bundle = build_bundle(
        ring, "cam-1", peak_ts=peak, track_id="t-1", person_hint="moving figure"
    )
    assert len(bundle.images) == 16
    assert bundle.indices == sample_from_timestamps(
        [i.ts.timestamp() for i in w], peak.timestamp(), k=16
    )
    near = sum(1 for i in bundle.indices if abs(i - len(w) // 2) <= 8)
    far = sum(1 for i in bundle.indices if abs(i - len(w) // 2) >= 12)
    assert near > far, (bundle.indices, near, far)
    kw = bundle.to_classify_kwargs()
    assert set(kw) == {
        "track_id",
        "camera_id",
        "peak_ts_iso",
        "person_hint",
        "frames",
    }
    assert "router_score" not in bundle.fact_text()
    assert "fused_prob" not in bundle.fact_text()
    assert len(kw["frames"]) == 16

    # Full pipeline → frozen overlay.boxes only
    router = VisionRouter(["cam-1"], forced=True, fps=15.0)
    overlays = None
    for _ in range(5):
        overlays = router.step()
    assert overlays and len(overlays) == 1
    ov = overlays[0]
    assert isinstance(ov, OverlayBoxes)
    assert ov.type == EventType.OVERLAY_BOXES.value
    assert ov.camera_id == "cam-1"
    assert ov.ts is not None and ov.ts.tzinfo is not None
    assert ov.boxes and isinstance(ov.boxes[0], BBox)
    wire = event_to_dict(ov)
    assert wire["type"] == "overlay.boxes"
    assert "keypoints" not in wire
    assert set(wire["boxes"][0]) == {"x", "y", "w", "h", "track_id", "label", "score"}

    for _ in range(20):
        router.step()
    routed = router.bundle("cam-1", person_hint="moving figure")
    assert routed.track_id.startswith("t-")
    assert len(routed.images) == 16
    assert routed.camera_id == "cam-1"

    if DEFAULT_PT.is_file():
        live = PoseDetector(forced=False)
        frames = SyntheticSource(["cam-1"], fps=15.0).next_frames()
        live_dets = live.detect_batch(frames)
        assert isinstance(live_dets, list) and len(live_dets) == 1
        print("vision self-check OK (forced + live YOLO)")
    else:
        print("vision self-check OK (forced only; weights not on disk)")


if __name__ == "__main__":
    main()
