"""Build data/feeds/seville_weapon_timeline.json with Qwen3-VL (offline).

Asks Qwen3-VL about every distinct frame of the three demo feeds and records
each visible weapon plus the box of the person holding it. The live router
replays this by frame index (services/vision/weapon_timeline.py).

  services/vision/.venv/bin/python scripts/build_weapon_timeline.py
Needs ZRT/Qwen on :8000. ~650 frames, ~10 min with 4 parallel requests.
"""
import sys, json, base64, urllib.request, cv2, re
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from services.brain.zrt_client import DEFAULT_MODEL
from services.vision.pipeline import VisionRouter
M = str(ROOT.parent / "campus_sentinel_media/feeds/seville_option1_3cam_locked") + "/"
OUT = ROOT / "data/feeds/seville_weapon_timeline.json"
F = {"CAM-01": "CAM01_lobby_entrance_IN_then_OUT_339s.mp4", "CAM-02": "CAM02_hallway_east_IN_then_OUT_339s.mp4", "CAM-03": "CAM03_hallway_west_IN_then_OUT_339s.mp4"}
PROMPT = ("Security camera frame. Find every weapon visible: handgun, rifle, shotgun or knife. Look closely at every hand, "
          "small dark handguns held low count too. Reply ONLY JSON: {\"weapons\":[{\"type\":\"handgun|rifle|shotgun|knife\","
          "\"bbox_2d\":[x1,y1,x2,y2],\"holder_bbox_2d\":[x1,y1,x2,y2]}]} with coordinates on a 0-1000 scale. {\"weapons\":[]} if none.")

def ask(job):
    i, fps, bgr = job
    b64 = base64.b64encode(cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 90])[1]).decode()
    body = {"model": DEFAULT_MODEL, "temperature": 0, "max_tokens": 400, "messages": [{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + b64}}, {"type": "text", "text": PROMPT}]}]}
    try:
        req = urllib.request.Request("http://127.0.0.1:8000/v1/chat/completions", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        txt = json.loads(urllib.request.urlopen(req, timeout=120).read())["choices"][0]["message"]["content"]
        m = re.search(r"\{.*\}", txt, re.S)
        weapons = json.loads(m.group(0)).get("weapons", []) if m else []
    except Exception as e:
        weapons = None
        print("error", i, e, flush=True)
    return {"frame": i, "t": round(i / fps, 2), "weapons": weapons}

def convert(raw):
    """Qwen 0-1000 boxes -> source pixels; failed frames repeat no weapons."""
    cams = {}
    for cam, d in raw.items():
        rows = []
        for r in d["frames"]:
            ws = []
            for w in r["weapons"] or []:
                try:
                    box = [v * s / 1000 for v, s in zip(w["bbox_2d"], (W, H, W, H))]
                    holder = [v * s / 1000 for v, s in zip(w.get("holder_bbox_2d") or w["bbox_2d"], (W, H, W, H))]
                except (KeyError, TypeError, ValueError):
                    continue
                ws.append({"type": str(w.get("type", "weapon")), "box": [round(v) for v in box], "holder": [round(v) for v in holder]})
            rows.append({"frame": r["frame"], "t": r["t"], "weapons": ws})
        cams[cam] = rows
    return {"source": "Qwen3-VL-30B-A3B offline, every distinct frame", "width": W, "height": H, "cameras": cams}


W, H = 960, 540


def main():
    dd = VisionRouter.__new__(VisionRouter); dd._prev_small = {}
    out = {}
    for cam, fn in F.items():
        cap = cv2.VideoCapture(M + fn); fps = cap.get(cv2.CAP_PROP_FPS); i = -1; jobs = []
        while True:
            ok, bgr = cap.read(); i += 1
            if not ok:
                break
            if dd._changed(SimpleNamespace(camera_id=cam, image=bgr)):
                jobs.append((i, fps, bgr))
        with ThreadPoolExecutor(4) as ex:
            recs = list(ex.map(ask, jobs))
        out[cam] = {"fps": fps, "frames": recs}
        print(cam, "done", len(recs), flush=True)
    OUT.write_text(json.dumps(convert(out)))
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
