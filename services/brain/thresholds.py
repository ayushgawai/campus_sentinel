"""Map fused_prob → Severity (playbook E: plain code, three outcomes).

Threshold numbers are PLACEHOLDERS until Naman's precision curve lands.
Callers must pass allow_placeholder=True to acknowledge that.
"""

from __future__ import annotations

from contracts import Severity

# PLACEHOLDER — TBD-from-bench. Not operational.
PLACEHOLDER_MINOR_AT = 0.55
PLACEHOLDER_SEVERE_AT = 0.85


def severity_from_fused(
    fused_prob: float,
    *,
    allow_placeholder: bool = False,
) -> Severity:
    if not allow_placeholder:
        raise RuntimeError(
            "severity thresholds are placeholders (TBD-from-bench); "
            "pass allow_placeholder=True only in tests/demos until calibrated"
        )
    if fused_prob >= PLACEHOLDER_SEVERE_AT:
        return Severity.SEVERE
    if fused_prob >= PLACEHOLDER_MINOR_AT:
        return Severity.MINOR
    return Severity.NONE
