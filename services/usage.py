"""Per-window AI usage counters for the `usage.tick` event.

Thread-safe: vision, ZRT and voice run in worker threads. The api hub
calls swap() every 10 s and publishes the window (per-window counts, never
running totals). Self-check: python -m services.usage
"""

from __future__ import annotations

import threading
from typing import Any

_lock = threading.Lock()
_counts: dict[str, dict[str, float]] = {}


def add(model_id: str, **fields: float) -> None:
    """Add counts for one model, e.g. add("yolo26s-pose", frames=6)."""
    if not model_id:
        return
    with _lock:
        row = _counts.setdefault(model_id, {})
        for key, value in fields.items():
            if value:
                row[key] = row.get(key, 0) + value


def swap() -> dict[str, dict[str, Any]]:
    """Return the counts since the last swap and start a new window."""
    global _counts
    with _lock:
        out, _counts = _counts, {}
    return {m: {k: (round(v, 2) if isinstance(v, float) else v) for k, v in row.items()} for m, row in out.items() if row}


if __name__ == "__main__":
    add("m", requests=1, tokens_in=10)
    add("m", requests=1, tokens_out=0)
    add("", frames=3)
    assert swap() == {"m": {"requests": 2, "tokens_in": 10}}
    assert swap() == {}
    print("usage self-check OK")
