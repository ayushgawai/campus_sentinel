"""Severity thresholds — bench hook (Naman path).

Until a real precision curve lands, PLACEHOLDER_* remain and callers must pass
allow_placeholder=True. When bench/thresholds.json exists, load it.
"""

from __future__ import annotations

import json
from pathlib import Path

from contracts import Severity

_ROOT = Path(__file__).resolve().parents[2]
_BENCH_FILE = _ROOT / "bench" / "thresholds.json"

# PLACEHOLDER — TBD-from-bench. Not operational without allow_placeholder.
PLACEHOLDER_MINOR_AT = 0.55
PLACEHOLDER_SEVERE_AT = 0.85

_MINOR_AT = PLACEHOLDER_MINOR_AT
_SEVERE_AT = PLACEHOLDER_SEVERE_AT
_LOADED_FROM_BENCH = False


def reload_thresholds(path: Path | None = None) -> bool:
    """Load bench/thresholds.json if present. Returns True if loaded."""
    global _MINOR_AT, _SEVERE_AT, _LOADED_FROM_BENCH
    p = path or _BENCH_FILE
    if not p.is_file():
        _LOADED_FROM_BENCH = False
        _MINOR_AT, _SEVERE_AT = PLACEHOLDER_MINOR_AT, PLACEHOLDER_SEVERE_AT
        return False
    data = json.loads(p.read_text())
    _MINOR_AT = float(data["minor_at"])
    _SEVERE_AT = float(data["severe_at"])
    _LOADED_FROM_BENCH = True
    return True


def using_bench() -> bool:
    return _LOADED_FROM_BENCH


def severity_from_fused(
    fused_prob: float,
    *,
    allow_placeholder: bool = False,
) -> Severity:
    if not _LOADED_FROM_BENCH and not allow_placeholder:
        raise RuntimeError(
            "severity thresholds are placeholders (TBD-from-bench); "
            "pass allow_placeholder=True only in tests/demos until calibrated, "
            "or add bench/thresholds.json"
        )
    if fused_prob >= _SEVERE_AT:
        return Severity.SEVERE
    if fused_prob >= _MINOR_AT:
        return Severity.MINOR
    return Severity.NONE


# Try load on import (no-op if missing).
reload_thresholds()
