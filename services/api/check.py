"""Self-check for api — /health + /ws round-trip, no browser."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import struct
import sys

# Self-check never writes to the real history database.
os.environ["CS_DB_PATH"] = ":memory:"
from dataclasses import replace
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
    startup = ApiServer(host="127.0.0.1", port=0)
    await startup.hub.seed()
    assert not startup.hub._incidents, "startup seed must never create a dispatchable incident"

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
    # Every tracked person is shown with their own track id (voice counts them).
    assert [len(ev.boxes) for ev in shown] == [2, 0, 0]
    assert [b.track_id for b in shown[0].boxes] == ["t-8", "t-9"]
    assert shown[0].boxes[1].score == 0.9
    router = _Router()
    router.last_escalations = [
        SimpleNamespace(camera_id="CAM-01", track_id="T-1", ts=None)
    ]
    _, work = bridge._step(router)
    assert work[0][0] == "classify"
    assert bridge._qwen_started, "camera-wall reconnect must not re-run Qwen"
    router.last_escalations = [
        SimpleNamespace(camera_id="CAM-02", track_id="T-9", ts=None)
    ]
    _, work = bridge._step(router)
    assert work[0][0] == "reuse"

    from contracts import IncidentState, Severity
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

    class _ActiveVoice:
        updates: list[str] = []
        starts = 0

        def active_incident_id(self):
            return result.record.incident_id

        def busy(self):
            return True

        async def notify_whereabouts(self, camera_id, _address):
            self.updates.append(camera_id)

        async def start_call(self, _rec, _brief):
            self.starts += 1

        async def start_live_call(self, _rec, _brief):
            self.starts += 1

    active_voice = _ActiveVoice()
    srv.hub._voice = active_voice  # type: ignore[assignment]
    foreign = replace(
        result.record,
        incident_id="foreign-incident",
        camera_id="cam-02",
        rules_fired=["operator_report"],
    )
    await srv.hub._on_incident(foreign)
    assert active_voice.updates == []
    automatic = replace(
        foreign,
        incident_id="later-vision-incident",
        rules_fired=["weapon"],
        state=IncidentState.ALERTED,
    )
    await srv.hub._on_incident(automatic)
    assert active_voice.starts == 0
    assert automatic.state is IncidentState.ALERTED

    manual_busy = replace(
        foreign,
        incident_id="manual-while-busy",
        state=IncidentState.ALERTED,
    )
    srv.hub._incidents[manual_busy.incident_id] = manual_busy
    try:
        await srv.hub.dispatch_incident(manual_busy.incident_id)
        raise AssertionError("busy manual dispatch must be rejected")
    except RuntimeError as exc:
        assert "active" in str(exc)
    assert manual_busy.state is IncidentState.ALERTED
    srv.hub._voice = None

    class _ConcurrentVoice:
        starts = 0
        active = False

        def busy(self):
            return self.active

        async def start_call(self, _rec, _brief):
            self.active = True
            self.starts += 1

        async def start_live_call(self, _rec, _brief):
            await self.start_call(_rec, _brief)

    concurrent_voice = _ConcurrentVoice()
    srv.hub._voice = concurrent_voice  # type: ignore[assignment]
    original_broadcast = srv.hub.broadcast

    async def slow_broadcast(_payload):
        await asyncio.sleep(0.02)

    srv.hub.broadcast = slow_broadcast
    from services.brain.guardrails import DEFAULT_GUARDRAILS

    dispatched_before = set(DEFAULT_GUARDRAILS._dispatched)
    hits_before = list(DEFAULT_GUARDRAILS._hour_hits)
    first = replace(automatic, incident_id="concurrent-1", state=IncidentState.ALERTED)
    second = replace(automatic, incident_id="concurrent-2", state=IncidentState.ALERTED)
    try:
        await asyncio.gather(
            srv.hub._maybe_start_voice(first),
            srv.hub._maybe_start_voice(second),
        )
        assert concurrent_voice.starts == 1
        assert [first.state, second.state].count(IncidentState.DISPATCHED) == 1
        assert [first.state, second.state].count(IncidentState.ALERTED) == 1
    finally:
        DEFAULT_GUARDRAILS._dispatched = dispatched_before
        DEFAULT_GUARDRAILS._hour_hits = hits_before
        srv.hub.broadcast = original_broadcast
        srv.hub._voice = None

    # call.brief: one on dispatch, one per real camera handoff, in the bounded replay.
    import services.voice.signalwire_bridge as sw
    from contracts import call_brief_to_dict
    from services.brain.call_brief import assemble_call_brief

    class _BriefVoice:
        active = False
        handoffs: list[str] = []

        def active_incident_id(self):
            return "brief-1" if self.active else None

        def busy(self):
            return self.active

        async def start_call(self, _rec, _brief):
            self.active = True

        async def start_live_call(self, rec, brief):
            await self.start_call(rec, brief)

        async def notify_whereabouts(self, camera_id, _address):
            self.handoffs.append(camera_id)

        async def cancel(self):
            self.active = False

    sent_env: list[dict] = []

    async def capture(payload):
        sent_env.append(payload)

    saved_sw = (sw.load_config, sw.place_call)
    sw.load_config = lambda: None  # never a real call from a check
    sw.place_call = lambda *_a, **_k: {"ok": False, "skipped": True}
    dispatched_before = set(DEFAULT_GUARDRAILS._dispatched)
    hits_before = list(DEFAULT_GUARDRAILS._hour_hits)
    brief_voice = _BriefVoice()
    srv.hub.broadcast = capture
    srv.hub._voice = brief_voice  # type: ignore[assignment]
    try:
        rec = replace(
            result.record,
            incident_id="brief-1",
            camera_id="cam-01",
            severity=Severity.SEVERE,
            state=IncidentState.ALERTED,
            rules_fired=["weapon"],
        )
        await srv.hub._maybe_start_voice(rec)
        briefs = [e for e in sent_env if e["type"] == "call.brief"]
        assert len(briefs) == 1 and briefs[0]["reason"] == "dispatch"
        assert briefs[0]["incident_id"] == "brief-1" and briefs[0]["ts"]
        assert set(briefs[0]["brief"]) == set(call_brief_to_dict(assemble_call_brief(rec)))
        assert briefs[0]["brief"]["camera_id"] == "cam-01"
        json.dumps(briefs[0])  # wire-safe
        types = [e["type"] for e in sent_env]
        assert types.index("incident.state_change") < types.index("call.brief")
        for cam in ("cam-02", "cam-02", "cam-03"):
            await srv.hub._on_incident(replace(rec, camera_id=cam))
        briefs = [e for e in sent_env if e["type"] == "call.brief"]
        assert [(b["reason"], b["brief"]["camera_id"]) for b in briefs] == [
            ("dispatch", "cam-01"),
            ("handoff", "cam-02"),
            ("handoff", "cam-03"),
        ]
        assert brief_voice.handoffs == ["cam-02", "cam-02", "cam-03"]
        assert [
            e
            for e in srv.hub.replay_events()
            if e["type"] == "call.brief" and e["incident_id"] == "brief-1"
        ] == briefs
        await srv.hub.reset()
        assert not srv.hub._brief_camera
        assert not [e for e in srv.hub.replay_events() if e["type"] == "call.brief"]
    finally:
        sw.load_config, sw.place_call = saved_sw
        DEFAULT_GUARDRAILS._dispatched = dispatched_before
        DEFAULT_GUARDRAILS._hour_hits = hits_before
        srv.hub.broadcast = original_broadcast
        srv.hub._voice = None

    # Real calls only from real vision WEAPON detections; a failed call frees the line.
    from contracts import IncidentClass

    placed: list[str] = []
    outcomes: list[object] = []

    def fake_place(incident_id, **_kw):
        placed.append(incident_id)
        outcome = outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    saved_sw = (sw.load_config, sw.place_call)
    sw.load_config = lambda: SimpleNamespace(configured=True)  # provider "enabled"
    sw.place_call = fake_place
    dispatched_before = set(DEFAULT_GUARDRAILS._dispatched)
    hits_before = list(DEFAULT_GUARDRAILS._hour_hits)
    sent_env.clear()
    srv.hub.broadcast = capture
    srv.hub._voice = None
    try:
        for unknown in ("full", "quiet", "medical_fall", "nope"):
            reply = await srv.hub.handle_cmd({"cmd": "runScenario", "scenario_id": unknown})
            assert reply["ok"] is False and "unknown scenario" in reply["error"]
        assert not [e for e in sent_env if e["type"] == "incident.upsert"]
        await srv.hub.run_scenario("armed-intruder")  # scripted WEAPON, SEVERE
        assert placed == [], "a scripted scenario must never place a call"
        assert not srv.hub._voice_agent().busy()
        scripted = next(
            rec for rec in srv.hub._incidents.values() if "scenario:armed-intruder" in rec.rules_fired
        )
        assert scripted.state is IncidentState.ALERTED
        vision = replace(
            result.record,
            incident_id="vision-real-1",
            class_token=IncidentClass.WEAPON,
            severity=Severity.SEVERE,
            state=IncidentState.ALERTED,
            rules_fired=["weapon"],
        )
        outcomes[:] = [{"ok": False, "reason": "http_500"}]
        await srv.hub._on_incident(vision)
        assert placed == ["vision-real-1"]
        assert not srv.hub._voice_agent().busy(), "failed call must not leave voice busy"
        DEFAULT_GUARDRAILS._dispatched.clear()
        outcomes[:] = [TimeoutError("signalwire")]
        await srv.hub._on_incident(replace(vision, incident_id="vision-real-2", state=IncidentState.ALERTED))
        assert placed[-1] == "vision-real-2" and not srv.hub._voice_agent().busy()
        DEFAULT_GUARDRAILS._dispatched.clear()
        outcomes[:] = [{"ok": True, "call_sid": "CA-check"}]
        await srv.hub._on_incident(replace(vision, incident_id="vision-real-3", state=IncidentState.ALERTED))
        assert placed[-1] == "vision-real-3" and srv.hub._voice_agent().busy()
        assert "signalwire_call:CA-check" in [e.get("scenario_id") for e in sent_env]
        await srv.hub.reset()
        assert not srv.hub._voice_agent().busy()
    finally:
        sw.load_config, sw.place_call = saved_sw
        DEFAULT_GUARDRAILS._dispatched = dispatched_before
        DEFAULT_GUARDRAILS._hour_hits = hits_before
        srv.hub.broadcast = original_broadcast
        srv.hub._voice = None

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
    assert voice_status["tts"]["fallback"] == "kokoro"
    assert "ELEVENLABS_API_KEY" not in json.dumps(voice_status)

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
