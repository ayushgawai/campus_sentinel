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
from types import SimpleNamespace

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


async def _http_json(
    port: int, method: str, path: str, body: dict | None = None
) -> tuple[int, dict]:
    payload = json.dumps(body).encode() if body is not None else b""
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    writer.write(
        (
            f"{method} {path} HTTP/1.1\r\nHost: localhost\r\n"
            f"Content-Type: application/json\r\nContent-Length: {len(payload)}\r\n\r\n"
        ).encode()
        + payload
    )
    await writer.drain()
    raw = await reader.read()
    writer.close()
    head, response_body = raw.split(b"\r\n\r\n", 1)
    code = int(head.split(b" ", 2)[1])
    return code, json.loads(response_body or b"{}")


async def main() -> None:
    srv = ApiServer(host="127.0.0.1", port=0)

    # The known demo subject reaches three cameras, but only the first may use Qwen.
    from types import SimpleNamespace
    from services.api.vision_bridge import VisionBridge, _display_overlays
    from contracts import BBox, OverlayBoxes, utcnow

    class _VisionHub:
        paused = False
        frames_screened = 0
        frames_escalated = 0

        async def publish(self, ev):
            pass

    class _Router:
        def __init__(self):
            self.last_escalations = []

        def step(self):
            return [object()]

        def bundle(self, *args, **kwargs):
            return SimpleNamespace(images=[object()])

    bridge = VisionBridge(_VisionHub())  # type: ignore[arg-type]
    bridge._qwen_started = True
    bridge.hub.on_reset()
    assert bridge._need_align is True
    assert bridge._qwen_started is False

    shown = _display_overlays(
        ["CAM-01", "CAM-02", "CAM-03"],
        [
            OverlayBoxes(
                camera_id="CAM-01",
                ts=utcnow(),
                boxes=[
                    BBox(x=1, y=2, w=3, h=4, track_id="t-8", score=0.6),
                    BBox(x=5, y=6, w=7, h=8, track_id="t-9", score=0.9),
                ],
            )
        ],
        100,
        100,
    )
    assert [ev.camera_id for ev in shown] == ["cam-01", "cam-02", "cam-03"]
    assert [len(ev.boxes) for ev in shown] == [1, 0, 0]
    assert shown[0].boxes[0].track_id == "t-1"
    assert shown[0].boxes[0].score == 0.9
    router = _Router()
    router.last_escalations = [
        SimpleNamespace(camera_id="CAM-01", track_id="T-1", ts=None)
    ]
    _, work = bridge._step(router)
    assert work[0][0] == "classify"
    bridge.align_to_wall()
    assert bridge._qwen_started, "camera-wall reconnect must not re-run Qwen"
    router.last_escalations = [
        SimpleNamespace(camera_id="CAM-02", track_id="T-9", ts=None)
    ]
    _, work = bridge._step(router)
    assert work[0][0] == "reuse"

    from contracts import Severity
    from services.brain.zrt_client import ZRTClient

    result, _ = bridge._classify_one(
        ZRTClient(forced=True),
        SimpleNamespace(
            camera_id="CAM-01",
            track_id="T-1",
            ts=utcnow(),
            fused=0.414,
            rules=["weapon"],
        ),
        [],
    )
    assert result.record.severity is Severity.SEVERE
    bridge._cached_record = result.record
    bridge._last_camera = "cam-01"
    handoff = bridge._reuse_from_overlay(
        OverlayBoxes(
            camera_id="cam-02",
            ts=utcnow(),
            boxes=[BBox(x=0.1, y=0.1, w=0.2, h=0.4, track_id="t-1", label="weapon", score=0.3)],
        )
    )
    assert handoff is not None and handoff.camera_id == "cam-02"
    assert bridge._reuse_from_overlay(
        OverlayBoxes(camera_id="cam-02", ts=utcnow(), boxes=[])
    ) is None
    bridge._cached_record = None
    bridge._qwen_started = True
    bridge._last_camera = "cam-01"
    router = SimpleNamespace(
        last_escalations=[
            SimpleNamespace(
                camera_id="cam-02", track_id="t-1", ts=utcnow(), fused=0.8, rules=[]
            )
        ],
        step=lambda: [],
    )
    _overlays, packed = bridge._step(router)
    assert packed[0][0] == "reuse" and bridge._last_camera == "cam-01"
    assert bridge._reuse_record(router.last_escalations[0]) is None
    bridge._cached_record = result.record
    pending = bridge._drain_pending_reuse()
    assert [record.camera_id for record in pending] == ["cam-02"]
    assert bridge._last_camera == "cam-02"

    server = await asyncio.start_server(srv.handle, srv.host, 0)
    port = server.sockets[0].getsockname()[1]

    code, site = await _http_json(port, "GET", "/api/site")
    assert code == 200 and site["site"]["name"] == "San Jose State University"
    code, manual = await _http_json(
        port,
        "POST",
        "/api/incidents/manual",
        {
            "camera_id": "cam-02",
            "class_token": "THEFT",
            "severity": "MINOR",
            "note": "Operator saw a bag taken",
        },
    )
    assert code == 201 and manual["incident_id"].startswith("INC-")
    incident_id = manual["incident_id"]
    assert srv.hub.get_incident(incident_id) is not None
    code, _ = await _http_json(port, "POST", "/api/incidents/manual", {"camera_id": "cam-99"})
    assert code == 400
    code, _ = await _http_json(port, "POST", "/api/incidents/missing/confirm", {})
    assert code == 404
    code, dispatched = await _http_json(
        port, "POST", f"/api/incidents/{incident_id}/dispatch", {}
    )
    assert code == 200 and dispatched["state"] == "DISPATCHED"
    code, confirmed = await _http_json(
        port, "POST", f"/api/incidents/{incident_id}/confirm", {}
    )
    assert code == 200 and confirmed["state"] == "RESOLVED"
    code, broadcast = await _http_json(
        port,
        "POST",
        "/api/broadcast",
        {"incident_id": incident_id, "audience": ["security"], "message": "Avoid Camera 2"},
    )
    assert code == 200 and broadcast["ok"] is True
    code, dismissed = await _http_json(
        port,
        "POST",
        f"/api/incidents/{incident_id}/dismiss",
        {"reason": "false alarm"},
    )
    assert code == 409, dismissed
    await srv.hub.reset()
    assert srv.hub.get_incident(incident_id) is None
    await srv.hub.run_scenario("armed-intruder")

    # /health
    r, w = await asyncio.open_connection("127.0.0.1", port)
    w.write(b"GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n")
    await w.drain()
    raw = await r.read(4096)
    assert b"200" in raw and b'"ok":true' in raw.replace(b" ", b"")
    w.close()

    code, voice_status = await _http_json(port, "GET", "/voice/status")
    assert code == 200
    assert voice_status["parakeet"] is False and voice_status["kokoro"] is False

    # Ambient cameras are browser-decoded MP4, with byte ranges for seeking/looping.
    r, w = await asyncio.open_connection("127.0.0.1", port)
    w.write(
        b"GET /media/cam-04 HTTP/1.1\r\n"
        b"Host: localhost\r\n"
        b"Range: bytes=0-15\r\n\r\n"
    )
    await w.drain()
    raw = await r.read()
    head, body = raw.split(b"\r\n\r\n", 1)
    assert b"206 Partial Content" in head
    assert b"Content-Type: video/mp4" in head
    assert b"Content-Range: bytes 0-15/" in head
    assert len(body) == 16
    w.close()

    # /ws — expect seeded envelopes + runScenario via brain.adjudicate
    r, w = await asyncio.open_connection("127.0.0.1", port)
    await _ws_handshake(r, w)
    types: list[str] = []
    camera_ids: set[str] = set()
    for _ in range(40):
        env = await _recv_frame(r)
        types.append(env["type"])
        if env["type"] == "camera.online":
            camera_ids.add(env["camera_id"])
        if env["type"] == "incident.upsert":
            assert "incident" in env and env["incident"]["camera_id"] == "cam-01"
            assert env["incident"]["class_token"] == "WEAPON"
        if {"camera.online", "health.strip", "incident.upsert"}.issubset(types):
            break
    assert "camera.online" in types
    assert camera_ids and camera_ids <= {f"cam-{i:02d}" for i in range(1, 7)}
    assert "health.strip" in types
    assert "incident.upsert" in types

    followup_types: list[str] = []
    for _ in range(20):
        if "incident.state_change" in types + followup_types and "call.transcript_delta" in types + followup_types:
            break
        env = await _recv_frame(r)
        followup_types.append(env["type"])
    assert "incident.state_change" in types + followup_types
    assert "call.transcript_delta" in types + followup_types

    # A refreshed/replacement dashboard also needs its own camera snapshot.
    r2, w2 = await asyncio.open_connection("127.0.0.1", port)
    await _ws_handshake(r2, w2)
    second_types = [(await _recv_frame(r2))["type"] for _ in range(12)]
    assert "camera.online" in second_types
    assert "incident.upsert" in second_types
    assert "incident.state_change" in second_types
    assert "call.transcript_delta" in second_types
    w2.close()

    await _send_text(w, {"cmd": "start"})  # idempotent — must not double-seed WEAPON
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
    import os
    from services.api.vision_bridge import vision_enabled, VisionBridge
    assert vision_enabled() is False
    class _Hub:
        paused = False
        frames_screened = 0
        frames_escalated = 0
        async def publish(self, ev):
            pass
    os.environ["CS_VISION_COOLDOWN_S"] = "8"
    vb = VisionBridge(_Hub())  # type: ignore[arg-type]
    vb._last_fire.clear()
    vb._upsert_times.clear()
    assert vb._should_fire("cam-01", "t-cooldown") is True
    assert vb._should_fire("cam-01", "t-cooldown") is False
    assert vb._should_fire("cam-01", "t-other") is False
    print("api self-check OK")


if __name__ == "__main__":
    asyncio.run(main())
