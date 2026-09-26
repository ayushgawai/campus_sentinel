"""Self-check for the Wednesday-morning vision slice.

Forced path runs with no GPU and no weights (synthetic + forced boxes).
Live YOLO is optional: skipped unless weights are on disk.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from datetime import timedelta  # noqa: E402

from contracts import BBox, EventType, OverlayBoxes, event_to_dict, utcnow  # noqa: E402
from services.brain.sampler import sample_from_timestamps  # noqa: E402
from services.vision.bundle import build_bundle  # noqa: E402
from services.vision.decode import (  # noqa: E402
    SyntheticSource,
    active_camera_ids,
    skip_count,
)
from services.vision.detector import DEFAULT_PT, N_KPTS, PoseDetector  # noqa: E402
from services.vision.fusion import fuse, should_escalate  # noqa: E402
from services.vision.pipeline import VisionRouter  # noqa: E402
from services.vision.ring import RingBuffer  # noqa: E402
from services.vision.rules import FALL, RUN, evaluate  # noqa: E402
from services.vision.state import PoseSample, TrackMemory  # noqa: E402
from services.vision.tracker import ByteTracker, Track  # noqa: E402
from services.vision.vadclip import FIGHT, DEFAULT_CLIP, VadClip  # noqa: E402


def main() -> None:
    cams = ["cam-1", "cam-2"]
    src = SyntheticSource(cams, fps=15.0)
    ring = RingBuffer(window_s=8.0)
    det = PoseDetector(forced=True)
    trackers = {c: ByteTracker() for c in cams}

    last_ids: dict[str, str] = {}
    for step in range(30):
        frames = src.next_frames()
        batch = det.detect_batch(frames)
        assert len(batch) == 2
        for fr, dets in zip(frames, batch):
            ring.push(fr)
            assert fr.ts.tzinfo is not None
            assert len(dets) == 1
            assert len(dets[0].keypoints) == N_KPTS
            tracks = trackers[fr.camera_id].update(dets)
            if step == 0:
                assert tracks == [], "a new track is shown only once confirmed"
                continue
            assert len(tracks) == 1
            tid = tracks[0].track_id
            if fr.camera_id in last_ids:
                assert tid == last_ids[fr.camera_id], "ByteTrack must keep the id"
            last_ids[fr.camera_id] = tid
            # After a few steps the synthetic person is moving right.
            if src._i > 3:
                assert tracks[0].vx > 0

    # Tracker: no one-frame ghosts; a 2 fps jump keeps the id; far = new person.
    from services.vision.detector import Detection

    bt = ByteTracker()
    ghost = Detection(x=800, y=10, w=40, h=120, score=0.9)
    assert bt.update([ghost]) == []
    assert bt.update([]) == []
    walker = [Detection(x=100 + 45 * i, y=200, w=60, h=200, score=0.9) for i in range(4)]
    ids = [t.track_id for d in walker for t in bt.update([d])]
    assert len(ids) == 3 and len(set(ids)) == 1, ids
    far = Detection(x=700, y=200, w=60, h=200, score=0.9)
    bt.update([walker[-1], far])
    both = bt.update([walker[-1], far])
    assert len({t.track_id for t in both}) == 2

    # Weapon timeline: carries forward between distinct frames; the holder is armed.
    import json as _json
    import tempfile

    from services.vision.weapon_timeline import WeaponTimeline

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        _json.dump(
            {"cameras": {"CAM-01": [
                {"frame": 10, "t": 2.0, "weapons": [{"type": "handgun", "box": [120, 300, 140, 320], "holder": [100, 200, 160, 400]}]},
                {"frame": 14, "t": 2.8, "weapons": []},
            ]}},
            fh,
        )
    wt = WeaponTimeline(fh.name)
    holder = Track(track_id="t-3", x=100, y=200, w=60, h=200, score=0.9, keypoints=[])
    other = Track(track_id="t-4", x=500, y=200, w=60, h=200, score=0.9, keypoints=[])
    assert wt.weapons_at("cam-01", 1.8) == []
    assert wt.armed("cam-01", 2.4, [other, holder]) == {"t-3": "handgun"}
    assert wt.armed("cam-01", 2.8, [holder]) == {}
    os.unlink(fh.name)

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

    # A demo/video reset must restart person IDs without reloading YOLO.
    detector = router.detector
    router.reset_tracking()
    assert router.step()[0].boxes == [], "unconfirmed on the first frame"
    reset_overlay = router.step()[0]
    assert reset_overlay.boxes[0].track_id == "t-1"
    assert router.detector is detector

    # Fall sequence on rolling state (not fire — no FIRE class)
    mem = TrackMemory()
    t0 = utcnow()
    for i in range(12):
        frac = i / 11
        mem.push(
            PoseSample(
                ts=t0 + timedelta(seconds=i / 15),
                x=100,
                y=80 + 90 * frac,
                w=56,
                h=140 - 70 * frac,
                score=0.9,
                vx=1.0,
                vy=4.0 + 12 * frac,
                torso_deg=15 + 70 * frac,
                cx=128,
                cy=150 + 90 * frac,
            )
        )
    assert FALL in evaluate(mem)
    assert should_escalate(fuse(0.9, [FALL]))
    # Fight/theft can escalate without a pose rule once VadCLIP is on.
    assert should_escalate(fuse(0.8, [], vadclip=0.70))
    assert not should_escalate(fuse(0.5, [], vadclip=0.20))

    dummy = SyntheticSource(["cam-1"], fps=15.0).next_frames()[0]
    dummy_tr = Track(
        track_id="t-1", x=40, y=200, w=56, h=140, score=0.9, keypoints=[]
    )
    assert VadClip(forced=True).score(dummy, dummy_tr).score == 0.0
    fight = VadClip(forced=True, forced_label=FIGHT).score(dummy, dummy_tr)
    assert fight.label == FIGHT and fight.score >= 0.9

    fall_router = VisionRouter(["cam-1"], forced=True, fps=15.0, forced_rule=FALL)
    for _ in range(10):
        fall_router.step()
    assert fall_router.last_escalations
    assert FALL in fall_router.last_escalations[0].rules
    assert fall_router.bundle("cam-1").track_id

    fight_router = VisionRouter(
        ["cam-1"], forced=True, fps=15.0, forced_vadclip=FIGHT
    )
    for _ in range(5):
        fight_router.step()
    assert fight_router.last_escalations
    assert FIGHT in fight_router.last_escalations[0].rules
    assert fight_router.last_escalations[0].vadclip >= 0.9

    # Sliding synthetic person should be able to trip run (not only fall)
    run_mem = TrackMemory()
    t1 = utcnow()
    for i in range(20):
        run_mem.push(
            PoseSample(
                ts=t1 + timedelta(seconds=i / 15),
                x=40 + i * 20,
                y=200,
                w=56,
                h=140,
                score=0.9,
                vx=20.0,
                vy=0.0,
                torso_deg=10.0,
                cx=68 + i * 20,
                cy=270,
            )
        )
    assert RUN in evaluate(run_mem, fps=15.0)
    assert skip_count(0, 5.0, 0.0) == 0
    assert skip_count(0, 5.0, 1.0) == 5
    assert skip_count(3, 5.0, 0.4) == 0
    windows = {
        "CAM-01": [[0.0, 60.0]],
        "CAM-02": [[60.0, 117.0]],
        "CAM-03": [[117.0, 216.6]],
    }
    assert active_camera_ids(windows, 59.9) == {"CAM-01"}
    assert active_camera_ids(windows, 60.0) == {"CAM-02"}
    assert active_camera_ids(None, 60.0) is None

    if DEFAULT_PT.is_file():
        live = PoseDetector(forced=False)
        frames = SyntheticSource(["cam-1"], fps=15.0).next_frames()
        live_dets = live.detect_batch(frames)
        assert isinstance(live_dets, list) and len(live_dets) == 1
        extra = " + live YOLO"
    else:
        extra = " (forced only; YOLO weights not on disk)"
    if DEFAULT_CLIP.is_file():
        vs = VadClip(forced=False).score(dummy, dummy_tr)
        assert 0.0 <= vs.score <= 1.0
        extra += " + live CLIP"
    print(f"vision self-check OK{extra}")


if __name__ == "__main__":
    main()
