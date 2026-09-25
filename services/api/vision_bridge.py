"""Optional Seville vision → brain → WS bridge (GPU-throttled).

  CS_VISION_SEVILLE=1 services/vision/.venv/bin/python -m services.api

Safety knobs (keep the ZGX stable — do NOT also run run_seville.py):
  CS_VISION_STEP_S=0.5     sleep between router steps (default 0.5)
  CS_VISION_COOLDOWN_S=600 min seconds between upserts per track
  CS_VISION_MAX_UPSERTS_MIN=1  hard cap live Qwen calls per rolling minute
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import replace
from pathlib import Path
from typing import TYPE_CHECKING, Any

from contracts import BBox, IncidentClass, IncidentUpsert, OverlayBoxes, Severity
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
DEMO_PERSON = "Adult in dark clothing carrying a long firearm."


def _cooldown_s() -> float:
    return float(os.environ.get("CS_VISION_COOLDOWN_S", "600"))


def _step_s() -> float:
    return float(os.environ.get("CS_VISION_STEP_S", "0.5"))


def _max_upserts_per_min() -> int:
    return int(os.environ.get("CS_VISION_MAX_UPSERTS_MIN", "1"))


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
        self._classify_task: asyncio.Task[None] | None = None
        self._classify_q: asyncio.Queue[Any] | None = None
        self._last_fire: dict[tuple[str, str], float] = {}
        self._upsert_times: list[float] = []
        self._need_align = False
        self._last_align_req = 0.0
        self._pause_t: float | None = None
        self._src: Any = None
        self._qwen_started = False
        self._cached_record: Any = None
        self._last_camera: str | None = None

    def start(self) -> None:
        if self._task is not None:
            return
        self._task = asyncio.create_task(self._run(), name="vision-seville")

    def align_to_wall(self) -> None:
        """ffmpeg -re just opened from t=0. Rewind YOLO to the same second."""
        now = time.monotonic()
        if now - self._last_align_req < 2.0:
            return
        self._last_align_req = now
        self._need_align = True

    def _reset_demo(self) -> None:
        self._qwen_started = False
        self._cached_record = None
        self._last_camera = None
        self._last_fire.clear()
        self._upsert_times.clear()

    async def stop(self) -> None:
        if self._classify_q is not None:
            try:
                self._classify_q.put_nowait(None)
            except Exception:
                pass
        for task in (self._task, self._classify_task):
            if task is None:
                continue
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        self._task = None
        self._classify_task = None

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
        windows = {
            c["camera_id"]: c["live_windows_s"]
            for c in feed["cameras"]
            if c.get("live_windows_s")
        }
        src = FileSource(paths, realtime=True, active_windows=windows)
        self._src = src
        # ONE VisionRouter for the process lifetime — recreating reloads YOLO.
        router = VisionRouter(list(paths), forced=False, source=src)
        zrt = ZRTClient(forced=False, timeout_s=90.0)
        self._classify_q = asyncio.Queue(maxsize=1)
        self._classify_task = asyncio.create_task(
            self._classify_loop(zrt), name="vision-classify"
        )
        width = float(getattr(src, "width", 960) or 960)
        height = float(getattr(src, "height", 540) or 540)
        step = _step_s()
        print(
            f"[vision-bridge] started cams={list(paths)} {width:.0f}x{height:.0f} "
            f"step={step}s realtime=1 cooldown={_cooldown_s()}s "
            f"max_upserts/min={_max_upserts_per_min()}",
            flush=True,
        )
        loop = asyncio.get_running_loop()
        try:
            while True:
                if self.hub.paused:
                    if self._pause_t is None:
                        self._pause_t = time.monotonic()
                    await asyncio.sleep(0.5)
                    continue
                if self._pause_t is not None:
                    src.shift_wall(time.monotonic() - self._pause_t)
                    self._pause_t = None
                if self._need_align:
                    print("[vision-bridge] align FileSource to ffmpeg -re t=0", flush=True)
                    src.rewind()
                    router.source = src
                    self._src = src
                    self._need_align = False
                    width = float(getattr(src, "width", width) or width)
                    height = float(getattr(src, "height", height) or height)
                t0 = time.perf_counter()
                ovs, packed = await loop.run_in_executor(
                    None, self._step, router
                )
                step_ms = (time.perf_counter() - t0) * 1000.0
                if not ovs:
                    print(
                        "[vision-bridge] EOF — rewind FileSource (keep YOLO warm)",
                        flush=True,
                    )
                    self._reset_demo()
                    src.close()
                    src = FileSource(paths, realtime=True, active_windows=windows)
                    router.source = src
                    self._src = src
                    width = float(getattr(src, "width", width) or width)
                    height = float(getattr(src, "height", height) or height)
                    await asyncio.sleep(1.0)
                    continue
                telemetry.ROUTER_LATENCY.record(step_ms)
                for ov in ovs:
                    remapped = OverlayBoxes(
                        camera_id=normalize_camera_id(ov.camera_id),
                        ts=ov.ts,
                        boxes=_norm_boxes(list(ov.boxes), width, height),
                    )
                    await self.hub.publish(remapped)
                for mode, esc, frames in packed:
                    if mode == "reuse":
                        record = self._reuse_record(esc)
                        if record is not None:
                            await self.hub.publish(IncidentUpsert(incident=record))
                        continue
                    if self._classify_q is None:
                        break
                    try:
                        self._classify_q.put_nowait((esc, frames))
                    except asyncio.QueueFull:
                        print("[vision-bridge] classify queue full — drop", flush=True)
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

    def _step(
        self, router: Any
    ) -> tuple[list[Any], list[tuple[str, Any, list[Any]]]]:
        ovs = router.step()
        packed: list[tuple[str, Any, list[Any]]] = []
        for esc in router.last_escalations:
            cam = normalize_camera_id(esc.camera_id)
            if self._qwen_started:
                if cam != self._last_camera:
                    self._last_camera = cam
                    packed.append(("reuse", esc, []))
                continue
            if cam != "cam-01":
                continue
            if not self._should_fire(cam, esc.track_id):
                continue
            self._qwen_started = True
            self._last_camera = cam
            frames: list[Any] = []
            try:
                bundle = router.bundle(
                    esc.camera_id,
                    peak_ts=esc.ts,
                    track_id=esc.track_id,
                )
                frames = list(bundle.images)
            except Exception as exc:
                print(f"[vision-bridge] bundle failed: {exc}", flush=True)
            packed.append(("classify", esc, frames))
        return ovs, packed

    def _reuse_record(self, esc: Any) -> Any:
        if self._cached_record is None:
            return None
        cam = normalize_camera_id(esc.camera_id)
        now = self._cached_record.updated_at.__class__.now(
            self._cached_record.updated_at.tzinfo
        )
        self._cached_record = replace(
            self._cached_record,
            camera_id=cam,
            track_id=str(esc.track_id),
            peak_ts=esc.ts,
            router_score=float(esc.fused),
            description=f"weapon tracked on {cam} [zrt-cached]",
            location_text=cam,
            updated_at=now,
            rules_fired=list(getattr(esc, "rules", []) or []),
        )
        return self._cached_record

    async def _classify_loop(self, zrt: ZRTClient) -> None:
        assert self._classify_q is not None
        loop = asyncio.get_running_loop()
        while True:
            item = await self._classify_q.get()
            if item is None:
                return
            esc, frames = item
            try:
                result, live_ok = await loop.run_in_executor(
                    None, self._classify_one, zrt, esc, frames
                )
            except Exception as exc:
                print(f"[vision-bridge] classify failed: {exc}", flush=True)
                continue
            self.hub.frames_escalated += 1
            self._cached_record = result.record
            await self.hub.publish(IncidentUpsert(incident=result.record))
            print(
                f"[vision-bridge] upsert {result.record.incident_id} "
                f"{result.record.class_token.value} "
                f"sev={result.record.severity.value} "
                f"fused={result.fused_prob:.3f} "
                f"router={esc.fused:.3f} "
                f"vadclip={getattr(esc, 'vadclip', 0):.3f} "
                f"live={live_ok}",
                flush=True,
            )

    @staticmethod
    def _classify_one(
        zrt: ZRTClient, esc: Any, frames: list[Any]
    ) -> tuple[Any, bool]:
        req = escalate_request_from_vision(
            esc, frames=frames, person_description=DEMO_PERSON
        )
        live_ok = bool(frames) and zrt.health()
        if live_ok:
            req.class_token_forced = None
            zrt_use = zrt
        else:
            req.class_token_forced = class_hint_from_rules(req.rules_fired)
            zrt_use = ZRTClient(forced=True)
            print(
                f"[vision-bridge] fallback forced-classify "
                f"frames={len(frames)} zrt_ok={zrt.health()}",
                flush=True,
            )
        result = adjudicate(req, zrt=zrt_use)
        if result.record.class_token is IncidentClass.WEAPON:
            result.record.severity = Severity.SEVERE
        return result, live_ok
