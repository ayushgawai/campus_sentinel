"""Phone TTS: ElevenLabs (opt-in) with automatic local Kokoro fallback.

Enable with CS_TTS_PROVIDER=elevenlabs plus ELEVENLABS_API_KEY in `.env`.
ElevenLabs is asked for `ulaw_8000` — exactly the SignalWire media-stream
codec — so its bytes go straight onto the wire with no resampling. Any error,
timeout, empty body, or quota/auth rejection falls back to Kokoro for that
line; quota/auth failures also park ElevenLabs for a cooldown so a dead key
does not add a timeout to every sentence of a live call.

Free tier is 10,000 characters/month: short repeated lines (fillers, repeat
prompts) are cached in memory so they are billed once per process.
Stdlib only.
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from typing import Any

try:
    import audioop
except ImportError:  # pragma: no cover
    audioop = None  # type: ignore[assignment]

from .kokoro import TtsBackend, get_tts as get_kokoro

API_BASE = "https://api.elevenlabs.io/v1/text-to-speech"
DEFAULT_MODEL = "eleven_flash_v2_5"
# Premade "Sarah" (default voice set; library voices are blocked on free tier).
DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"
OUTPUT_FORMAT = "ulaw_8000"
_CACHE_MAX_CHARS = 48
_CACHE_MAX_ITEMS = 64
_PARK_S = 600.0


def _provider() -> str:
    return os.environ.get("CS_TTS_PROVIDER", "kokoro").strip().lower() or "kokoro"


def _key() -> str:
    return os.environ.get("ELEVENLABS_API_KEY", "").strip()


def _voice_id() -> str:
    return os.environ.get("CS_ELEVENLABS_VOICE_ID", "").strip() or DEFAULT_VOICE_ID


def _model() -> str:
    return os.environ.get("CS_ELEVENLABS_MODEL", "").strip() or DEFAULT_MODEL


def _timeout_s() -> float:
    try:
        return float(os.environ.get("CS_ELEVENLABS_TIMEOUT_S", "4"))
    except ValueError:
        return 4.0


def elevenlabs_active() -> bool:
    return _provider() == "elevenlabs" and bool(_key())


class ElevenLabsTts:
    """POST text -> ulaw_8000 bytes. Raises on any failure; caller falls back."""

    def synthesize_mulaw(self, text: str) -> bytes:
        url = f"{API_BASE}/{_voice_id()}/stream?output_format={OUTPUT_FORMAT}"
        body = json.dumps(
            {
                "text": text,
                "model_id": _model(),
                "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
            }
        ).encode()
        req = urllib.request.Request(
            url,
            data=body,
            headers={
                "xi-api-key": _key(),
                "Content-Type": "application/json",
                "Accept": "audio/basic",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=_timeout_s()) as resp:
            audio = resp.read()
        if not audio:
            raise ValueError("elevenlabs returned no audio")
        return audio


class PhoneTts:
    """What the media bridge speaks through. Returns 8 kHz mulaw."""

    def __init__(self, kokoro: TtsBackend | None = None, remote: Any = None) -> None:
        self.kokoro = kokoro or get_kokoro()
        self.remote = remote or ElevenLabsTts()
        self._cache: OrderedDict[str, bytes] = OrderedDict()
        self._lock = threading.Lock()
        self.last_provider = ""
        self.last_error = ""

    # Kept so callers that want PCM16 16 kHz (the old contract) still work.
    def synthesize(self, text: str) -> bytes:
        return self.kokoro.synthesize(text)

    def synthesize_mulaw(self, text: str) -> bytes:
        text = (text or "").strip()
        if not text:
            return b""
        if elevenlabs_active() and time.monotonic() >= _state["parked_until"]:
            audio = self._remote_cached(text)
            if audio:
                self.last_provider = "elevenlabs"
                return audio
        self.last_provider = "kokoro"
        try:
            pcm16 = self.kokoro.synthesize(text)
        except (OSError, ValueError):
            pcm16 = b""  # bridge plays its tone instead of dead air
        if not pcm16 or audioop is None:
            return b""
        pcm8k, _ = audioop.ratecv(pcm16, 2, 1, 16000, 8000, None)
        return audioop.lin2ulaw(pcm8k, 2)

    def prewarm(self, phrases: tuple[str, ...]) -> None:
        """Cache fixed fillers at call start: uncached ElevenLabs lines measured
        ~1.7-2 s to first audio from the ZGX, cached ones are instant."""
        if not elevenlabs_active():
            return
        for text in phrases:
            if time.monotonic() < _state["parked_until"]:
                return
            self._remote_cached(text.strip())

    def _remote_cached(self, text: str) -> bytes:
        cacheable = len(text) <= _CACHE_MAX_CHARS
        cache_key = f"{_voice_id()}|{_model()}|{text}"
        if cacheable:
            with self._lock:
                hit = self._cache.get(cache_key)
                if hit is not None:
                    self._cache.move_to_end(cache_key)
                    return hit
        try:
            audio = self.remote.synthesize_mulaw(text)
        except urllib.error.HTTPError as exc:
            # 401 bad key / quota_exceeded parks; 429 (concurrency) only skips this line.
            if exc.code in (401, 402, 403):
                _state["parked_until"] = time.monotonic() + _PARK_S
            self.last_error = f"http_{exc.code}"
            return b""
        except Exception as exc:  # timeout, DNS, empty body — fall back
            self.last_error = type(exc).__name__
            return b""
        self.last_error = ""
        if cacheable:
            with self._lock:
                self._cache[cache_key] = audio
                while len(self._cache) > _CACHE_MAX_ITEMS:
                    self._cache.popitem(last=False)
        return audio


# Process-wide: one live call at a time, and quota parking must outlive a call.
_state: dict[str, float] = {"parked_until": 0.0}
_shared: PhoneTts | None = None


def get_phone_tts() -> PhoneTts:
    global _shared
    if _shared is None:
        _shared = PhoneTts()
    return _shared


def status() -> dict[str, Any]:
    """Safe for /voice/status: no key material."""
    parked = max(0.0, _state["parked_until"] - time.monotonic())
    return {
        "provider": "elevenlabs" if elevenlabs_active() else "kokoro",
        "requested": _provider(),
        "elevenlabs_key": bool(_key()),
        "model": _model(),
        "voice_id": _voice_id(),
        "output_format": OUTPUT_FORMAT,
        "fallback": "kokoro",
        "parked_s": round(parked, 1),
        "last_provider": _shared.last_provider if _shared else "",
        "last_error": _shared.last_error if _shared else "",
    }
