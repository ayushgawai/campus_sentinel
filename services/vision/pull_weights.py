"""Pull official YOLO26s-pose and CLIP ViT-B/16 weights. Never commit the files.

Ultralytics downloads yolo26s-pose.pt on first YOLO(...) load.
TensorRT export is attempted when the engine is missing; .pt stays the fallback.
CLIP ViT-B/16 (openai) is the live VadCLIP backbone.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.vision.detector import DEFAULT_ENGINE, DEFAULT_PT, WEIGHTS_DIR  # noqa: E402
from services.vision.vadclip import CLIP_ARCH, CLIP_PRETRAINED, DEFAULT_CLIP  # noqa: E402


def pull_yolo() -> None:
    WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
    from ultralytics import YOLO

    print(f"loading official checkpoint → {DEFAULT_PT}")
    # Load by name so Ultralytics fetches the official release, then copy
    # into our gitignored weights dir if it landed in the cache instead.
    model = YOLO("yolo26s-pose.pt")
    src = Path(getattr(model, "ckpt_path", "") or "")
    if not src.is_file():
        src = Path(str(model.ckpt_path)) if getattr(model, "ckpt_path", None) else Path()
    # ultralytics stores the file next to cwd or in the package cache
    candidates = [
        Path("yolo26s-pose.pt").resolve(),
        DEFAULT_PT,
        Path.home() / ".cache" / "ultralytics" / "yolo26s-pose.pt",
    ]
    if src.is_file():
        candidates.insert(0, src)
    found = next((p for p in candidates if p.is_file()), None)
    if found is None:
        raise FileNotFoundError("ultralytics did not write yolo26s-pose.pt")
    if found.resolve() != DEFAULT_PT.resolve():
        DEFAULT_PT.write_bytes(found.read_bytes())
    print(f"pt ready: {DEFAULT_PT} ({DEFAULT_PT.stat().st_size} bytes)")

    if DEFAULT_ENGINE.is_file():
        print(f"engine already present: {DEFAULT_ENGINE}")
        return
    try:
        print("exporting TensorRT engine (playbook C)…")
        model = YOLO(str(DEFAULT_PT))
        model.export(format="engine", imgsz=640, batch=2)
        # export writes next to the .pt
        engine = DEFAULT_PT.with_suffix(".engine")
        if engine.is_file() and engine.resolve() != DEFAULT_ENGINE.resolve():
            DEFAULT_ENGINE.write_bytes(engine.read_bytes())
        if DEFAULT_ENGINE.is_file():
            print(f"engine ready: {DEFAULT_ENGINE}")
        else:
            print("export reported ok but engine file not found; staying on .pt")
    except Exception as e:
        print(f"TensorRT export skipped ({type(e).__name__}: {e})")
        print("live detect will use yolo26s-pose.pt until an engine lands")


def pull_clip() -> None:
    import open_clip
    import torch

    WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
    if DEFAULT_CLIP.is_file():
        print(f"clip already present: {DEFAULT_CLIP}")
        return
    print(f"loading official {CLIP_ARCH} ({CLIP_PRETRAINED}) → {DEFAULT_CLIP}")
    model, _, _ = open_clip.create_model_and_transforms(
        CLIP_ARCH, pretrained=CLIP_PRETRAINED
    )
    torch.save(model.state_dict(), DEFAULT_CLIP)
    print(f"clip ready: {DEFAULT_CLIP} ({DEFAULT_CLIP.stat().st_size} bytes)")


def main() -> None:
    pull_yolo()
    pull_clip()


if __name__ == "__main__":
    main()
