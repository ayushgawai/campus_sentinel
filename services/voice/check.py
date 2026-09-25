"""Self-check for voice forced/demo path — no ASR/TTS models."""

from __future__ import annotations

import asyncio
import base64
import sys
from pathlib import Path
from urllib.parse import parse_qs

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from contracts import IncidentClass, IncidentState, Severity, utcnow  # noqa: E402
from contracts.incident import IncidentRecord, TimelineEvent  # noqa: E402
from services.brain.call_brief import assemble_call_brief  # noqa: E402
from services.voice.agent import VoiceAgent  # noqa: E402
from services.voice import agent as agent_mod  # noqa: E402


def _check_signalwire_request() -> None:
    from services.voice import signalwire_bridge
    from services.voice.signalwire_bridge import SignalWireConfig, build_call_request

    cfg = SignalWireConfig(
        space="example.signalwire.com",
        project_id="project-id",
        api_token="secret-token",
        from_number="+12025550123",
        to_number="+14085550123",
        public_base="https://demo.example.com",
        enabled=True,
    )
    req = build_call_request(cfg, "inc 1")
    assert req.full_url == (
        "https://example.signalwire.com/api/laml/2010-04-01/Accounts/"
        "project-id/Calls.json"
    )
    assert parse_qs(req.data.decode()) == {
        "To": ["+14085550123"],
        "From": ["+12025550123"],
        "Url": ["https://demo.example.com/signalwire/voice?incident_id=inc+1"],
        "Method": ["POST"],
    }
    auth = req.get_header("Authorization")
    assert auth == "Basic " + base64.b64encode(b"project-id:secret-token").decode()

    class _Health:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def read(self):
            return b'{"ok": true}'

    original = signalwire_bridge.urlopen
    signalwire_bridge.urlopen = lambda *_args, **_kwargs: _Health()
    try:
        assert signalwire_bridge.service_ready("http://127.0.0.1:8093/transcribe") is True
        assert signalwire_bridge.service_ready("") is False
    finally:
        signalwire_bridge.urlopen = original


async def _main() -> None:
    _check_signalwire_request()
    events: list[object] = []

    async def pub(ev: object) -> None:
        events.append(ev)

    now = utcnow()
    rec = IncidentRecord(
        incident_id="inc-voice-1",
        track_id="t-1",
        camera_id="cam-01",
        peak_ts=now,
        class_token=IncidentClass.WEAPON,
        class_logprob_calibrated=0.0,
        router_score=0.9,
        fused_prob=0.92,
        severity=Severity.SEVERE,
        description="weapon on cam-01",
        location_text="Lobby entrance",
        person_description="Adult, dark jacket, long firearm visible.",
        state=IncidentState.ALERTED,
        clip_uri="",
        created_at=now,
        updated_at=now,
        timeline=[TimelineEvent(ts=now, state=IncidentState.NEW, note="created")],
    )
    brief = assemble_call_brief(rec)
    agent = VoiceAgent(pub)
    script = [
        agent_mod.CallScriptStep(0.05, "sentinel", "simulated"),
        agent_mod.CallScriptStep(0.05, "sentinel", tool="lookup_location"),
        agent_mod.CallScriptStep(0.05, "sentinel", tool="get_person_description"),
        agent_mod.CallScriptStep(0.2, "dispatcher", "Copy. Stay on the line."),
    ]
    await agent.start_call(rec, brief, script=script)
    assert agent._task is not None
    await asyncio.sleep(0.08)
    await agent.notify_whereabouts(
        "cam-02", "Academic Walk east corridor (floor 1; near 4th St)"
    )
    await agent._task
    types = [getattr(e, "type", None) for e in events]
    assert "call.transcript_delta" in types
    assert "tool.call_live" in types
    assert any("simulated" in getattr(e, "text", "") for e in events)
    assert any("demo call" in getattr(e, "text", "") for e in events)
    assert any("cam-02" in getattr(e, "text", "") for e in events)
    assert any(
        getattr(e, "scenario_id", "").startswith("security_alert:") for e in events
    )

    class _Qwen:
        calls = 0

        def answer_dispatcher(self, facts, question):
            self.calls += 1
            assert facts["camera_id"] == "cam-02"
            return "The cameras do not confirm that detail."

    live_events: list[object] = []

    async def live_pub(ev: object) -> None:
        live_events.append(ev)

    qwen = _Qwen()
    live = VoiceAgent(live_pub, zrt=qwen)  # type: ignore[arg-type]
    await live.start_live_call(rec, assemble_call_brief(rec))
    opener = getattr(live_events[-2], "text", "")
    assert opener.startswith("Hi, I am Campus Sentinel AI from San Jose State University.")
    assert "MacQuarrie Hall" in opener and "visible long firearm" in opener
    assert "One Washington Square" in await live.answer_dispatcher(rec.incident_id, "Where are you?")
    assert "long firearm" in await live.answer_dispatcher(rec.incident_id, "What weapon do you see?")
    assert "cannot confirm any injuries" in await live.answer_dispatcher(rec.incident_id, "Is anyone hurt?")
    assert "toward the east corridor" in await live.answer_dispatcher(rec.incident_id, "Direction of travel?")
    assert qwen.calls == 0
    await live.notify_whereabouts("cam-02", assemble_call_brief(rec).address)
    assert "east corridor" in await live.answer_dispatcher(rec.incident_id, "Where is the person now?")
    live.update_visual("cam-02", False)
    assert "not currently visible" in await live.answer_dispatcher(rec.incident_id, "Where is the person now?")
    live.update_visual("cam-02", True)
    assert await live.answer_dispatcher(rec.incident_id, "Is the door locked?") == "The cameras do not confirm that detail."
    assert qwen.calls == 1

    from services.voice.media_bridge import MediaStreamBridge

    asked: list[tuple[str, str]] = []

    async def answer(incident_id: str, question: str) -> str:
        asked.append((incident_id, question))
        return "answered"

    bridge = MediaStreamBridge(
        incident_id=rec.incident_id,
        send=lambda _text: asyncio.sleep(0),
        recv=lambda: asyncio.sleep(0, result=None),
        subscribe=lambda _id: asyncio.Queue(),
        unsubscribe=lambda _id, _q: None,
        publish=live_pub,
        answer=answer,
    )
    bridge._asr = type("_Asr", (), {"transcribe": lambda _self, _pcm: "What is the location?"})()
    await bridge._transcribe_and_publish(b"pcm")
    assert asked == [(rec.incident_id, "What is the location?")]
    print("voice self-check OK")


if __name__ == "__main__":
    asyncio.run(_main())
