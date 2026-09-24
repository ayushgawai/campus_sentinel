"""Brain service package — adjudicate, calibrate, state machine (Ayush)."""

from .adjudicate import EscalateRequest, EscalateResult, adjudicate
from .audit import AuditEntry, AuditLog
from .fuse import fuse_probs, logprob_to_prob
from .sampler import sample_from_timestamps, sample_indices
from .state_machine import StateMachine
from .thresholds import severity_from_fused
from .zrt_client import ClassifyResult, ZRTClient

__all__ = [
    "AuditEntry",
    "AuditLog",
    "ClassifyResult",
    "EscalateRequest",
    "EscalateResult",
    "StateMachine",
    "ZRTClient",
    "adjudicate",
    "fuse_probs",
    "logprob_to_prob",
    "sample_from_timestamps",
    "sample_indices",
    "severity_from_fused",
]
