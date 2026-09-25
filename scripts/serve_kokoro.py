#!/usr/bin/env python3
"""Local Kokoro TTS serve — matches services/voice/kokoro.py's StubKokoro contract.

  POST /synthesize   body: {"text": "..."}
                      reply: raw bytes, PCM16 mono 16kHz (no header, no JSON)

Run with the isolated venv (never services/vision/.venv — keeps Kokoro's deps
away from the process actually serving the live demo):

  services/voice/.venv/bin/python scripts/serve_kokoro.py --port 8092

Then set CS_KOKORO_URL=http://127.0.0.1:8092/synthesize in .env.

CPU only, on purpose — this box already runs Qwen + YOLO on the one GPU for
the live demo (see docs/STABILITY.md); Kokoro-82M is small enough that CPU
is fine (measured ~1.7s to generate a short sentence, one-time ~6s pipeline
load at startup, not per request).
"""

from __future__ import annotations

import argparse
import audioop
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

_pipeline = None
_KOKORO_RATE = 24000
_TARGET_RATE = 16000
_VOICE = "af_heart"


def _load_pipeline():
    global _pipeline
    if _pipeline is not None:
        return _pipeline
    from kokoro import KPipeline

    t0 = time.time()
    _pipeline = KPipeline(lang_code="a")  # American English
    print(f"[kokoro] pipeline loaded in {time.time() - t0:.1f}s", flush=True)
    return _pipeline


def synthesize_pcm16_16k(text: str) -> bytes:
    text = (text or "").strip()
    if not text:
        return b""
    pipeline = _load_pipeline()
    chunks: list[np.ndarray] = []
    for _, _, audio in pipeline(text, voice=_VOICE):
        chunks.append(audio.detach().cpu().numpy() if hasattr(audio, "detach") else np.asarray(audio))
    if not chunks:
        return b""
    float_audio = np.concatenate(chunks).astype(np.float32)
    # float32 [-1, 1] @ 24kHz -> int16 PCM @ 24kHz -> resample to 16kHz.
    clipped = np.clip(float_audio, -1.0, 1.0)
    pcm24k = (clipped * 32767.0).astype("<i2").tobytes()
    pcm16k, _ = audioop.ratecv(pcm24k, 2, 1, _KOKORO_RATE, _TARGET_RATE, None)
    return pcm16k


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[kokoro] {self.address_string()} {fmt % args}", flush=True)

    def do_POST(self):
        if self.path.rstrip("/") != "/synthesize":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else b""
        try:
            text = json.loads(body.decode("utf-8")).get("text", "")
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_response(400)
            self.end_headers()
            return
        t0 = time.time()
        try:
            pcm = synthesize_pcm16_16k(text)
        except Exception as exc:  # noqa: BLE001 — never 500 the whole demo call
            print(f"[kokoro] synth failed: {exc}", flush=True)
            self.send_response(500)
            self.end_headers()
            return
        dt = time.time() - t0
        print(f"[kokoro] '{text[:60]}' -> {len(pcm)} bytes in {dt:.2f}s", flush=True)
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(pcm)))
        self.end_headers()
        self.wfile.write(pcm)

    def do_GET(self):
        if self.path.rstrip("/") == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true,"service":"kokoro"}')
            return
        self.send_response(404)
        self.end_headers()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8092)
    ap.add_argument("--prewarm", action="store_true", default=True)
    args = ap.parse_args()

    if args.prewarm:
        _load_pipeline()
        synthesize_pcm16_16k("Campus Sentinel voice service ready.")

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[kokoro] serving on http://{args.host}:{args.port}/synthesize", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
