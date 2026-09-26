"""Live "what is working right now" registry for the `activity.tick` event.

Components report either work in flight (`busy`, e.g. a Qwen request) or a
gauge (`pulse`, e.g. 6 people tracked). The hub broadcasts a snapshot every
second in pipeline order, so the dashboard shows every stage that is
active at once. Thread-safe: vision, Qwen and voice run in worker threads.
"""

from __future__ import annotations

import threading
import time
from contextlib import contextmanager
from typing import Iterator

# Pipeline order (camera to phone): id, name, role, unit of `count`.
STAGES: tuple[tuple[str, str, str, str], ...] = (
    ("decode", "Camera decode", "Reads cameras 1-3", "cameras"),
    ("yolo", "YOLO26s-pose", "Detects people", "frames in batch"),
    ("bytetrack", "ByteTrack", "Tracks each person", "people tracked"),
    ("weapons", "Weapon timeline", "Marks who is armed", "armed"),
    ("clip", "CLIP ViT-B/16", "Scores anomalies", "in flight"),
    ("qwen", "Qwen3-VL", "Classifies and answers", "requests in flight"),
    ("signalwire", "SignalWire", "Phone call to dispatch", "live calls"),
    ("asr", "faster-whisper", "Transcribes the dispatcher", "in flight"),
    ("elevenlabs", "ElevenLabs", "Speaks on the call", "in flight"),
    ("kokoro", "Kokoro", "Speaks on the call (local)", "in flight"),
    ("stream", "Live wall", "Streams video to viewers", "viewers"),
)
ACTIVE_S = 1.5

_lock = threading.Lock()
_inflight: dict[str, int] = {}
_gauge: dict[str, int] = {}
_last: dict[str, float] = {}


@contextmanager
def busy(stage: str) -> Iterator[None]:
    """Count one unit of work in flight for `stage` while the block runs."""
    with _lock:
        _inflight[stage] = _inflight.get(stage, 0) + 1
        _last[stage] = time.monotonic()
    try:
        yield
    finally:
        with _lock:
            _inflight[stage] = max(0, _inflight.get(stage, 1) - 1)
            _last[stage] = time.monotonic()


def pulse(stage: str, count: int | None = None) -> None:
    """Mark `stage` as working now; `count` sets its gauge (0 = idle)."""
    with _lock:
        if count is not None:
            _gauge[stage] = int(count)
        if count is None or count > 0:
            _last[stage] = time.monotonic()


def snapshot() -> list[dict]:
    now = time.monotonic()
    out = []
    with _lock:
        for sid, name, role, unit in STAGES:
            inflight = _inflight.get(sid, 0)
            count = inflight or _gauge.get(sid, 0)
            last = _last.get(sid)
            ago = None if last is None else round(now - last, 1)
            out.append(
                {
                    "id": sid,
                    "name": name,
                    "role": role,
                    "unit": unit,
                    "count": count,
                    "active": inflight > 0 or (ago is not None and ago <= ACTIVE_S),
                    "last_s": ago,
                }
            )
    return out


def reset() -> None:
    with _lock:
        _inflight.clear()
        _gauge.clear()
        _last.clear()


if __name__ == "__main__":
    reset()
    with busy("qwen"):
        with busy("qwen"):
            row = {r["id"]: r for r in snapshot()}["qwen"]
            assert row["count"] == 2 and row["active"], row
    pulse("bytetrack", 6)
    rows = {r["id"]: r for r in snapshot()}
    assert rows["qwen"]["count"] == 0 and rows["qwen"]["active"]  # just finished
    assert rows["bytetrack"]["count"] == 6 and rows["bytetrack"]["active"]
    assert rows["signalwire"]["active"] is False and rows["signalwire"]["last_s"] is None
    assert [r["id"] for r in snapshot()][0] == "decode"
    print("activity self-check OK")
