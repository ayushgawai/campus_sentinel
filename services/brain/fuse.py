"""Fuse router score with calibrated VLM probability (playbook D).

Plain code — never done inside the model prompt.
"""

from __future__ import annotations

import math


def logprob_to_prob(logprob: float) -> float:
    """Map a token logprob into (0, 1]. Forced mode uses logprob=0 → ~1.0."""
    try:
        return max(0.0, min(1.0, math.exp(logprob)))
    except OverflowError:
        return 1.0 if logprob > 0 else 0.0


def fuse_probs(
    router_score: float,
    vlm_prob: float,
    *,
    w_router: float = 0.40,
    w_vlm: float = 0.60,
) -> float:
    """Weighted sum in [0, 1]. Defaults favour the VLM slightly."""
    if not 0.0 <= router_score <= 1.0:
        raise ValueError("router_score must be in [0, 1]")
    if not 0.0 <= vlm_prob <= 1.0:
        raise ValueError("vlm_prob must be in [0, 1]")
    return max(0.0, min(1.0, w_router * router_score + w_vlm * vlm_prob))
