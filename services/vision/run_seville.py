"""Run live VisionRouter on the locked Seville 3-cam pack.

Uses data/feeds/seville_option1_3cam_locked.json. Mp4s stay outside git.

  services/vision/.venv/bin/python services/vision/run_seville.py
  services/vision/.venv/bin/python services/vision/run_seville.py --max-steps 90
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
    args = ap.parse_args()

    feed = json.loads(FEED.read_text())
    media = resolve_media_root(feed)
    paths = {c["camera_id"]: str(media / c["file"]) for c in feed["cameras"]}
    for p in paths.values():
        if not Path(p).is_file():
            raise SystemExit(f"missing clip: {p}")

    src = FileSource(paths)
    print(f"media={media}")
    print(f"FileSource fps={src.fps:.2f} {src.width}x{src.height} cams={list(paths)}")
    router = VisionRouter(list(paths), forced=args.forced, source=src)

    t0 = time.time()
    frames = 0
    esc_total = 0
    rules: Counter[str] = Counter()
    by_cam_esc: Counter[str] = Counter()
    max_boxes: Counter[str] = Counter()
    try:
        while True:
            if args.max_steps and frames >= args.max_steps:
                break
            ovs = router.step()
            if not ovs:
                break
            frames += 1
            for ov in ovs:
                max_boxes[ov.camera_id] = max(max_boxes[ov.camera_id], len(ov.boxes))
            for esc in router.last_escalations:
                esc_total += 1
                by_cam_esc[esc.camera_id] += 1
                for r in esc.rules:
                    rules[r] += 1
            if frames % 50 == 0:
                print(f"  frames={frames} esc={esc_total} t={time.time() - t0:.0f}s", flush=True)
    finally:
        src.close()

    print(f"\nRESULT frames={frames} escalations={esc_total} wall_s={time.time() - t0:.1f}")
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
        raise SystemExit("YOLO detected nobody — check weights / TensorRT")
    print("SEVILLE PASS OK")


if __name__ == "__main__":
    main()
