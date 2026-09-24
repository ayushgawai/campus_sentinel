"""Optional Seville vision → brain → WS bridge.

Enabled with CS_VISION_SEVILLE=1. Heavy deps stay in services/vision/.venv:

  CS_VISION_SEVILLE=1 services/vision/.venv/bin/python -m services.api

Dedupes escalations per (camera_id, track_id) for CS_VISION_COOLDOWN_S seconds.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

from contracts import IncidentUpsert, OverlayBoxes
from services.brain.adjudicate import adjudicate
from services.brain.from_vision import escalate_request_from_vision, normalize_camera_id
from services.brain.zrt_client import ZRTClient

if TYPE_CHECKING:
    from .hub import DemoHub

ROOT = Path(__file__).resolve().parents[2]
FEED = ROOT / "data" / "feeds" / "seville_option1_3cam_locked.json"
COOLDOWN_S = float(os.environ.get("CS_VISION_COOLDOWN_S", "8"))


def vision_enabled() -> bool:
    return os.environ.get("CS_VISION_SEVILLE", "").strip().lower() in {"1", "true", "yes"}


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


class VisionBridge:
    def __init__(self, hub: DemoHub) -> None:
        self.hub = hub
        self._task: asyncio.Task[None] | None = None
        self._last_fire: dict[tuple[str, str], float] = {}

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
        except asyncio.CancelledError:
            pass
        self._task = None

    def _should_fire(self, camera_id: str, track_id: str) -> bool:
        key = (camera_id, track_id)
        now = time.monotonic()
        prev = self._last_fire.get(key, 0.0)
        if now - prev < COOLDOWN_S:
            return False
        self._last_fire[key] = now
        return True

    async def _run(self) -> None:
        from services.vision.decode import FileSource
        from services.vision.pipeline import VisionRouter

        feed = json.loads(FEED.read_text())
        media = _resolve_media(feed)
        paths = {c["camera_id"]: str(media / c["file"]) for c in feed["cameras"]}
        src = FileSource(paths)
        router = VisionRouter(list(paths), forced=False, source=src)
        zrt = ZRTClient(forced=True)
        print(
            f"[vision-bridge] started cams={list(paths)} media={media} "
            f"cooldown={COOLDOWN_S}s",
            flush=True,
        )
        loop = asyncio.get_running_loop()
        try:
            while True:
                if self.hub.paused:
                    await asyncio.sleep(0.2)
                    continue
                ovs, escalations = await loop.run_in_executor(None, self._step, router)
                if not ovs:
                    print("[vision-bridge] EOF — restarting FileSource", flush=True)
                    src.close()
                    src = FileSource(paths)
                    router = VisionRouter(list(paths), forced=False, source=src)
                    continue
                for ov in ovs:
                    remapped = OverlayBoxes(
                        camera_id=normalize_camera_id(ov.camera_id),
                        ts=ov.ts,
                        boxes=list(ov.boxes),
                    )
                    await self.hub.publish(remapped)
                for esc in escalations:
                    cam = normalize_camera_id(esc.camera_id)
                    if not self._should_fire(cam, esc.track_id):
                        continue
                    req = escalate_request_from_vision(esc)
                    result = adjudicate(req, zrt=zrt)
                    self.hub.frames_escalated += 1
                    await self.hub.publish(IncidentUpsert(incident=result.record))
                self.hub.frames_screened += max(1, len(ovs))
                await asyncio.sleep(0)
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
