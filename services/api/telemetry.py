"""Measured runtime telemetry for the health strip.

Nothing in here is a constant. When a source is unavailable the getter returns
None and the wire carries null, because a missing measurement must never render
as a low reading — that is exactly how the old hardcoded gpu_util=0.68 and
p95_ms=182.0 managed to look like live telemetry for a day.

Sampling is TTL-cached so the 1 Hz health loop does not fork a subprocess or
open a socket on every tick. The blocking helpers are private; call the async
`sample()` from the event loop.
"""

from __future__ import annotations

import asyncio
import math
import shutil
import subprocess
import time
from collections import deque
from dataclasses import dataclass

# nvidia-smi is cheap but not free; 2s is well under the health tick rate.
_GPU_TTL_S = 2.0
# ZRT health is an HTTP round trip to :8000; models do not unload second to second.
_ZRT_TTL_S = 5.0
_SMI_TIMEOUT_S = 1.5


class LatencyWindow:
    """Rolling samples of real work → measured p95.

    Fed with router step duration only. Adjudicate is a seconds-scale path that
    runs rarely by design, so mixing it in would swamp the percentile the strip
    is meant to report.
    """

    def __init__(self, maxlen: int = 256) -> None:
        self._samples: deque[float] = deque(maxlen=maxlen)

    def record(self, ms: float) -> None:
        if ms >= 0.0 and math.isfinite(ms):
            self._samples.append(float(ms))

    def clear(self) -> None:
        self._samples.clear()

    def p95(self) -> float | None:
        """Nearest-rank p95, or None while no work has been measured yet."""
        n = len(self._samples)
        if n == 0:
            return None
        ordered = sorted(self._samples)
        idx = min(n - 1, max(0, math.ceil(0.95 * n) - 1))
        return round(ordered[idx], 1)

    def __len__(self) -> int:
        return len(self._samples)


# Shared by the vision bridge (producer) and the hub (reporter).
ROUTER_LATENCY = LatencyWindow()


@dataclass
class _Cache:
    value: object = None
    at: float = 0.0
    fresh: bool = False


_gpu_cache = _Cache()
_zrt_cache = _Cache()
# Set once when the binary is simply not on this machine — stop shelling out.
_smi_missing = False


def _gpu_util_blocking() -> float | None:
    """GPU load as a 0..1 fraction from nvidia-smi, or None if unreadable."""
    global _smi_missing
    if _smi_missing:
        return None
    smi = shutil.which("nvidia-smi")
    if smi is None:
        _smi_missing = True
        return None
    try:
        proc = subprocess.run(
            [
                smi,
                "--query-gpu=utilization.gpu",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=_SMI_TIMEOUT_S,
            check=False,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    if proc.returncode != 0:
        return None
    for line in proc.stdout.splitlines():
        raw = line.strip()
        if not raw:
            continue
        try:
            pct = float(raw)
        except ValueError:
            return None
        return max(0.0, min(1.0, pct / 100.0))
    return None


def _zrt_resident_blocking() -> bool:
    """True only when the VLM actually answers on :8000.

    A forced ZRTClient always self-reports healthy, so this builds a live one.
    """
    try:
        from services.brain.zrt_client import ZRTClient

        return bool(ZRTClient(forced=False, timeout_s=3.0).health())
    except Exception:
        return False


def _cached(cache: _Cache, ttl: float, now: float) -> bool:
    return cache.fresh and (now - cache.at) < ttl


async def sample() -> tuple[float | None, float | None, bool]:
    """(gpu_util, p95_ms, models_resident) — all measured, gpu/p95 may be None."""
    now = time.monotonic()

    if not _cached(_gpu_cache, _GPU_TTL_S, now):
        _gpu_cache.value = await asyncio.to_thread(_gpu_util_blocking)
        _gpu_cache.at = now
        _gpu_cache.fresh = True

    if not _cached(_zrt_cache, _ZRT_TTL_S, now):
        _zrt_cache.value = await asyncio.to_thread(_zrt_resident_blocking)
        _zrt_cache.at = now
        _zrt_cache.fresh = True

    gpu = _gpu_cache.value
    return (
        gpu if isinstance(gpu, float) else None,
        ROUTER_LATENCY.p95(),
        bool(_zrt_cache.value),
    )


def reset() -> None:
    """Drop measurements so a demo reset does not carry stale latency forward."""
    ROUTER_LATENCY.clear()
    for cache in (_gpu_cache, _zrt_cache):
        cache.value = None
        cache.at = 0.0
        cache.fresh = False
