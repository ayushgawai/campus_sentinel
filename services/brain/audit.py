"""Append-only audit log (playbook E).

Every action, reason, confidence, timestamp. In-memory for now; callers can
flush to disk later without changing the call site.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from contracts import utcnow


@dataclass(frozen=True)
class AuditEntry:
    ts: datetime
    incident_id: str
    action: str
    reason: str
    confidence: float
    detail: dict[str, Any] = field(default_factory=dict)


class AuditLog:
    def __init__(self) -> None:
        self._entries: list[AuditEntry] = []

    def record(
        self,
        *,
        incident_id: str,
        action: str,
        reason: str,
        confidence: float,
        detail: dict[str, Any] | None = None,
        ts: datetime | None = None,
    ) -> AuditEntry:
        entry = AuditEntry(
            ts=ts or utcnow(),
            incident_id=incident_id,
            action=action,
            reason=reason,
            confidence=confidence,
            detail=dict(detail or {}),
        )
        self._entries.append(entry)
        return entry

    def entries(self, incident_id: str | None = None) -> list[AuditEntry]:
        if incident_id is None:
            return list(self._entries)
        return [e for e in self._entries if e.incident_id == incident_id]

    def clear(self) -> None:
        self._entries.clear()
