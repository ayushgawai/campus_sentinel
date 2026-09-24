"""Optional Seville vision → brain → WS bridge (GPU-throttled).

  CS_VISION_SEVILLE=1 services/vision/.venv/bin/python -m services.api

Safety knobs (keep the ZGX stable — do NOT also run run_seville.py):
  CS_VISION_STEP_S=0.4     sleep between router steps (default 0.4)
  CS_VISION_COOLDOWN_S=12  min seconds between upserts per track
  CS_VISION_MAX_UPSERTS_MIN=8  hard cap upserts per rolling minute
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

from contracts import BBox, IncidentUpsert, OverlayBoxes
from services.api import telemetry
from services.brain.adjudicate import adjudicate
from services.brain.from_vision import (
    class_hint_from_rules,
    escalate_request_from_vision,
    normalize_camera_id,
)
from services.brain.zrt_client import ZRTClient

if TYPE_CHECKING:
    from .hub import DemoHub

ROOT = Path(__file__).resolve().parents[2]
FEED = ROOT / "data" / "feeds" / "seville_option1_3cam_locked.json"


def _cooldown_s() -> float:
    return float(os.environ.get("CS_VISION_COOLDOWN_S", "12"))


def _step_s() -> float:
    return float(os.environ.get("CS_VISION_STEP_S", "0.4"))


def _max_upserts_per_min() -> int:
    return int(os.environ.get("CS_VISION_MAX_UPSERTS_MIN", "8"))


def vision_enabled() -> bool:
    return os.environ.get("CS_VISION_SEVILLE", "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


def _resolve_media(feed: dict) -> Path:
    roots = feed.get("media_root") or {}
    for key in ("zgx", "mac_mount"):
        raw = roots.get(key)
        if not raw:
            continue
        path = Path(raw).expanduser()
        if path.is_dir():
            return path
    raise FileNotFoundError("Seville media_root not found")


def _norm_boxes(boxes: list[Any], width: float, height: float) -> list[BBox]:
    """YOLO tracks are pixel xywh; the dashboard expects 0..1 fractions."""
    w = max(float(width), 1.0)
    h = max(float(height), 1.0)
    out: list[BBox] = []
    for b in boxes:
        out.append(
            BBox(
                x=max(0.0, min(1.0, float(b.x) / w)),
                y=max(0.0, min(1.0, float(b.y) / h)),
                w=max(0.0, min(1.0, float(b.w) / w)),
                h=max(0.0, min(1.0, float(b.h) / h)),
                track_id=str(b.track_id),
                label=getattr(b, "label", "") or "person",
                score=getattr(b, "score", None),
            )
        )
    return out


class VisionBridge:
    def __init__(self, hub: DemoHub) -> None:
        self.hub = hub
        self._task: asyncio.Task[None] | None = None
        self._last_fire: dict[tuple[str, str], float] = {}
        self._upsert_times: list[float] = []

    def start(self) -> None:
        if self._task is not None:
            return
        self._task = asyncio.create_task(self._run(), name="vision-seville")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except (asyncio.CancelledError, Exception):
            pass
        self._task = None

    def _should_fire(self, camera_id: str, track_id: str) -> bool:
        key = (camera_id, track_id)
        now = time.monotonic()
        # rolling per-minute cap — protects queue + GPU adjudicate spam
        self._upsert_times = [t for t in self._upsert_times if now - t < 60.0]
        if len(self._upsert_times) >= _max_upserts_per_min():
            return False
        prev = self._last_fire.get(key, 0.0)
        if now - prev < _cooldown_s():
            return False
        self._last_fire[key] = now
        self._upsert_times.append(now)
        return True

    async def _run(self) -> None:
        from services.vision.decode import FileSource
        from services.vision.pipeline import VisionRouter

        feed = json.loads(FEED.read_text())
        media = _resolve_media(feed)
        paths = {c["camera_id"]: str(media / c["file"]) for c in feed["cameras"]}
        src = FileSource(paths)
        # ONE VisionRouter for the process lifetime — recreating reloads TensorRT
        # and has knocked this box over before.
        router = VisionRouter(list(paths), forced=False, source=src)
        zrt = ZRTClient(forced=False, timeout_s=90.0)
        width = float(getattr(src, "width", 960) or 960)
        height = float(getattr(src, "height", 540) or 540)
        step = _step_s()
        print(
            f"[vision-bridge] started cams={list(paths)} {width:.0f}x{height:.0f} "
            f"step={step}s cooldown={_cooldown_s()}s "
            f"max_upserts/min={_max_upserts_per_min()}",
            flush=True,
        )
        loop = asyncio.get_running_loop()
        try:
            while True:
                if self.hub.paused:
                    await asyncio.sleep(0.5)
                    continue
                t0 = time.perf_counter()
                ovs, escalations = await loop.run_in_executor(
                    None, self._step, router
                )
                step_ms = (time.perf_counter() - t0) * 1000.0
                if not ovs:
                    print(
                        "[vision-bridge] EOF — rewind FileSource (keep TRT warm)",
                        flush=True,
                    )
                    src.close()
                    src = FileSource(paths)
                    router.source = src
                    width = float(getattr(src, "width", width) or width)
                    height = float(getattr(src, "height", height) or height)
                    await asyncio.sleep(1.0)
                    continue
                # Real screening cost — feeds the p95 on the health strip.
                # Recorded after the EOF branch so rewinds do not skew it.
                telemetry.ROUTER_LATENCY.record(step_ms)
                for ov in ovs:
                    remapped = OverlayBoxes(
                        camera_id=normalize_camera_id(ov.camera_id),
                        ts=ov.ts,
                        boxes=_norm_boxes(list(ov.boxes), width, height),
                    )
                    await self.hub.publish(remapped)
                for esc in escalations:
                    cam = normalize_camera_id(esc.camera_id)
                    if not self._should_fire(cam, esc.track_id):
                        continue
                    frames = []
                    try:
                        bundle = router.bundle(
                            esc.camera_id,
                            peak_ts=esc.ts,
                            track_id=esc.track_id,
                        )
                        frames = list(bundle.images)
                    except Exception as exc:
                        print(f"[vision-bridge] bundle failed: {exc}", flush=True)
                    req = escalate_request_from_vision(esc, frames=frames)
                    # Live path: frames + healthy ZRT/Qwen — never force a class token.
                    # Offline fallback only when bundle empty or ZRT down.
                    live_ok = bool(frames) and zrt.health()
                    if live_ok:
                        req.class_token_forced = None
                        zrt_use = zrt
                    else:
                        req.class_token_forced = class_hint_from_rules(
                            req.rules_fired
                        )
                        zrt_use = ZRTClient(forced=True)
                        print(
                            f"[vision-bridge] fallback forced-classify "
                            f"frames={len(frames)} zrt_ok={zrt.health()}",
                            flush=True,
                        )
                    result = adjudicate(req, zrt=zrt_use)
                    self.hub.frames_escalated += 1
                    await self.hub.publish(IncidentUpsert(incident=result.record))
                    print(
                        f"[vision-bridge] upsert {result.record.incident_id} "
                        f"{result.record.class_token.value} "
                        f"sev={result.record.severity.value} "
                        f"fused={result.fused_prob:.3f} "
                        f"router={req.router_score:.3f} "
                        f"vadclip={getattr(esc, 'vadclip', 0):.3f} "
                        f"live={live_ok}",
                        flush=True,
                    )
                # One decoded frame per camera per step — count them, do not round up.
                self.hub.frames_screened += len(ovs)
                await asyncio.sleep(step)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"[vision-bridge] stopped: {exc}", flush=True)
        finally:
            try:
                src.close()
            except Exception:
                pass

    @staticmethod
    def _step(router: Any) -> tuple[list[Any], list[Any]]:
        ovs = router.step()
        return ovs, list(router.last_escalations)
