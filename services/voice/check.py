"""Self-check for voice forced/demo path — no ASR/TTS models."""

from __future__ import annotations

import asyncio
import base64
import threading
import time
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
            if question == "What color is the door?":
                return "The door appears gray. I cannot verify whether it is locked."
            if question == "What is happening near the door?":
                return "The person is moving east, but I cannot confirm their destination."
            if question == "Is there smoke?":
                return "I cannot confirm that from the camera."
            return "The cameras do not confirm that detail."

    live_events: list[object] = []

    async def live_pub(ev: object) -> None:
        live_events.append(ev)

    qwen = _Qwen()
    live = VoiceAgent(live_pub, zrt=qwen)  # type: ignore[arg-type]
    await live.start_live_call(rec, assemble_call_brief(rec))
    opener = getattr(live_events[-2], "text", "")
    assert opener == (
        "Hi, this is Campus Sentinel AI at San Jose State. "
        "I'm reporting an armed person at MacQuarrie Hall, One Washington Square."
    )
    assert await live.answer_dispatcher(rec.incident_id, "911, what is your emergency?") == (
        "I'm reporting an armed person at MacQuarrie Hall."
    )
    address = await live.answer_dispatcher(rec.incident_id, "What is the exact address?")
    assert address == "One Washington Square, San Jose, California 95192."
    assert await live.answer_dispatcher(rec.incident_id, "Repeat the address.") == address
    assert "long firearm" in await live.answer_dispatcher(rec.incident_id, "What weapon do you see?")
    assert await live.answer_dispatcher(rec.incident_id, "Is anyone hurt?") == (
        "I can't verify their medical condition from this camera."
    )
    assert await live.answer_dispatcher(rec.incident_id, "Are they breathing?") == (
        "I can't verify their medical condition from this camera."
    )
    assert await live.answer_dispatcher(rec.incident_id, "Where is the person now?") == (
        "The person is in the ground-floor lobby."
    )
    assert await live.answer_dispatcher(
        rec.incident_id, "Where are you seeing the person now?"
    ) == "The person is in the ground-floor lobby."
    assert "toward the east corridor" in await live.answer_dispatcher(rec.incident_id, "Direction of travel?")
    assert qwen.calls == 0
    event_count = len(live_events)
    await live.notify_whereabouts("cam-01", assemble_call_brief(rec).address)
    assert len(live_events) == event_count
    await live.notify_whereabouts("cam-02", assemble_call_brief(rec).address)
    assert await live.answer_dispatcher(rec.incident_id, "Where is the person now?") == (
        "The person is in the east corridor."
    )
    live.update_visual("cam-02", False)
    assert "don't see the person" in await live.answer_dispatcher(rec.incident_id, "Where is the person now?")
    assert "aren't visible" in await live.answer_dispatcher(rec.incident_id, "What weapon do you see?")
    live.update_visual("cam-02", True)
    event_count = len(live_events)
    assert await live.answer_dispatcher(rec.incident_id, "Is the door locked?") == (
        "I don't see that on the current camera."
    )
    assert qwen.calls == 1
    new_lines = [getattr(event, "text", "") for event in live_events[event_count:]]
    assert new_lines == ["I don't see that on the current camera."]
    assert await live.answer_dispatcher(rec.incident_id, "Is there smoke?") == (
        "That isn't visible in the current camera view."
    )
    assert qwen.calls == 2
    assert await live.answer_dispatcher(rec.incident_id, "Please repeat that.") == (
        "That isn't visible in the current camera view."
    )
    assert qwen.calls == 2
    assert await live.answer_dispatcher(rec.incident_id, "What color is the door?") == (
        "The door appears gray."
    )
    assert qwen.calls == 3
    assert await live.answer_dispatcher(
        rec.incident_id, "What is happening near the door?"
    ) == "The person is moving east, but I cannot confirm their destination."
    assert qwen.calls == 4
    event_count = len(live_events)
    assert await live.answer_dispatcher(rec.incident_id, "Okay.") == ""
    assert len(live_events) == event_count and qwen.calls == 4
    assert await live.answer_dispatcher(
        rec.incident_id, "really go and all the pressure clear."
    ) == ""
    assert len(live_events) == event_count and qwen.calls == 4

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

    timing_events: list[object] = []

    async def timing_pub(ev: object) -> None:
        timing_events.append(ev)

    class _BlockingAsr:
        started = threading.Event()
        release = threading.Event()

        def transcribe(self, _pcm):
            self.started.set()
            self.release.wait(1)
            return "What is happening near the door?"

    timing_bridge = MediaStreamBridge(
        incident_id=rec.incident_id,
        send=lambda _text: asyncio.sleep(0),
        recv=lambda: asyncio.sleep(0, result=None),
        subscribe=lambda _id: asyncio.Queue(),
        unsubscribe=lambda _id, _q: None,
        publish=timing_pub,
        answer=answer,
    )
    blocking_asr = _BlockingAsr()
    timing_bridge._asr = blocking_asr
    pending = asyncio.create_task(timing_bridge._transcribe_and_publish(b"x" * 48_000))
    try:
        await asyncio.to_thread(blocking_asr.started.wait, 1)
        assert [getattr(event, "text", "") for event in timing_events] == ["One moment."]
    finally:
        blocking_asr.release.set()
    await pending
    assert [getattr(event, "speaker", "") for event in timing_events] == [
        "sentinel",
        "dispatcher",
    ]

    timing_events.clear()
    timing_bridge._asr = type(
        "_SecondAsr", (), {"transcribe": lambda _self, _pcm: "Where is the person?"}
    )()
    await timing_bridge._transcribe_and_publish(b"x" * 48_000)
    assert [getattr(event, "text", "") for event in timing_events] == [
        "Let me check that.",
        "Where is the person?",
    ]

    timing_events.clear()
    timing_bridge._asr = type(
        "_AckAsr", (), {"transcribe": lambda _self, _pcm: "Okay."}
    )()
    await timing_bridge._transcribe_and_publish(b"x" * 40_000)
    assert [getattr(event, "speaker", "") for event in timing_events] == ["dispatcher"]

    timing_events.clear()
    timing_bridge._asr = type(
        "_EmptyAsr", (), {"transcribe": lambda _self, _pcm: ""}
    )()
    await timing_bridge._transcribe_and_publish(b"x" * 48_000)
    assert [getattr(event, "text", "") for event in timing_events] == [
        "Give me a moment.",
        "I didn't catch that. Please repeat.",
    ]

    timing_bridge._tts = type(
        "_Tts", (), {"synthesize": lambda _self, _text: b""}
    )()
    timing_bridge._inbound_buf.extend(b"race-window audio")
    timing_bridge._heard_speech = True
    timing_bridge._turn_q.put_nowait(b"queued race-window turn")
    await timing_bridge._speak("One moment.")
    assert (
        not timing_bridge._inbound_buf
        and timing_bridge._heard_speech is False
        and timing_bridge._turn_q.empty()
    )

    class _SlowAsr:
        active = 0
        max_active = 0

        def transcribe(self, _pcm):
            self.active += 1
            self.max_active = max(self.max_active, self.active)
            time.sleep(0.05)
            self.active -= 1
            return "Repeat that."

    ordered: list[str] = []

    async def ordered_answer(_incident_id: str, question: str) -> str:
        if question == "first":
            await asyncio.sleep(0.05)
        ordered.append(question)
        return "answered"

    bridge.answer = ordered_answer
    bridge._asr = type(
        "_OrderAsr", (), {"transcribe": lambda _self, pcm: pcm.decode()}
    )()
    for utterance in (b"first", b"second", b"third", b"fourth", b"fifth"):
        bridge._inbound_buf.extend(utterance)
        bridge._flush_inbound()
    assert bridge._asr_task is not None
    await bridge._asr_task
    assert ordered == ["first", "second", "third", "fourth", "fifth"]

    slow = _SlowAsr()
    bridge.answer = answer
    bridge._asr = slow
    for utterance in (b"first utterance", b"second utterance"):
        bridge._inbound_buf.extend(utterance)
        bridge._flush_inbound()
    assert bridge._asr_task is not None
    await bridge._asr_task
    assert slow.max_active == 1

    bridge._asr = type("_Asr", (), {"transcribe": lambda _self, _pcm: "Is anyone hurt?"})()
    speech = (1000).to_bytes(2, "little", signed=True) * 320
    silence = b"\0" * 640
    bridge._speaking = True
    bridge._buffer_inbound(speech)
    bridge._speaking = False
    bridge._ignore_inbound_until = time.monotonic() + 1
    bridge._buffer_inbound(speech)
    assert not bridge._inbound_buf
    bridge._ignore_inbound_until = 0
    for _ in range(300):
        bridge._buffer_inbound(silence)
    assert not bridge._inbound_buf
    for _ in range(751):
        bridge._buffer_inbound(speech)
    for _ in range(25):
        bridge._buffer_inbound(silence)
    assert not bridge._inbound_buf and bridge._turn_q.empty()
    for _ in range(10):
        bridge._buffer_inbound(speech)
    for _ in range(25):
        bridge._buffer_inbound(silence)
    assert bridge._asr_task is not None
    await bridge._asr_task
    assert asked[-1] == (rec.incident_id, "Is anyone hurt?")
    print("voice self-check OK")


if __name__ == "__main__":
    asyncio.run(_main())
