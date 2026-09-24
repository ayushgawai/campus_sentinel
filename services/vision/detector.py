"""YOLO26s-pose — boxes, 17 keypoints, confidence (playbook C).

Live path: official Ultralytics checkpoint, TensorRT engine when present.
Forced path: boxes follow the synthetic person. No weights, no GPU.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from .decode import Frame

WEIGHTS_DIR = Path(__file__).resolve().parent / "weights"
DEFAULT_PT = WEIGHTS_DIR / "yolo26s-pose.pt"
DEFAULT_ENGINE = WEIGHTS_DIR / "yolo26s-pose.engine"
# Engine was exported with this batch (playbook: batched across cameras).
ENGINE_BATCH = 2
# 17 COCO pose joints — playbook: one model, 17 keypoints.
N_KPTS = 17


@dataclass
class Detection:
    x: float
    y: float
    w: float
    h: float
    score: float
    keypoints: list[tuple[float, float, float]] = field(default_factory=list)


def _kpts_from_box(x: float, y: float, w: float, h: float) -> list[tuple[float, float, float]]:
    """Deterministic 17-point stick figure inside the box (forced / fallback)."""
    cx, top = x + w / 2, y
    pts = [
        (cx, top + h * 0.08),  # nose
        (cx - w * 0.08, top + h * 0.06),  # left eye
        (cx + w * 0.08, top + h * 0.06),  # right eye
        (cx - w * 0.14, top + h * 0.10),  # left ear
        (cx + w * 0.14, top + h * 0.10),  # right ear
        (cx - w * 0.28, top + h * 0.28),  # L shoulder
        (cx + w * 0.28, top + h * 0.28),  # R shoulder
        (cx - w * 0.38, top + h * 0.48),  # L elbow
        (cx + w * 0.38, top + h * 0.48),  # R elbow
        (cx - w * 0.32, top + h * 0.66),  # L wrist
        (cx + w * 0.32, top + h * 0.66),  # R wrist
        (cx - w * 0.16, top + h * 0.58),  # L hip
        (cx + w * 0.16, top + h * 0.58),  # R hip
        (cx - w * 0.16, top + h * 0.78),  # L knee
        (cx + w * 0.16, top + h * 0.78),  # R knee
        (cx - w * 0.16, top + h * 0.96),  # L ankle
        (cx + w * 0.16, top + h * 0.96),  # R ankle
    ]
    return [(px, py, 1.0) for px, py in pts]


class PoseDetector:
    def __init__(
        self,
        *,
        forced: bool = False,
        weights: Path | None = None,
        conf: float = 0.25,
    ) -> None:
        self.forced = forced
        self.conf = conf
        self.weights = weights
        self._model = None
        self._loaded_path: Path | None = None

    def _load(self):
        if self._model is not None:
            return self._model
        from ultralytics import YOLO  # local import — forced path stays light

        engine = Path(os.environ.get("VISION_YOLO_ENGINE", DEFAULT_ENGINE))
        pt = self.weights or Path(os.environ.get("VISION_YOLO_PT", DEFAULT_PT))
        prefer_pt = os.environ.get("CS_VISION_YOLO", "").strip().lower() in {
            "pt",
            "pytorch",
            "cpu",
        }
        path = pt if prefer_pt and pt.is_file() else (engine if engine.is_file() else pt)
        if not path.is_file():
            raise FileNotFoundError(
                f"YOLO26s-pose weights missing at {path}. "
                "Run: python3 services/vision/pull_weights.py"
            )
        try:
            self._model = YOLO(str(path))
            self._loaded_path = path
        except Exception as exc:
            # TensorRT often OOMs when ZRT/Qwen already owns the GPU — fall back to .pt
            if path.suffix == ".engine" and pt.is_file():
                print(f"[detector] engine load failed ({exc}); falling back to {pt}", flush=True)
                self._model = YOLO(str(pt))
                self._loaded_path = pt
            else:
                raise
        return self._model

    @property
    def device(self) -> str:
        return os.environ.get("CS_VISION_DEVICE", "cuda:0")

    def detect_forced(self, frames: list[Frame]) -> list[list[Detection]]:
        batch: list[list[Detection]] = []
        for fr in frames:
            x, y, w, h = fr.person_xywh
            batch.append(
                [
                    Detection(
                        x=x,
                        y=y,
                        w=w,
                        h=h,
                        score=0.99,
                        keypoints=_kpts_from_box(x, y, w, h),
                    )
                ]
            )
        return batch

    def detect_batch(self, frames: list[Frame]) -> list[list[Detection]]:
        """One batched forward across cameras (playbook C)."""
        if self.forced:
            return self.detect_forced(frames)
        if not frames:
            return []
        model = self._load()
        images = [fr.image for fr in frames]
        n = len(images)
        # Fixed-shape TensorRT engine: pad / chunk to ENGINE_BATCH.
        using_engine = (
            self._loaded_path is not None and self._loaded_path.suffix == ".engine"
        )
        batches: list[list] = []
        if using_engine:
            pad = images[:]
            while len(pad) % ENGINE_BATCH:
                pad.append(images[-1])
            for i in range(0, len(pad), ENGINE_BATCH):
                batches.append(pad[i : i + ENGINE_BATCH])
        else:
            batches.append(images)
        results = []
        device = self.device
        for b in batches:
            results.extend(
                model.predict(
                    b,
                    conf=self.conf,
                    verbose=False,
                    batch=len(b),
                    device=device,
                )
            )
        results = results[:n]
        out: list[list[Detection]] = []
        for res in results:
            dets: list[Detection] = []
            boxes = res.boxes
            kpts = getattr(res, "keypoints", None)
            if boxes is None:
                out.append(dets)
                continue
            for i, b in enumerate(boxes):
                xyxy = b.xyxy[0].tolist()
                x1, y1, x2, y2 = (float(v) for v in xyxy)
                score = float(b.conf[0]) if b.conf is not None else 0.0
                kpt_list: list[tuple[float, float, float]] = []
                if kpts is not None and kpts.xy is not None and i < len(kpts.xy):
                    xy = kpts.xy[i].tolist()
                    confs = (
                        kpts.conf[i].tolist()
                        if kpts.conf is not None
                        else [1.0] * len(xy)
                    )
                    for (px, py), c in zip(xy, confs):
                        kpt_list.append((float(px), float(py), float(c)))
                if len(kpt_list) < N_KPTS:
                    kpt_list = _kpts_from_box(x1, y1, x2 - x1, y2 - y1)
                dets.append(
                    Detection(
                        x=x1,
                        y=y1,
                        w=x2 - x1,
                        h=y2 - y1,
                        score=score,
                        keypoints=kpt_list[:N_KPTS],
                    )
                )
            out.append(dets)
        return out
