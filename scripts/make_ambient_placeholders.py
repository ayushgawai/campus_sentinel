#!/usr/bin/env python3
"""Build 3 ambient placeholder mp4s (parking / basement / road) outside git.

Uses ffmpeg only — no GPU. Writes under campus_sentinel_media/feeds/ambient_3cam/.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # repo root
OUT = ROOT.parent / "campus_sentinel_media" / "feeds" / "ambient_3cam"
FEED_JSON = ROOT / "data" / "feeds" / "ambient_3cam.json"

CLIPS = [
    ("cam-04", "CAM04_parking_east_ambient_60s.mp4", "Parking East", "0x1a2332"),
    ("cam-05", "CAM05_basement_ambient_60s.mp4", "Basement corridor", "0x121212"),
    ("cam-06", "CAM06_road_ambient_60s.mp4", "Campus road", "0x2a3340"),
]

FFMPEG = "/usr/bin/ffmpeg"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for cam_id, fname, loc, color in CLIPS:
        dest = OUT / fname
        if dest.is_file() and dest.stat().st_size > 1000:
            print("exists", dest)
            continue
        # 60s @ 5fps, solid color + timestamp overlay — ambient filler
        cmd = [
            FFMPEG,
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"color=c={color}:s=960x540:r=5",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=16000:cl=mono",
            "-vf",
            f"drawtext=text='{loc} AMBIENT':x=24:y=24:fontsize=28:fontcolor=white@0.8",
            "-t",
            "60",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(dest),
        ]
        print("gen", dest)
        try:
            subprocess.check_call(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except subprocess.CalledProcessError:
            # drawtext needs fonts; fall back to plain color
            cmd_plain = [
                FFMPEG,
                "-y",
                "-f",
                "lavfi",
                "-i",
                f"color=c={color}:s=960x540:r=5",
                "-t",
                "60",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                str(dest),
            ]
            subprocess.check_call(cmd_plain, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    feed = {
        "id": "ambient_3cam",
        "purpose": "Placeholder ambient fillers for 6-pane demo wall (not real CCTV)",
        "duration_s": 60,
        "fps": 5,
        "media_root": {
            "zgx": str(OUT),
            "mac_mount": "~/mnt/zgx-b505/Documents/campus_sentinel_media/feeds/ambient_3cam",
        },
        "cameras": [
            {
                "camera_id": cid.upper().replace("CAM-", "CAM-") if False else cid,
                "file": fname,
                "location": loc,
                "note": "ffmpeg solid-color placeholder — replace with real ambient",
            }
            for cid, fname, loc, _ in CLIPS
        ],
    }
    # fix camera_id to CAM-04 style for vision consistency + cam-04 for web
    feed["cameras"] = [
        {
            "camera_id": f"CAM-0{i}",
            "web_id": f"cam-0{i}",
            "file": CLIPS[i - 4][1],
            "location": CLIPS[i - 4][2],
            "note": "placeholder ambient",
        }
        for i in (4, 5, 6)
    ]
    FEED_JSON.write_text(json.dumps(feed, indent=2) + "\n")
    print("wrote", FEED_JSON)
    print("AMBIENT OK")


if __name__ == "__main__":
    try:
        main()
    except FileNotFoundError:
        print("ffmpeg missing", file=sys.stderr)
        raise SystemExit(1)
