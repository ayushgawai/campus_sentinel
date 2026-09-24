"""Router fusion — short weighted sum, one loose threshold (playbook C.7)."""

from __future__ import annotations

from .rules import FALL, LONG_DWELL, RUN, SUDDEN_ACCEL

# Tuned loose on purpose: a wrong escalate costs GPU seconds; a miss is forever.
# VadCLIP is on so FIGHT/THEFT can escalate without a pose rule.
W_DET = 0.20
W_FALL = 0.40
W_WEAPON = 0.45  # Seville primary
W_RUN = 0.20
W_ACCEL = 0.10
W_DWELL = 0.10
W_VADCLIP = 0.40
ESCALATE_AT = 0.40


def fuse(
    det_score: float,
    rules: list[str],
    *,
    vadclip: float = 0.0,
) -> float:
    s = W_DET * max(0.0, min(1.0, det_score))
    s += W_FALL * float(FALL in rules)
    s += W_WEAPON * float("weapon" in rules)
    s += W_RUN * float(RUN in rules)
    s += W_ACCEL * float(SUDDEN_ACCEL in rules)
    s += W_DWELL * float(LONG_DWELL in rules)
    s += W_VADCLIP * max(0.0, min(1.0, vadclip))
    return min(s, 1.0)


def should_escalate(fused: float) -> bool:
    return fused >= ESCALATE_AT
