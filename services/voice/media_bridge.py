"""Compatibility media stream bridge — the real audio leg of a SEVERE call.

Protocol: SignalWire Compatibility API bidirectional media stream (<Connect><Stream>).
SignalWire opens WSS `/signalwire/media?incident_id=...` and sends JSON frames:
  connected -> start (carries streamSid) -> media* (mulaw/8k, base64) -> stop
We speak by sending back {"event":"media", streamSid, media:{payload}} frames,
chunked to the provider's ~20ms/160-byte cadence.

This bridge never invents anything to say. It subscribes to the same
call.transcript_delta envelopes the dashboard already renders (via
ApiServer's per-incident fan-out) and voices every speaker=="sentinel" line
verbatim — the phone hears exactly what the transcript panel shows, nothing
more. Kokoro is the outbound TTS; if it has nothing to give us (unconfigured
CS_KOKORO_URL), we play a short synthesized tone instead of dead air, so the
audio pipe itself is provably working even without real TTS.

Inbound audio (the dispatcher's real speech) is decoded, closed after 500 ms
of silence, sent serially to the ASR service (CS_PARAKEET_URL)
for transcription, and published back as a CallTranscriptDelta(speaker=
"dispatcher", ...) so it lands on the dashboard the same way a scripted line
would. If CS_PARAKEET_URL is unset the stub returns "" and nothing is
published — silent, not broken.

No third-party deps: audio conversion uses stdlib `audioop`.
"""

from __future__ import annotations

import asyncio
import base64
import json
import math
import struct
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

try:
    import audioop  # deprecated 3.11+, removed in 3.13 — fine on this box's 3.12
except ImportError:  # pragma: no cover — degrade to silent rather than crash
    audioop = None  # type: ignore[assignment]

from contracts import CallTranscriptDelta, utcnow
from services.brain.guardrails import Guardrails

from .kokoro import get_tts
from .parakeet import get_asr

SendFn = Callable[[str], Awaitable[None]]
RecvFn = Callable[[], Awaitable[str | None]]
SubscribeFn = Callable[[str], "asyncio.Queue[dict[str, Any]]"]
UnsubscribeFn = Callable[[str, "asyncio.Queue[dict[str, Any]]"], None]
ReplayFn = Callable[[], "list[dict[str, Any]]"]
PublishFn = Callable[[Any], Awaitable[None]]
AnswerFn = Callable[[str, str], Awaitable[str]]

# Compatibility stream cadence: 20ms frames of 8kHz mono mulaw = 160 bytes.
_FRAME_BYTES = 160
_FRAME_S = 0.02
# ponytail: RMS VAD fits the quiet demo line; use WebRTC VAD if field noise creates false turns.
_SPEECH_RMS = 300
_SILENCE_FLUSH_BYTES = 16_000  # 500 ms at PCM16 mono 16kHz
_MAX_UTTERANCE_BYTES = 480_000  # 15 seconds; discard longer noisy turns
_FILLER_MIN_BYTES = 48_000  # one second of speech plus the closing silence
_FILLERS = ("One moment.", "Let me check that.", "Give me a moment.")


def _pcm16_to_mulaw(pcm16: bytes, in_rate: int) -> bytes:
    """16-bit mono PCM at in_rate -> 8kHz mulaw bytes for the media stream."""
    if audioop is None or not pcm16:
        return b""
    if in_rate != 8000:
        pcm16, _ = audioop.ratecv(pcm16, 2, 1, in_rate, 8000, None)
    return audioop.lin2ulaw(pcm16, 2)


def mulaw_to_pcm16(mulaw: bytes, out_rate: int) -> bytes:
    """8kHz mulaw from the media stream -> 16-bit mono PCM at out_rate (Parakeet wants 16k)."""
    if audioop is None or not mulaw:
        return b""
    pcm8k = audioop.ulaw2lin(mulaw, 2)
    if out_rate != 8000:
        pcm8k, _ = audioop.ratecv(pcm8k, 2, 1, 8000, out_rate, None)
    return pcm8k


def tone_mulaw(duration_s: float, *, freq_hz: float = 440.0, amplitude: float = 0.25) -> bytes:
    """Fallback audio when Kokoro has nothing real to say — proves the outbound
    pipe works without pretending to be speech. Not real TTS."""
    rate = 8000
    n = max(1, int(rate * duration_s))
    peak = int(32767 * amplitude)
    samples = bytearray(2 * n)
    for i in range(n):
        val = int(peak * math.sin(2 * math.pi * freq_hz * i / rate))
        struct.pack_into("<h", samples, 2 * i, val)
    return _pcm16_to_mulaw(bytes(samples), rate)


def _chunks(payload: bytes, n: int):
    for i in range(0, len(payload), n):
        yield payload[i : i + n]


@dataclass
class MediaStreamBridge:
    """One instance per live media stream connection (one phone call)."""

    incident_id: str
    send: SendFn
    recv: RecvFn
    subscribe: SubscribeFn
    unsubscribe: UnsubscribeFn
    # Same bounded call.transcript_delta buffer /ws reconnects already replay
    # from (DemoHub.replay_events) — the script starts talking the instant
    # the incident dispatches, but the phone may not be answered and this
    # bridge connected until several real seconds later. Without this, the
    # callee would just miss whatever Sentinel already said before pickup.
    replay: ReplayFn = field(default=lambda: [])
    # Optional: publish CallTranscriptDelta(speaker="dispatcher", ...) back
    # onto the hub once Parakeet transcribes real caller audio. None (the
    # default) keeps this bridge usable in tests with no hub at all.
    publish: PublishFn | None = None
    answer: AnswerFn | None = None

    _stream_sid: str = ""
    _queue: "asyncio.Queue[dict[str, Any]] | None" = field(default=None, repr=False)
    _spoken: set[str] = field(default_factory=set, repr=False)
    _tts: Any = field(default=None, repr=False)
    _asr: Any = field(default=None, repr=False)
    _inbound_buf: bytearray = field(default_factory=bytearray, repr=False)
    # ponytail: one live call makes this queue safe; add backpressure if concurrency grows.
    _turn_q: "asyncio.Queue[bytes]" = field(default_factory=asyncio.Queue, repr=False)
    _asr_task: asyncio.Task | None = field(default=None, repr=False)
    _heard_speech: bool = field(default=False, repr=False)
    _silence_bytes: int = field(default=0, repr=False)
    _discarding_turn: bool = field(default=False, repr=False)
    _speaking: bool = field(default=False, repr=False)
    _ignore_inbound_until: float = field(default=0.0, repr=False)
    _filler_index: int = field(default=0, repr=False)
    # Test/inspection hook: every decoded inbound PCM16 chunk, in order.
    inbound_pcm16: list[bytes] = field(default_factory=list, repr=False)

    async def run(self) -> None:
        if Guardrails.kill_switch():
            return
        if not await self._await_start():
            return
        self._tts = get_tts()
        self._asr = get_asr()
        self._queue = self.subscribe(self.incident_id)
        for env in self.replay():
            await self._maybe_speak(env)
        speak_task = asyncio.create_task(self._speak_loop())
        try:
            await self._listen_loop()
        finally:
            self._flush_inbound()  # don't drop a trailing partial utterance
            speak_task.cancel()
            try:
                await speak_task
            except asyncio.CancelledError:
                pass
            if self._asr_task is not None:
                await self._asr_task
            self.unsubscribe(self.incident_id, self._queue)

    async def _await_start(self) -> bool:
        for _ in range(10):
            raw = await self.recv()
            if raw is None:
                return False
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            event = msg.get("event")
            if event == "start":
                start = msg.get("start") or {}
                self._stream_sid = start.get("streamSid") or msg.get("streamSid") or ""
                return bool(self._stream_sid)
            if event == "connected":
                continue
        return False

    async def _listen_loop(self) -> None:
        """Decode caller audio and close each turn after 500 ms of silence."""
        while True:
            raw = await self.recv()
            if raw is None:
                break
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            event = msg.get("event")
            if event == "stop":
                break
            if event != "media":
                continue
            payload = (msg.get("media") or {}).get("payload")
            if not payload:
                continue
            pcm16 = mulaw_to_pcm16(base64.b64decode(payload), 16000)
            if not pcm16:
                continue
            self.inbound_pcm16.append(pcm16)
            self._buffer_inbound(pcm16)

    def _buffer_inbound(self, pcm16: bytes) -> None:
        if self._speaking or time.monotonic() < self._ignore_inbound_until:
            return
        speaking = audioop is None or audioop.rms(pcm16, 2) >= _SPEECH_RMS
        if self._discarding_turn:
            self._silence_bytes = 0 if speaking else self._silence_bytes + len(pcm16)
            if self._silence_bytes >= _SILENCE_FLUSH_BYTES:
                self._discarding_turn = False
                self._silence_bytes = 0
            return
        if not speaking and not self._heard_speech:
            return
        if len(self._inbound_buf) + len(pcm16) > _MAX_UTTERANCE_BYTES:
            self._inbound_buf.clear()
            self._heard_speech = False
            self._silence_bytes = 0
            self._discarding_turn = True
            return
        self._inbound_buf.extend(pcm16)
        if speaking:
            self._heard_speech = True
            self._silence_bytes = 0
        elif self._heard_speech:
            self._silence_bytes += len(pcm16)
        if self._heard_speech and self._silence_bytes >= _SILENCE_FLUSH_BYTES:
            self._flush_inbound()
            self._heard_speech = False
            self._silence_bytes = 0

    def _flush_inbound(self) -> None:
        if not self._inbound_buf:
            return
        chunk = bytes(self._inbound_buf)
        self._inbound_buf.clear()
        self._turn_q.put_nowait(chunk)
        if self._asr_task is None or self._asr_task.done():
            self._asr_task = asyncio.create_task(self._drain_turns())

    async def _drain_turns(self) -> None:
        while True:
            try:
                pcm16 = self._turn_q.get_nowait()
            except asyncio.QueueEmpty:
                return
            await self._transcribe_and_publish(pcm16)

    async def _transcribe_and_publish(self, pcm16: bytes) -> None:
        filler_sent = False
        if self.publish is not None and len(pcm16) >= _FILLER_MIN_BYTES:
            filler = _FILLERS[self._filler_index % len(_FILLERS)]
            self._filler_index += 1
            await self.publish(
                CallTranscriptDelta(
                    incident_id=self.incident_id,
                    speaker="sentinel",
                    text=filler,
                    ts=utcnow(),
                )
            )
            filler_sent = True
        try:
            text = str(await asyncio.to_thread(self._asr.transcribe, pcm16) or "").strip()
        except (OSError, TimeoutError):
            text = ""
        if not text and filler_sent and self.publish is not None:
            await self.publish(
                CallTranscriptDelta(
                    incident_id=self.incident_id,
                    speaker="sentinel",
                    text="I didn't catch that. Please repeat.",
                    ts=utcnow(),
                )
            )
        if not text or self.publish is None:
            return
        await self.publish(
            CallTranscriptDelta(
                incident_id=self.incident_id,
                speaker="dispatcher",
                text=text,
                ts=utcnow(),
            )
        )
        if self.answer is not None:
            await self.answer(self.incident_id, text)

    async def _speak_loop(self) -> None:
        assert self._queue is not None
        while True:
            env = await self._queue.get()
            await self._maybe_speak(env)

    async def _maybe_speak(self, env: dict[str, Any]) -> None:
        if env.get("type") != "call.transcript_delta":
            return
        if env.get("incident_id") != self.incident_id:
            return
        if env.get("speaker") != "sentinel":
            return
        text = str(env.get("text") or "")
        key = f"{env.get('ts')}|{text}"
        if not text or key in self._spoken:
            return
        self._spoken.add(key)
        await self._speak(text)

    async def _speak(self, text: str) -> None:
        self._speaking = True
        self._inbound_buf.clear()
        self._heard_speech = False
        self._silence_bytes = 0
        while True:
            try:
                self._turn_q.get_nowait()
            except asyncio.QueueEmpty:
                break
        try:
            pcm16 = await asyncio.to_thread(self._tts.synthesize, text)
            audio = (
                _pcm16_to_mulaw(pcm16, 16000)
                if pcm16
                else tone_mulaw(min(0.6, max(0.25, len(text) / 40)))
            )
            await self._send_media(audio)
        finally:
            self._speaking = False
            self._ignore_inbound_until = time.monotonic() + 0.5

    async def _send_media(self, mulaw_bytes: bytes) -> None:
        if not mulaw_bytes or not self._stream_sid:
            return
        for chunk in _chunks(mulaw_bytes, _FRAME_BYTES):
            payload = base64.b64encode(chunk).decode("ascii")
            await self.send(
                json.dumps(
                    {
                        "event": "media",
                        "streamSid": self._stream_sid,
                        "media": {"payload": payload},
                    }
                )
            )
            await asyncio.sleep(_FRAME_S * 0.9)  # pace to real time, small headroom
