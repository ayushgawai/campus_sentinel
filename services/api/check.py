"""Self-check for api — /health + /ws round-trip, no browser."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.api.server import ApiServer  # noqa: E402


async def _ws_handshake(
    reader: asyncio.StreamReader, writer: asyncio.StreamWriter
) -> None:
    key = base64.b64encode(os.urandom(16)).decode()
    req = (
        "GET /ws HTTP/1.1\r\n"
        "Host: 127.0.0.1\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "\r\n"
    )
    writer.write(req.encode())
    await writer.drain()
    resp = await reader.readuntil(b"\r\n\r\n")
    assert b"101" in resp, resp[:80]
    accept = base64.b64encode(
        hashlib.sha1(
            (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()
        ).digest()
    ).decode()
    assert accept.encode() in resp


async def _recv_frame(reader: asyncio.StreamReader) -> dict:
    hdr = await asyncio.wait_for(reader.readexactly(2), timeout=5.0)
    length = hdr[1] & 0x7F
    if length == 126:
        length = struct.unpack("!H", await reader.readexactly(2))[0]
    elif length == 127:
        length = struct.unpack("!Q", await reader.readexactly(8))[0]
    payload = await reader.readexactly(length)
    return json.loads(payload.decode())


async def _send_text(writer: asyncio.StreamWriter, obj: dict) -> None:
    data = json.dumps(obj).encode()
    # client frames must be masked
    mask = b"\x01\x02\x03\x04"
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    header = bytearray([0x81, 0x80 | len(data)])
    writer.write(header + mask + masked)
    await writer.drain()


async def main() -> None:
    srv = ApiServer(host="127.0.0.1", port=0)
    server = await asyncio.start_server(srv.handle, srv.host, 0)
    port = server.sockets[0].getsockname()[1]

    # /health
    r, w = await asyncio.open_connection("127.0.0.1", port)
    w.write(b"GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n")
    await w.drain()
    raw = await r.read(4096)
    assert b"200" in raw and b'"ok":true' in raw.replace(b" ", b"")
    w.close()

    # /ws — expect seeded envelopes + runScenario via brain.adjudicate
    r, w = await asyncio.open_connection("127.0.0.1", port)
    await _ws_handshake(r, w)
    types: list[str] = []
    for _ in range(20):
        env = await _recv_frame(r)
        types.append(env["type"])
        if env["type"] == "incident.upsert":
            assert "incident" in env and env["incident"]["camera_id"] == "cam-05"
            assert env["incident"]["class_token"] == "FALL"
            break
    assert "camera.online" in types
    assert "health.strip" in types
    assert "incident.upsert" in types

    await _send_text(w, {"cmd": "start"})  # idempotent — must not double-seed FALL
    await _send_text(w, {"cmd": "runScenario", "scenario_id": "forced-entry"})
    got_theft = False
    for _ in range(40):
        env = await _recv_frame(r)
        if env.get("type") == "incident.upsert" and env["incident"]["class_token"] == "THEFT":
            assert env["incident"]["camera_id"] == "cam-02"
            got_theft = True
            break
        if env.get("cmd") == "runScenario":
            continue
    assert got_theft, "forced-entry must emit THEFT upsert"

    await _send_text(w, {"cmd": "runScenario", "scenario_id": "loitering"})
    got_run = False
    for _ in range(40):
        env = await _recv_frame(r)
        if env.get("type") == "incident.upsert" and env["incident"]["class_token"] == "RUN":
            got_run = True
            break
        if env.get("cmd") == "runScenario":
            continue
    assert got_run, "loitering must emit RUN upsert"

    w.close()
    server.close()
    await server.wait_closed()
    await srv.hub.stop_loops()
    from services.api.vision_bridge import vision_enabled, VisionBridge
    assert vision_enabled() is False
    # construct without starting (no torch)
    class _Hub:
        paused = False
        frames_screened = 0
        frames_escalated = 0
        async def publish(self, ev):
            pass
    vb = VisionBridge(_Hub())  # type: ignore[arg-type]
    assert vb._should_fire("cam-01", "t-1") is True
    assert vb._should_fire("cam-01", "t-1") is False  # cooldown
    print("api self-check OK")


if __name__ == "__main__":
    asyncio.run(main())
