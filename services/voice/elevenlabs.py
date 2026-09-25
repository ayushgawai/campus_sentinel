"""Phone TTS: ElevenLabs (opt-in) with automatic local Kokoro fallback.

Enable with CS_TTS_PROVIDER=elevenlabs plus ELEVENLABS_API_KEY in `.env`.
ElevenLabs is asked for `ulaw_8000` — exactly the SignalWire media-stream
codec — so its bytes go straight onto the wire with no resampling. Any error,
timeout, empty body, or quota/auth rejection falls back to Kokoro for that
line; quota/auth failures also park ElevenLabs for a cooldown so a dead key
does not add a timeout to every sentence of a live call.

Live call lines are streamed: the media bridge holds one keep-alive HTTPS
connection (warmed when the stream opens, so no TLS handshake per line) and
pushes each ulaw chunk onto the wire as it arrives. If the first chunk does not
arrive within CS_ELEVENLABS_FIRST_CHUNK_S the bridge abandons the stream and
speaks that line with Kokoro instead — never both.

Free tier is 10,000 characters/month: short repeated lines (fillers, repeat
prompts) are cached in memory so they are billed once per process.
Stdlib only.
"""

from __future__ import annotations

import http.client
import json
import os
import socket
import threading
import time
import urllib.error
from collections import OrderedDict
from typing import Any, Callable

try:
    import audioop
except ImportError:  # pragma: no cover
    audioop = None  # type: ignore[assignment]

from .kokoro import TtsBackend, get_tts as get_kokoro

API_HOST = "api.elevenlabs.io"
API_PATH = "/v1/text-to-speech"
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


def first_chunk_timeout_s() -> float:
    try:
        return float(os.environ.get("CS_ELEVENLABS_FIRST_CHUNK_S", "1.5"))
    except ValueError:
        return 1.5


def _latency_mode() -> str:
    # 0-4; 3 = max latency optimisations with the text normaliser still on.
    return os.environ.get("CS_ELEVENLABS_LATENCY", "").strip() or "3"


def elevenlabs_active() -> bool:
    return _provider() == "elevenlabs" and bool(_key())


ChunkFn = Callable[[bytes], bool]


class ElevenLabsTts:
    """Streaming POST text -> ulaw_8000 chunks over one keep-alive connection.

    Raises on any failure; caller falls back. One stream at a time per
    instance (the lock), so the media bridge owns its own instance.
    """

    def __init__(self) -> None:
        self._conn: http.client.HTTPSConnection | None = None
        self._lock = threading.Lock()

    def warm(self) -> None:
        """Open the TLS connection ahead of the first line. Bills nothing."""
        with self._lock:
            conn = self._connection()
            if conn.sock is None:
                try:
                    conn.connect()
                except OSError:
                    self._drop()

    def close(self) -> None:
        with self._lock:
            self._drop()

    def abort(self) -> None:
        """Unblock a stream stuck in recv from another thread (no lock)."""
        conn = self._conn
        sock = conn.sock if conn is not None else None
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def stream(self, text: str, on_chunk: ChunkFn) -> bool:
        """Push ulaw chunks to on_chunk as they arrive. on_chunk returning
        False stops early. Returns True if the full body was delivered."""
        with self._lock:
            resp = self._request(text)
            if resp.status != 200:
                resp.read()  # drain so the connection stays reusable
                raise urllib.error.HTTPError(
                    self._path(), resp.status, resp.reason, resp.headers, None
                )
            try:
                while True:
                    chunk = resp.read1(4096)
                    if not chunk:
                        return True
                    if not on_chunk(chunk):
                        self._drop()  # undrained body: connection is unusable
                        return False
            except BaseException:
                self._drop()
                raise

    def synthesize_mulaw(self, text: str) -> bytes:
        parts: list[bytes] = []
        self.stream(text, lambda chunk: parts.append(chunk) is None)
        audio = b"".join(parts)
        if not audio:
            raise ValueError("elevenlabs returned no audio")
        return audio

    def _path(self) -> str:
        return (
            f"{API_PATH}/{_voice_id()}/stream?output_format={OUTPUT_FORMAT}"
            f"&optimize_streaming_latency={_latency_mode()}"
        )

    def _connection(self) -> http.client.HTTPSConnection:
        if self._conn is None:
            self._conn = http.client.HTTPSConnection(API_HOST, timeout=_timeout_s())
        return self._conn

    def _drop(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def _request(self, text: str) -> http.client.HTTPResponse:
        body = json.dumps(
            {
                "text": text,
                "model_id": _model(),
                "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
            }
        ).encode()
        headers = {
            "xi-api-key": _key(),
            "Content-Type": "application/json",
            "Accept": "audio/basic",
        }
        for attempt in (0, 1):
            conn = self._connection()
            reused = conn.sock is not None
            try:
                conn.request("POST", self._path(), body=body, headers=headers)
                return conn.getresponse()
            except (ConnectionError, http.client.HTTPException):
                # A keep-alive the server already closed: reconnect once.
                self._drop()
                if attempt or not reused:
                    raise
            except BaseException:
                self._drop()
                raise
        raise AssertionError("unreachable")


class PhoneTts:
    """What the media bridge speaks through. Returns 8 kHz mulaw."""

    def __init__(
        self,
        kokoro: TtsBackend | None = None,
        remote: Any = None,
        remote_factory: Callable[[], Any] | None = None,
    ) -> None:
        self.kokoro = kokoro or get_kokoro()
        self.remote = remote or ElevenLabsTts()
        self._remote_factory = remote_factory or ElevenLabsTts
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
        if self._remote_usable():
            audio = self._remote_cached(text)
            if audio:
                self.last_provider = "elevenlabs"
                return audio
        return self.kokoro_mulaw(text)

    def kokoro_mulaw(self, text: str) -> bytes:
        self.last_provider = "kokoro"
        try:
            pcm16 = self.kokoro.synthesize(text)
        except (OSError, ValueError):
            pcm16 = b""  # bridge plays its tone instead of dead air
        if not pcm16 or audioop is None:
            return b""
        pcm8k, _ = audioop.ratecv(pcm16, 2, 1, 16000, 8000, None)
        return audioop.lin2ulaw(pcm8k, 2)

    def new_remote(self) -> Any:
        """A streaming client with its own keep-alive connection, or None when
        ElevenLabs is off. The media bridge owns one per call."""
        return self._remote_factory() if elevenlabs_active() else None

    def stream_remote(self, text: str, remote: Any, on_chunk: ChunkFn) -> bool:
        """Blocking (run in a thread). Push ElevenLabs ulaw chunks to on_chunk
        as they arrive; True if any audio was delivered. False means nothing
        was played and the caller should speak the line with Kokoro."""
        text = (text or "").strip()
        if not text or remote is None or not self._remote_usable():
            return False
        cacheable = len(text) <= _CACHE_MAX_CHARS
        hit = self._cache_get(text) if cacheable else None
        if hit is not None:
            self.last_provider = "elevenlabs"
            on_chunk(hit)
            return True
        parts: list[bytes] = []

        def forward(chunk: bytes) -> bool:
            parts.append(chunk)
            return on_chunk(chunk)

        complete = self._call_remote(lambda: remote.stream(text, forward))
        if not parts:
            if complete:
                self.last_error = "ValueError"  # 200 with an empty body
            return False
        self.last_provider = "elevenlabs"
        if complete and cacheable:
            self._cache_put(text, b"".join(parts))
        return True

    def prewarm(self, phrases: tuple[str, ...]) -> None:
        """Cache fixed fillers at call start so they play instantly."""
        if not elevenlabs_active():
            return
        for text in phrases:
            if time.monotonic() < _state["parked_until"]:
                return
            self._remote_cached(text.strip())

    def _remote_usable(self) -> bool:
        return elevenlabs_active() and time.monotonic() >= _state["parked_until"]

    def _remote_cached(self, text: str) -> bytes:
        cacheable = len(text) <= _CACHE_MAX_CHARS
        if cacheable:
            hit = self._cache_get(text)
            if hit is not None:
                return hit
        audio = self._call_remote(lambda: self.remote.synthesize_mulaw(text))
        if audio and cacheable:
            self._cache_put(text, audio)
        return audio or b""

    def _call_remote(self, fn: Callable[[], Any]) -> Any:
        try:
            result = fn()
        except urllib.error.HTTPError as exc:
            # 401 bad key / quota_exceeded parks; 429 (concurrency) only skips this line.
            if exc.code in (401, 402, 403):
                _state["parked_until"] = time.monotonic() + _PARK_S
            self.last_error = f"http_{exc.code}"
            return None
        except Exception as exc:  # timeout, DNS, reset, empty body — fall back
            self.last_error = type(exc).__name__
            return None
        self.last_error = ""
        return result

    def _cache_key(self, text: str) -> str:
        return f"{_voice_id()}|{_model()}|{text}"

    def _cache_get(self, text: str) -> bytes | None:
        with self._lock:
            key = self._cache_key(text)
            hit = self._cache.get(key)
            if hit is not None:
                self._cache.move_to_end(key)
            return hit

    def _cache_put(self, text: str, audio: bytes) -> None:
        with self._lock:
            self._cache[self._cache_key(text)] = audio
            while len(self._cache) > _CACHE_MAX_ITEMS:
                self._cache.popitem(last=False)


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
