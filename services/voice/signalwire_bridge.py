"""SignalWire Compatibility API bridge for the outbound demo call."""

from __future__ import annotations

import base64
import json
import os
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

_BLOCKED = frozenset({"911", "112", "999", "000", "110"})
_E164 = re.compile(r"^\+[1-9]\d{7,14}$")


@dataclass(frozen=True)
class SignalWireConfig:
    space: str
    project_id: str
    api_token: str
    from_number: str
    to_number: str
    public_base: str
    enabled: bool


def load_config() -> SignalWireConfig | None:
    if os.environ.get("CS_KILL_SWITCH", "").strip().lower() in {"1", "true", "yes"}:
        return None
    if os.environ.get("CS_SIGNALWIRE_ENABLED", "").strip().lower() not in {"1", "true", "yes"}:
        return None
    space = os.environ.get("SIGNALWIRE_SPACE", "").strip()
    project = os.environ.get("SIGNALWIRE_PROJECT_ID", "").strip()
    token = os.environ.get("SIGNALWIRE_API_TOKEN", "").strip()
    frm = os.environ.get("SIGNALWIRE_FROM", "").strip()
    to = os.environ.get("CS_DEMO_TO_NUMBER", "").strip()
    base = os.environ.get("CS_PUBLIC_BASE", "").strip().rstrip("/")
    if not all((space, project, token, frm, to, base)):
        return None
    if not _E164.fullmatch(frm) or not _E164.fullmatch(to):
        return None
    if to.lstrip("+") in _BLOCKED:
        raise ValueError("refusing emergency number")
    space = space.removeprefix("https://").removeprefix("http://").rstrip("/")
    return SignalWireConfig(space, project, token, frm, to, base, True)


def cxml_connect_stream(stream_wss_url: str) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response><Connect>"
        f'<Stream url="{stream_wss_url}" />'
        "</Connect></Response>"
    )


def build_call_request(cfg: SignalWireConfig, incident_id: str) -> Request:
    endpoint = (
        f"https://{cfg.space}/api/laml/2010-04-01/Accounts/"
        f"{quote(cfg.project_id, safe='')}/Calls.json"
    )
    voice_url = f"{cfg.public_base}/signalwire/voice?{urlencode({'incident_id': incident_id})}"
    body = urlencode(
        {"To": cfg.to_number, "From": cfg.from_number, "Url": voice_url, "Method": "POST"}
    ).encode()
    auth = base64.b64encode(f"{cfg.project_id}:{cfg.api_token}".encode()).decode()
    return Request(
        endpoint,
        data=body,
        headers={
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )


def place_call(incident_id: str, *, config: SignalWireConfig | None = None) -> dict[str, Any]:
    cfg = config if config is not None else load_config()
    if cfg is None:
        return {"ok": False, "skipped": True, "reason": "signalwire_not_configured"}
    with urlopen(build_call_request(cfg, incident_id), timeout=15) as response:
        payload = json.loads(response.read().decode())
    sid = payload.get("sid") or payload.get("call_sid")
    return {"ok": bool(sid), "call_sid": sid, "incident_id": incident_id}


def send_sms(body: str, *, config: SignalWireConfig | None = None) -> dict[str, Any]:
    """Text the demo phone (operator broadcast / SOS)."""
    cfg = config if config is not None else load_sms_config()
    if cfg is None:
        return {"ok": False, "skipped": True, "reason": "signalwire_not_configured"}
    endpoint = (
        f"https://{cfg.space}/api/laml/2010-04-01/Accounts/"
        f"{quote(cfg.project_id, safe='')}/Messages.json"
    )
    auth = base64.b64encode(f"{cfg.project_id}:{cfg.api_token}".encode()).decode()
    req = Request(
        endpoint,
        data=urlencode({"From": cfg.from_number, "To": cfg.to_number, "Body": body[:1500]}).encode(),
        headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urlopen(req, timeout=15) as response:
        payload = json.loads(response.read().decode())
    return {"ok": bool(payload.get("sid")), "sid": payload.get("sid"), "status": payload.get("status")}


def sos_call(text: str, *, config: SignalWireConfig | None = None) -> dict[str, Any]:
    """Fallback when texting is refused (10DLC campaign): call and read it aloud."""
    cfg = config if config is not None else load_config()
    if cfg is None:
        return {"ok": False, "skipped": True, "reason": "signalwire_not_configured"}
    endpoint = (
        f"https://{cfg.space}/api/laml/2010-04-01/Accounts/"
        f"{quote(cfg.project_id, safe='')}/Calls.json"
    )
    url = f"{cfg.public_base}/signalwire/sos?{urlencode({'text': text[:500]})}"
    auth = base64.b64encode(f"{cfg.project_id}:{cfg.api_token}".encode()).decode()
    req = Request(
        endpoint,
        data=urlencode({"To": cfg.to_number, "From": cfg.from_number, "Url": url, "Method": "POST"}).encode(),
        headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urlopen(req, timeout=15) as response:
        payload = json.loads(response.read().decode())
    return {"ok": bool(payload.get("sid")), "sid": payload.get("sid"), "via": "call"}


def cxml_say(text: str) -> str:
    from xml.sax.saxutils import escape

    said = escape(text)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f"<Response><Say>{said}</Say><Pause length=\"1\"/><Say>{said}</Say><Hangup/></Response>"
    )


def load_sms_config() -> SignalWireConfig | None:
    """Texts need credentials only: they work even while calls are scripted."""
    if os.environ.get("CS_KILL_SWITCH", "").strip().lower() in {"1", "true", "yes"}:
        return None
    vals = [os.environ.get(k, "").strip() for k in (
        "SIGNALWIRE_SPACE", "SIGNALWIRE_PROJECT_ID", "SIGNALWIRE_API_TOKEN", "SIGNALWIRE_FROM", "CS_DEMO_TO_NUMBER")]
    if not all(vals) or not all(_E164.fullmatch(v) for v in vals[3:]):
        return None
    if vals[4].lstrip("+") in _BLOCKED:
        raise ValueError("refusing emergency number")
    space = vals[0].removeprefix("https://").removeprefix("http://").rstrip("/")
    return SignalWireConfig(space, vals[1], vals[2], vals[3], vals[4], "", True)


def hangup_call(call_sid: str, *, config: SignalWireConfig | None = None) -> bool:
    """End a live call (Reset must leave no call running on the phone)."""
    cfg = config if config is not None else load_config()
    if cfg is None or not call_sid:
        return False
    endpoint = (
        f"https://{cfg.space}/api/laml/2010-04-01/Accounts/"
        f"{quote(cfg.project_id, safe='')}/Calls/{quote(call_sid, safe='')}.json"
    )
    auth = base64.b64encode(f"{cfg.project_id}:{cfg.api_token}".encode()).decode()
    req = Request(
        endpoint,
        data=urlencode({"Status": "completed"}).encode(),
        headers={
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    with urlopen(req, timeout=10) as response:
        return 200 <= response.status < 300


def service_ready(url: str) -> bool:
    """Probe the service's /health endpoint; configuration alone is not readiness."""
    if not url:
        return False
    try:
        parts = urlsplit(url)
        health_url = urlunsplit((parts.scheme, parts.netloc, "/health", "", ""))
        with urlopen(health_url, timeout=1) as response:
            payload = json.loads(response.read().decode())
        return payload.get("ok") is True
    except (OSError, ValueError, json.JSONDecodeError):
        return False


def status() -> dict[str, Any]:
    enabled = os.environ.get("CS_SIGNALWIRE_ENABLED", "").strip().lower() in {"1", "true", "yes"}
    kill_switch = os.environ.get("CS_KILL_SWITCH", "").strip().lower() in {"1", "true", "yes"}
    keys = (
        "SIGNALWIRE_SPACE",
        "SIGNALWIRE_PROJECT_ID",
        "SIGNALWIRE_API_TOKEN",
        "SIGNALWIRE_FROM",
        "CS_DEMO_TO_NUMBER",
        "CS_PUBLIC_BASE",
    )
    missing = [key for key in keys if not os.environ.get(key, "").strip()]
    if not enabled:
        missing.insert(0, "CS_SIGNALWIRE_ENABLED")
    if kill_switch:
        missing.insert(0, "kill_switch_on")
    return {
        "configured": load_config() is not None,
        "enabled_flag": enabled,
        "kill_switch": kill_switch,
        "missing": missing,
        "parakeet": bool(os.environ.get("CS_PARAKEET_URL")),
        "kokoro": bool(os.environ.get("CS_KOKORO_URL")),
    }
