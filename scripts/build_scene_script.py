"""Build data/feeds/seville_scene_script.json: what is happening, every second.

For the demo call (instant answers, no model round-trip) and the scripted
dispatcher call. Per second of the 339 s clip: the active camera, people
visible (YOLO26s-pose on every distinct frame), weapons in view (the
dataset's hand-drawn labels, via seville_weapon_timeline.json). Every 5 s
of the active camera, Qwen3-VL describes the armed people from the frame
with the labelled weapons drawn on it.

  services/vision/.venv/bin/python scripts/build_scene_script.py
"""

import base64
import json
import re
import sys
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import cv2

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from services.brain.zrt_client import DEFAULT_MODEL  # noqa: E402
from services.vision.pipeline import VisionRouter  # noqa: E402

MEDIA = ROOT.parent / "campus_sentinel_media/feeds/seville_option1_3cam_locked"
FEED = json.loads((ROOT / "data/feeds/seville_option1_3cam_locked.json").read_text())
WEAPONS = json.loads((ROOT / "data/feeds/seville_weapon_timeline.json").read_text())["cameras"]
OUT = ROOT / "data/feeds/seville_scene_script.json"
PLACE = {"CAM-01": "the ground-floor lobby", "CAM-02": "the east corridor", "CAM-03": "the west corridor near the stairwell"}
DURATION = int(FEED["duration_s"])
DESCRIBE_EVERY = 5


def active_camera(t):
    for c in FEED["cameras"]:
        if any(a <= t < b for a, b in c["live_windows_s"]):
            return c["camera_id"]
    return None


def people_per_frame():
    from ultralytics import YOLO

    yolo = YOLO(str(ROOT / "services/vision/weights/yolo26s-pose.pt"))
    dd = VisionRouter.__new__(VisionRouter)
    dd._prev_small = {}
    out = {}
    for c in FEED["cameras"]:
        cam = c["camera_id"]
        cap = cv2.VideoCapture(str(MEDIA / c["file"]))
        fps = cap.get(cv2.CAP_PROP_FPS)
        i, rows = -1, []
        while True:
            ok, bgr = cap.read()
            i += 1
            if not ok:
                break
            if dd._changed(SimpleNamespace(camera_id=cam, image=bgr)):
                r = yolo.predict([cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)], conf=0.5, verbose=False, device="cuda:0")[0]
                rows.append((i / fps, len(r.boxes)))
        out[cam] = rows
    return out


def at(rows, t):
    """Last row at or before t (rows are (t, value) sorted)."""
    best = None
    for rt, v in rows:
        if rt <= t + 1e-6:
            best = v
        else:
            break
    return best


def frame_at(cam, t):
    c = next(c for c in FEED["cameras"] if c["camera_id"] == cam)
    cap = cv2.VideoCapture(str(MEDIA / c["file"]))
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * cap.get(cv2.CAP_PROP_FPS)))
    return cap.read()[1]


def describe(job):
    cam, t, people, weapons = job
    img = frame_at(cam, t)
    for w in weapons:
        x1, y1, x2, y2 = w["box"]
        cv2.rectangle(img, (x1 - 3, y1 - 3), (x2 + 3, y2 + 3), (0, 0, 255), 2)
        cv2.putText(img, w["type"], (x1, max(14, y1 - 6)), 0, 0.6, (0, 0, 255), 2)
    b64 = base64.b64encode(cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])[1]).decode()
    kinds = Counter(w["type"] for w in weapons)
    facts = f"{people} people visible. Weapons marked with red boxes: " + (
        ", ".join(f"{n} {k}{'s' if n > 1 else ''}" for k, n in kinds.items()) or "none")
    prompt = (
        f"Campus security camera in {PLACE[cam]}. Facts: {facts}. "
        "For a 911 dispatcher, describe the scene factually. Reply ONLY JSON: "
        '{"armed":[{"weapon":"handgun|rifle|knife","person":"sex, build, clothing colours, hair"}],'
        '"scene":"one sentence: how many people, what they are doing",'
        '"movement":"one short phrase: where they are heading in the frame"}. '
        "One armed entry per red box, in any order. No names, intent or guesses."
    )
    body = {"model": DEFAULT_MODEL, "temperature": 0, "max_tokens": 500, "messages": [{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + b64}}, {"type": "text", "text": prompt}]}]}
    req = urllib.request.Request("http://127.0.0.1:8000/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        txt = json.loads(urllib.request.urlopen(req, timeout=120).read())["choices"][0]["message"]["content"]
        return json.loads(re.search(r"\{.*\}", txt, re.S).group(0))
    except Exception as exc:  # noqa: BLE001
        print("describe failed", cam, t, exc, flush=True)
        return {}


def main():
    people = people_per_frame()
    weapons = {cam: [(r["t"], r["weapons"]) for r in rows] for cam, rows in WEAPONS.items()}
    seconds = []
    for t in range(DURATION + 1):
        cam = active_camera(t + 0.5)
        if cam is None:
            seconds.append({"t": t, "camera": None})
            continue
        ws = at(weapons[cam], t + 0.5) or []
        seconds.append({
            "t": t, "camera": cam, "place": PLACE[cam],
            "people": int(at(people[cam], t + 0.5) or 0),
            "weapons": dict(Counter(w["type"] for w in ws)),
        })
    jobs = [(s["camera"], s["t"] + 0.5, s["people"], at(weapons[s["camera"]], s["t"] + 0.5) or [])
            for s in seconds if s["camera"] and s["t"] % DESCRIBE_EVERY == 0]
    with ThreadPoolExecutor(4) as ex:
        descs = list(ex.map(describe, jobs))
    by_t = {int(j[1]): d for j, d in zip(jobs, descs)}
    last = {}
    for s in seconds:
        if not s["camera"]:
            continue
        if s["t"] in by_t and by_t[s["t"]]:
            last = by_t[s["t"]]
        s["armed"] = last.get("armed", [])
        s["scene"] = last.get("scene", "")
        s["movement"] = last.get("movement", "")
    OUT.write_text(json.dumps({"source": "YOLO counts, dataset weapon labels, Qwen3-VL descriptions every 5 s",
                               "seconds": seconds}, indent=1))
    print("wrote", OUT, len(seconds), "seconds,", len(jobs), "descriptions")


if __name__ == "__main__":
    main()
