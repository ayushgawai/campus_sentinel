"""Twilio Media Streams bridge — outbound demo call only.

Env (Naman / voice owner fills these; never commit secrets):
  TWILIO_ACCOUNT_SID
  TWILIO_AUTH_TOKEN
  TWILIO_FROM              E.164 Twilio number
  CS_DEMO_TO_NUMBER        E.164 teammate phone (allowlisted)
  CS_PUBLIC_BASE           https://… public base for TwiML + Media Stream
  CS_KILL_SWITCH=1         blocks all outbound calls
  CS_TWILIO_ENABLED=1      must be set or place_call is a no-op

Never dial 911 / 112 / emergency numbers. Allowlist only.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any

# Hard block — never dial these even if env is wrong.
_BLOCKED = frozenset({"911", "112", "999", "000", "110"})
_E164 = re.compile(r"^\+[1-9]\d{7,14}$")


@dataclass(frozen=True)
class TwilioConfig:
    account_sid: str
    auth_token: str
    from_number: str
    to_number: str
    public_base: str
    enabled: bool


def load_config() -> TwilioConfig | None:
    if os.environ.get("CS_KILL_SWITCH", "").strip() in {"1", "true", "yes"}:
        return None
    if os.environ.get("CS_TWILIO_ENABLED", "").strip() not in {"1", "true", "yes"}:
        return None
    sid = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
    token = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
    frm = os.environ.get("TWILIO_FROM", "").strip()
    to = os.environ.get("CS_DEMO_TO_NUMBER", "").strip()
    base = os.environ.get("CS_PUBLIC_BASE", "").strip().rstrip("/")
    if not all((sid, token, frm, to, base)):
        return None
    if not _E164.match(frm) or not _E164.match(to):
        return None
    digits = re.sub(r"\D", "", to)
    if digits in _BLOCKED or to.lstrip("+") in _BLOCKED:
        raise ValueError("refusing emergency number")
    return TwilioConfig(sid, token, frm, to, base, True)


def twiml_connect_stream(stream_wss_url: str) -> str:
    """TwiML: bidirectional Media Stream only — no <Say>/<Gather>."""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response><Connect>"
        f'<Stream url="{stream_wss_url}" />'
        "</Connect></Response>"
    )


def place_call(incident_id: str, *, config: TwilioConfig | None = None) -> dict[str, Any]:
    """Place outbound demo call. No-op when config missing (keys not yet set)."""
    cfg = config if config is not None else load_config()
    if cfg is None:
        return {"ok": False, "skipped": True, "reason": "twilio_not_configured"}
    # Lazy import so api boots without twilio SDK until keys land.
    try:
        from twilio.rest import Client  # type: ignore
    except ImportError:
        return {"ok": False, "skipped": True, "reason": "twilio_sdk_missing"}
    voice_url = f"{cfg.public_base}/twilio/voice?incident_id={incident_id}"
    client = Client(cfg.account_sid, cfg.auth_token)
    call = client.calls.create(
        to=cfg.to_number,
        from_=cfg.from_number,
        url=voice_url,
        method="POST",
    )
    return {"ok": True, "call_sid": call.sid, "incident_id": incident_id}


def status() -> dict[str, Any]:
    cfg = load_config()
    return {
        "configured": cfg is not None,
        "kill_switch": os.environ.get("CS_KILL_SWITCH", "").strip() in {"1", "true", "yes"},
        "to_set": bool(os.environ.get("CS_DEMO_TO_NUMBER")),
        "public_base_set": bool(os.environ.get("CS_PUBLIC_BASE")),
    }
