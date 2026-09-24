"""Thin dispatch guardrails (playbook E4) — env-tunable, no model."""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field


@dataclass
class Guardrails:
    """One dispatch per incident; rolling hourly cap; global kill switch."""

    max_dispatches_per_hour: int = field(
        default_factory=lambda: int(os.environ.get("CS_DISPATCH_HOURLY_CAP", "6"))
    )
    _dispatched: set[str] = field(default_factory=set)
    _hour_hits: list[float] = field(default_factory=list)

    @staticmethod
    def kill_switch() -> bool:
        return os.environ.get("CS_KILL_SWITCH", "").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }

    def can_dispatch(self, incident_id: str) -> tuple[bool, str]:
        if self.kill_switch():
            return False, "kill_switch"
        if incident_id in self._dispatched:
            return False, "already_dispatched"
        now = time.monotonic()
        self._hour_hits = [t for t in self._hour_hits if now - t < 3600.0]
        if len(self._hour_hits) >= self.max_dispatches_per_hour:
            return False, "hourly_cap"
        return True, "ok"

    def record_dispatch(self, incident_id: str) -> None:
        self._dispatched.add(incident_id)
        self._hour_hits.append(time.monotonic())


# Process-wide default for api/hub.
DEFAULT_GUARDRAILS = Guardrails()
