"""Precomputed weapon annotations for the demo feeds.

Live per-person weapon detection is not reliable on these 960x540 clips
(measured 2026-09-26: CLIP misses visible handguns and flags unarmed people,
YOLOE-26 never scores a weapon above 0.35, Qwen3-VL takes 1-2.7 s per frame).
The timeline comes from the dataset's hand-drawn weapon boxes matched to each
distinct clip frame (scripts/build_gt_weapon_timeline.py; the older Qwen
pass is scripts/build_weapon_timeline.py) and the router replays it by
clip time (seconds), so re-encoding the clips at another frame rate keeps
it valid. People, boxes and track ids stay live YOLO; only "who is
holding which weapon" comes from this file.
"""

from __future__ import annotations

import bisect
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT = ROOT / "data" / "feeds" / "seville_weapon_timeline.json"


def _hit(holder: list[float], weapon: list[float], box: tuple[float, float, float, float]) -> bool:
    """The track is the holder: weapon centre inside it, or holder box overlaps it."""
    x, y, w, h = box
    cx, cy = (weapon[0] + weapon[2]) / 2, (weapon[1] + weapon[3]) / 2
    if x <= cx <= x + w and y <= cy <= y + h:
        return True
    ix = max(0.0, min(x + w, holder[2]) - max(x, holder[0]))
    iy = max(0.0, min(y + h, holder[3]) - max(y, holder[1]))
    inter = ix * iy
    union = w * h + (holder[2] - holder[0]) * (holder[3] - holder[1]) - inter
    return union > 0 and inter / union >= 0.3


class WeaponTimeline:
    def __init__(self, path: str | Path = DEFAULT) -> None:
        data = json.loads(Path(path).read_text())
        self._times: dict[str, list[float]] = {}
        self._weapons: dict[str, list[list[dict[str, Any]]]] = {}
        for cam, rows in data["cameras"].items():
            key = cam.lower()
            self._times[key] = [float(r["t"]) for r in rows]
            self._weapons[key] = [r["weapons"] for r in rows]

    def weapons_at(self, camera_id: str, t: float) -> list[dict[str, Any]]:
        """Weapons in the last annotated distinct frame at or before clip time t."""
        times = self._times.get(camera_id.lower())
        if not times:
            return []
        i = bisect.bisect_right(times, t + 1e-6) - 1
        return self._weapons[camera_id.lower()][i] if i >= 0 else []

    def armed(
        self, camera_id: str, t: float, tracks: list[Any]
    ) -> dict[str, str]:
        """track_id -> weapon type for tracks holding a weapon at clip time t."""
        out: dict[str, str] = {}
        for wpn in self.weapons_at(camera_id, t):
            # In a crowd several boxes overlap the weapon: the tightest one holds it.
            hits = [tr for tr in tracks if _hit(wpn["holder"], wpn["box"], (tr.x, tr.y, tr.w, tr.h))]
            if hits:
                out[min(hits, key=lambda tr: tr.w * tr.h).track_id] = wpn["type"]
        return out


def load_default() -> WeaponTimeline | None:
    return WeaponTimeline() if DEFAULT.is_file() else None
