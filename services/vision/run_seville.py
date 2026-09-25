"""Run live VisionRouter on the locked Seville pack (3 cams, or 4 with Naman).

Uses data/feeds/seville_option1_3cam_locked.json. Mp4s stay outside git.

  services/vision/.venv/bin/python services/vision/run_seville.py
  services/vision/.venv/bin/python services/vision/run_seville.py --max-steps 90
  services/vision/.venv/bin/python services/vision/run_seville.py --n-cams 4 --max-steps 90
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.vision.decode import FileSource  # noqa: E402
from services.vision.pipeline import VisionRouter  # noqa: E402

FEED = ROOT / "data" / "feeds" / "seville_option1_3cam_locked.json"
NAMAN_04 = (
    Path.home()
    / "Documents/campus_sentinel_media/feeds/naman/demo_clips"
    / "ufpark_parking_lot_traffic_01_5min.mp4"
)


def resolve_media_root(feed: dict) -> Path:
    roots = feed.get("media_root") or {}
    for key in ("zgx", "mac_mount"):
        raw = roots.get(key)
        if not raw:
            continue
        path = Path(raw).expanduser()
        if path.is_dir():
            return path
    raise SystemExit(
        "Seville media root not found. Expected mp4s under "
        f"{roots.get('zgx')!r} or {roots.get('mac_mount')!r}"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-steps", type=int, default=0, help="0 = full clip")
    ap.add_argument("--forced", action="store_true", help="no YOLO/CLIP weights")
    ap.add_argument(
        "--n-cams",
        type=int,
        default=3,
        choices=(2, 3, 4),
        help="2 = Seville CAM-01+02; 3 = Seville; 4 = + Naman cam-04",
    )
    args = ap.parse_args()

    feed = json.loads(FEED.read_text())
    media = resolve_media_root(feed)
    paths = {c["camera_id"]: str(media / c["file"]) for c in feed["cameras"]}
    if args.n_cams == 2:
        keep = [c["camera_id"] for c in feed["cameras"][:2]]
        paths = {k: paths[k] for k in keep}
    if args.n_cams >= 4:
        if not NAMAN_04.is_file():
            raise SystemExit(f"missing 4th clip: {NAMAN_04}")
        paths["cam-04"] = str(NAMAN_04)
    for p in paths.values():
        if not Path(p).is_file():
            raise SystemExit(f"missing clip: {p}")

    src = FileSource(paths)
    print(f"media={media}")
    print(f"FileSource fps={src.fps:.2f} {src.width}x{src.height} cams={list(paths)}")
    print(f"n_cams={len(paths)} yolo=yolo26s-pose.pt")
    router = VisionRouter(list(paths), forced=args.forced, source=src)

    t0 = time.time()
    frames = 0
    esc_total = 0
    step_ms: list[float] = []
    rules: Counter[str] = Counter()
    by_cam_esc: Counter[str] = Counter()
    max_boxes: Counter[str] = Counter()
    last_boxes: dict[str, int] = {}
    try:
        while True:
            if args.max_steps and frames >= args.max_steps:
                break
            t_step = time.perf_counter()
            ovs = router.step()
            dt = (time.perf_counter() - t_step) * 1000.0
            if not ovs:
                break
            frames += 1
            if frames > 3:
                step_ms.append(dt)
            last_boxes = {ov.camera_id: len(ov.boxes) for ov in ovs}
            for ov in ovs:
                max_boxes[ov.camera_id] = max(max_boxes[ov.camera_id], len(ov.boxes))
            for esc in router.last_escalations:
                esc_total += 1
                by_cam_esc[esc.camera_id] += 1
                for r in esc.rules:
                    rules[r] += 1
            if frames == 1:
                print(
                    f"  yolo={router.detector._loaded_path} "
                    f"overlays={len(ovs)} first_step_ms={dt:.1f}",
                    flush=True,
                )
            if frames % 20 == 0:
                print(
                    f"  steps={frames} esc={esc_total} "
                    f"boxes={last_boxes} t={time.time() - t0:.0f}s",
                    flush=True,
                )
    finally:
        src.close()

    mean_ms = sum(step_ms) / len(step_ms) if step_ms else 0.0
    print(
        f"\nRESULT n_cams={len(paths)} steps={frames} overlays/step={len(paths)} "
        f"escalations={esc_total} wall_s={time.time() - t0:.1f} "
        f"step_ms={mean_ms:.1f}"
    )
    print("per-cam max_boxes:", dict(max_boxes))
    print("per-cam escalations:", dict(by_cam_esc))
    print("rules:", dict(rules))
    print("peaks:")
    for cid, peak in router._peak.items():
        print(
            f"  {cid}: fused={peak.fused:.3f} vadclip={peak.vadclip:.3f} "
            f"track={peak.track_id} rules={peak.rules}"
        )
    if frames < 1:
        raise SystemExit("no frames decoded")
    if not args.forced and sum(max_boxes.values()) < 1:
        raise SystemExit("YOLO detected nobody — check yolo26s-pose.pt")
    print(f"{len(paths)}-CAM PASS OK")


if __name__ == "__main__":
    main()
