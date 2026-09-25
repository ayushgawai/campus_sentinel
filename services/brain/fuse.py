"""Fuse router score with calibrated VLM probability (playbook D).

Plain code — never done inside the model prompt.
"""

from __future__ import annotations

import math
import os


def logprob_to_prob(logprob: float) -> float:
    """Map a token logprob into (0, 1]. Forced mode uses logprob=0 → ~1.0."""
    try:
        return max(0.0, min(1.0, math.exp(logprob)))
    except OverflowError:
        return 1.0 if logprob > 0 else 0.0


def vlm_temperature() -> float:
    """CS_VLM_TEMPERATURE from scripts/fit_temperature.py; 1.0 = uncalibrated."""
    try:
        t = float(os.environ.get("CS_VLM_TEMPERATURE", "1.0"))
    except ValueError:
        return 1.0
    return t if t > 0 else 1.0


def apply_temperature(prob: float, temperature: float) -> float:
    """Binary confidence temperature scaling: sigmoid(logit(p) / T)."""
    if temperature == 1.0:
        return prob
    p = min(max(prob, 1e-6), 1 - 1e-6)
    z = math.log(p / (1 - p)) / temperature
    return 1.0 / (1.0 + math.exp(-z))


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
