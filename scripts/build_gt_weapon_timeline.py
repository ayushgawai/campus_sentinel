"""Build data/feeds/seville_weapon_timeline.json from the dataset labels.

The demo clips were stitched from the US Mock Attack stills (2 fps), which
ship hand-drawn Pascal VOC weapon boxes (Handgun, Short_rifle, Knife). Each
distinct clip frame is matched to its source still by pixel similarity and
takes that still's boxes (scaled 1920x1080 -> 960x540). The router marks the
tracked person whose box contains the weapon centre.

  services/vision/.venv/bin/python scripts/build_gt_weapon_timeline.py
"""

import glob
import json
import re
import sys
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from services.vision.pipeline import VisionRouter  # noqa: E402

IMAGES = Path.home() / "tmp/campus_sentinel_clip_research/sources/mock_attack/extract/Images"
MEDIA = ROOT.parent / "campus_sentinel_media/feeds/seville_option1_3cam_locked"
OUT = ROOT / "data/feeds/seville_weapon_timeline.json"
FILES = {
    "CAM-01": ("CAM01_lobby_entrance_IN_then_OUT_339s.mp4", "Cam5"),
    "CAM-02": ("CAM02_hallway_east_IN_then_OUT_339s.mp4", "Cam1"),
    "CAM-03": ("CAM03_hallway_west_IN_then_OUT_339s.mp4", "Cam7"),
}
# The lobby clip is the still zoomed 1.07x from (24, 0) in 960x540 space
# (template-matched); the hallway clips are the stills unchanged.
ZOOM = {"CAM-01": (1.07, 24.0, 0.0)}
TYPES = {"Handgun": "handgun", "Short_rifle": "rifle", "Knife": "knife"}
MATCH_MAX = 0.35  # mean abs diff of normalised 64x36 thumbnails


def thumb(bgr):
    g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    t = cv2.resize(g, (64, 36), interpolation=cv2.INTER_AREA).astype(np.float32)
    # Normalised: the lobby clip was brightness/contrast corrected ("lobby-fixed").
    return (t - t.mean()) / (t.std() + 1e-6)


def view(still_bgr, cam):
    """The still as the clip shows it (960x540)."""
    img = cv2.resize(still_bgr, (960, 540))
    if cam in ZOOM:
        z, x0, y0 = ZOOM[cam]
        x0, y0 = int(x0), int(y0)
        img = cv2.resize(img[y0:y0 + int(540 / z), x0:x0 + int(960 / z)], (960, 540))
    return img


def to_clip(box, cam):
    z, x0, y0 = ZOOM.get(cam, (1.0, 0.0, 0.0))
    return [round((box[0] - x0) * z), round((box[1] - y0) * z), round((box[2] - x0) * z), round((box[3] - y0) * z)]


def labels(xml_path, sx, sy, cam):
    s = Path(xml_path).read_text()
    out = []
    for obj in re.findall(r"<object>(.*?)</object>", s, re.S):
        name = re.search(r"<name>([^<]+)</name>", obj).group(1)
        v = [float(re.search(rf"<{k}>([^<]+)</{k}>", obj).group(1)) for k in ("xmin", "ymin", "xmax", "ymax")]
        box = to_clip([v[0] * sx, v[1] * sy, v[2] * sx, v[3] * sy], cam)
        out.append({"type": TYPES.get(name, name.lower()), "box": box, "holder": box})
    return out


def main():
    out = {"source": "US Mock Attack hand-drawn labels, matched to clip frames",
           "width": 960, "height": 540, "cameras": {}}
    dd = VisionRouter.__new__(VisionRouter)
    dd._prev_small = {}
    for cam, (fn, prefix) in FILES.items():
        stills = sorted(glob.glob(str(IMAGES / f"{prefix}-*.jpg")))
        thumbs = np.stack([thumb(view(cv2.imread(p), cam)) for p in stills])
        cap = cv2.VideoCapture(str(MEDIA / fn))
        fps = cap.get(cv2.CAP_PROP_FPS)
        i, rows, miss, dists = -1, [], 0, []
        while True:
            ok, bgr = cap.read()
            i += 1
            if not ok:
                break
            if not dd._changed(SimpleNamespace(camera_id=cam, image=bgr)):
                continue
            d = np.abs(thumbs - thumb(bgr)).mean(axis=(1, 2))
            j = int(d.argmin())
            dists.append(float(d[j]))
            weapons = []
            if d[j] > MATCH_MAX:
                miss += 1
            else:
                weapons = labels(stills[j][:-4] + ".xml", 960 / 1920, 540 / 1080, cam)
            rows.append({"frame": i, "t": round(i / fps, 2), "weapons": weapons})
        out["cameras"][cam] = rows
        armed = sum(1 for r in rows if r["weapons"])
        print(f"{cam}: {len(stills)} stills, {len(rows)} distinct frames, {miss} unmatched, "
              f"{armed} with weapons, match dist p50={np.median(dists):.2f} max={max(dists):.2f}", flush=True)
    OUT.write_text(json.dumps(out))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
