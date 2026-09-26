"""VadCLIP head — 1 fps per tracked person (playbook C.6).

Official VadCLIP (Wu et al.) is a weakly-supervised adapter on pre-extracted
10-crop CLIP features + OneDrive UCF/XD weights. That is not a live crop model.

Playbook job is live and per-person: catch FIGHT / THEFT that posture misses.
We run the same frozen CLIP ViT-B/16 backbone on the track crop and score
language-image alignment against those two classes vs BENIGN.

Not ZRT — same exception as YOLO. Router-tier, milliseconds.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from .decode import Frame
from .tracker import Track
from services import activity
from services.usage import add as usage_add

WEIGHTS_DIR = Path(__file__).resolve().parent / "weights"
DEFAULT_CLIP = WEIGHTS_DIR / "clip-vit-b-16.pt"
CLIP_ARCH = "ViT-B-16"
CLIP_PRETRAINED = "openai"

WEAPON = "weapon"
FIGHT = "fight"
THEFT = "theft"
BENIGN = "benign"

# About 1 fps per tracked person (playbook C.6).
HZ = 1.0

# Six-class set: WEAPON replaces former FALL (Seville demo).
_PROMPTS: dict[str, tuple[str, ...]] = {
    WEAPON: (
        "a person holding a gun",
        "a person with a firearm in a hallway",
        "an armed intruder with a rifle",
        "someone carrying a visible weapon",
        "a person holding a handgun",
        "a person holding a knife",
        "a person with a knife in their hand",
    ),
    FIGHT: (
        "a photo of people fighting",
        "two people punching each other",
        "a violent physical fight",
    ),
    THEFT: (
        "a person stealing a bag",
        "someone shoplifting",
        "a theft in progress",
    ),
    BENIGN: (
        "a person walking",
        "people standing normally",
        "a person sitting",
        "a person on an escalator",
        "a person in a room",
        "surveillance video of everyday activity",
    ),
}

# Cosine gap (anomaly − benign) that maps to score 1.0. CLIP edges are small.
MARGIN_FULL = 0.08
# Below this, no fight/theft label. Stops softmax-from-a-tie calling everything theft.
MARGIN_LABEL = 0.02


@dataclass(frozen=True)
class VadScore:
    score: float
    label: str  # fight | theft | ""


class VadClip:
    def __init__(
        self,
        *,
        forced: bool = False,
        forced_label: str | None = None,
        weights: Path | None = None,
        hz: float = HZ,
    ) -> None:
        self.forced = forced
        self.forced_label = forced_label
        self.weights = weights or Path(os.environ.get("VISION_CLIP_PT", DEFAULT_CLIP))
        self.hz = hz
        self._model = None
        self._preprocess = None
        self._device = "cpu"
        self._class_feat = None  # 3 x D, order fight, theft, benign
        self._labels = (WEAPON, FIGHT, THEFT, BENIGN)
        self._last: dict[tuple[str, str], tuple[float, VadScore]] = {}

    def score(self, frame: Frame, track: Track) -> VadScore:
        if self.forced:
            if self.forced_label in (WEAPON, FIGHT, THEFT):
                return VadScore(0.90, self.forced_label)
            return VadScore(0.0, "")
        key = (frame.camera_id, track.track_id)
        t = frame.ts.timestamp()
        prev = self._last.get(key)
        if prev is not None and (t - prev[0]) < (1.0 / self.hz):
            return prev[1]
        with activity.busy("clip"):
            out = self._infer(frame, track)
        self._last[key] = (t, out)
        return out

    def _load(self):
        if self._model is not None:
            return
        import logging
        import open_clip
        import torch

        path = Path(self.weights)
        if not path.is_file():
            raise FileNotFoundError(
                f"CLIP ViT-B/16 weights missing at {path}. "
                "Run: python3 services/vision/pull_weights.py"
            )
        # OpenAI CLIP ViT-B/16 uses QuickGELU; mismatch silently hurts scores.
        # open_clip warns "initialized randomly" when pretrained=None — we load
        # the local .pt immediately after; suppress that one false alarm.
        class _DropRandomInit(logging.Filter):
            def filter(self, record: logging.LogRecord) -> bool:
                msg = record.getMessage()
                return "initialized randomly" not in msg and "No pretrained weights" not in msg

        root = logging.getLogger()
        filt = _DropRandomInit()
        root.addFilter(filt)
        try:
            model, _, preprocess = open_clip.create_model_and_transforms(
                CLIP_ARCH, pretrained=None, force_quick_gelu=True
            )
        finally:
            root.removeFilter(filt)
        blob = torch.load(path, map_location="cpu", weights_only=True)
        state = blob["state_dict"] if isinstance(blob, dict) and "state_dict" in blob else blob
        incompatible = model.load_state_dict(state, strict=False)
        missing = getattr(incompatible, "missing_keys", []) or []
        unexpected = getattr(incompatible, "unexpected_keys", []) or []
        if missing or unexpected:
            raise RuntimeError(
                f"CLIP state_dict mismatch at {path}: "
                f"missing={len(missing)} unexpected={len(unexpected)}"
            )
        model.eval()
        logging.getLogger(__name__).info("VadCLIP loaded CLIP weights from %s", path)
        # Prefer CPU when ZRT owns the GPU (CS_VISION_DEVICE=cpu).
        want = os.environ.get("CS_VISION_DEVICE", "").strip().lower()
        if want.startswith("cpu"):
            device = "cpu"
        elif want.startswith("cuda"):
            device = want
        else:
            device = "cuda" if torch.cuda.is_available() else "cpu"
        model = model.to(device)
        tokenizer = open_clip.get_tokenizer(CLIP_ARCH)
        texts: list[str] = []
        spans: list[tuple[int, int]] = []
        for lab in self._labels:
            a = len(texts)
            texts.extend(_PROMPTS[lab])
            spans.append((a, len(texts)))
        tokens = tokenizer(texts).to(device)
        with torch.no_grad():
            feat = model.encode_text(tokens)
            feat = feat / feat.norm(dim=-1, keepdim=True)
            class_feat = []
            for a, b in spans:
                v = feat[a:b].mean(dim=0)
                class_feat.append(v / v.norm())
            class_feat = torch.stack(class_feat, dim=0)
        self._model = model
        self._preprocess = preprocess
        self._device = device
        self._class_feat = class_feat

    def _infer(self, frame: Frame, track: Track) -> VadScore:
        import numpy as np
        from PIL import Image
        import torch

        img = frame.image
        if img is None or not hasattr(img, "shape"):
            return VadScore(0.0, "")
        crop = _crop_rgb(img, track.x, track.y, track.w, track.h)
        if crop is None:
            return VadScore(0.0, "")
        self._load()
        pil = Image.fromarray(np.asarray(crop))
        tens = self._preprocess(pil).unsqueeze(0).to(self._device)
        with torch.no_grad():
            vis = self._model.encode_image(tens)
            usage_add("clip-vit-b-16", frames=1)
            vis = vis / vis.norm(dim=-1, keepdim=True)
            # Raw cosine, not CLIP's logit_scale=100 softmax. That turn
            # a 0.02 edge into a 0.9 "theft" on walking crops.
            sims = (vis @ self._class_feat.T)[0].detach().cpu().tolist()
        s_weapon, s_fight, s_theft, s_benign = (float(s) for s in sims)
        best, label = s_weapon, WEAPON
        if s_fight > best:
            best, label = s_fight, FIGHT
        if s_theft > best:
            best, label = s_theft, THEFT
        margin = best - s_benign
        score = max(0.0, min(1.0, margin / MARGIN_FULL))
        if margin < MARGIN_LABEL:
            label = ""
        return VadScore(score, label)


def _crop_rgb(image, x: float, y: float, w: float, h: float, pad: float = 0.20):
    import numpy as np

    arr = np.asarray(image)
    if arr.ndim != 3 or arr.shape[2] < 3:
        return None
    H, W = arr.shape[:2]
    if w < 8 or h < 8:
        return None
    px, py = w * pad, h * pad
    x1 = max(0, int(x - px))
    y1 = max(0, int(y - py))
    x2 = min(W, int(x + w + px))
    y2 = min(H, int(y + h + py))
    if x2 - x1 < 8 or y2 - y1 < 8:
        return None
    return arr[y1:y2, x1:x2, :3]
