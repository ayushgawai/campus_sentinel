"""Parakeet ASR stub — swap for local NeMo Parakeet when Naman lands the serve.

transcribe(pcm16_mono_16k) -> str
Target p95 < 800 ms for a short utterance.
"""

from __future__ import annotations

import os
from typing import Protocol


class AsrBackend(Protocol):
    def transcribe(self, pcm16_mono_16k: bytes) -> str: ...


class StubParakeet:
    """Returns empty string until CS_PARAKEET_URL or local weights are set."""

    def transcribe(self, pcm16_mono_16k: bytes) -> str:
        if not pcm16_mono_16k:
            return ""
        # Ready hook: POST raw PCM to a local serve when env is set.
        url = os.environ.get("CS_PARAKEET_URL", "").strip()
        if not url:
            return ""
        import urllib.request

        req = urllib.request.Request(
            url,
            data=pcm16_mono_16k,
            headers={"Content-Type": "application/octet-stream"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read().decode("utf-8", errors="replace").strip()


def get_asr() -> AsrBackend:
    return StubParakeet()
