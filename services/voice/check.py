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
    print("voice self-check OK")


if __name__ == "__main__":
    asyncio.run(_main())
