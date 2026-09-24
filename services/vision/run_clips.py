"""Run the live router on Naman's normalized staging clips. Not for git weights."""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.vision.decode import FileSource  # noqa: E402
from services.vision.pipeline import VisionRouter  # noqa: E402

STAGING = ROOT / "data" / "clips" / "staging" / "normalized"
# Skip 35-minute Wildtrack for this pass.
SKIP = {"wildtrack_cam1.mp4", "wildtrack_cam2.mp4"}


def run_one(path: Path) -> dict:
    cam = path.stem
    src = FileSource({cam: str(path)})
    router = VisionRouter([cam], forced=False, source=src)
    frames = 0
    tracks: set[str] = set()
    rules: Counter[str] = Counter()
    escalations = 0
    max_people = 0
    try:
        while True:
            ovs = router.step()
            if not ovs:
                break
            frames += 1
            ov = ovs[0]
            max_people = max(max_people, len(ov.boxes))
            for b in ov.boxes:
                tracks.add(b.track_id)
            for esc in router.last_escalations:
                escalations += 1
                for r in esc.rules:
                    rules[r] += 1
    finally:
        src.close()
    return {
        "clip": path.name,
        "frames": frames,
        "tracks": len(tracks),
        "max_people": max_people,
        "escalations": escalations,
        "rules": dict(rules),
        "peak": (
            None
            if cam not in router._peak
            else {
                "fused": round(router._peak[cam].fused, 3),
                "rules": router._peak[cam].rules,
                "track_id": router._peak[cam].track_id,
                "vadclip": round(router._peak[cam].vadclip, 3),
            }
        ),
    }


def main() -> None:
    clips = sorted(p for p in STAGING.glob("*.mp4") if p.name not in SKIP)
    if not clips:
        raise SystemExit(f"no clips in {STAGING}")
    print(f"clips={len(clips)} dir={STAGING}")
    rows = [run_one(p) for p in clips]
    print(
        f"{'clip':22} {'frames':>6} {'tracks':>6} {'maxN':>4} "
        f"{'esc':>4}  peak_fused  vadclip  rules"
    )
    for r in rows:
        peak = r["peak"]
        pf = f"{peak['fused']:.3f}" if peak else "-"
        pv = f"{peak['vadclip']:.3f}" if peak else "-"
        pr = ",".join((peak or {}).get("rules") or []) or "-"
        print(
            f"{r['clip']:22} {r['frames']:6} {r['tracks']:6} "
            f"{r['max_people']:4} {r['escalations']:4}  {pf:>9}  {pv:>7}  "
            f"{pr} {r['rules']}"
        )


if __name__ == "__main__":
    main()
