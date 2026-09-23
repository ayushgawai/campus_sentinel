"""Deterministic incident state machine (playbook E).

Transitions: NEW → ALERTED → DISPATCH_PENDING → DISPATCHED → TRACKING → RESOLVED
Plus DISMISSED from NEW or ALERTED.
Idempotency: every action keyed on (incident_id, action) — retries no-op.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from contracts import IncidentState


ALLOWED: dict[IncidentState, frozenset[IncidentState]] = {
    IncidentState.NEW: frozenset(
        {IncidentState.ALERTED, IncidentState.DISMISSED}
    ),
    # MINOR path: alert security then close without dispatch.
    # SEVERE path: ALERTED → DISPATCH_PENDING → …
    IncidentState.ALERTED: frozenset(
        {
            IncidentState.DISPATCH_PENDING,
            IncidentState.DISMISSED,
            IncidentState.RESOLVED,
        }
    ),
    IncidentState.DISPATCH_PENDING: frozenset({IncidentState.DISPATCHED}),
    # After dispatch, chase tracking is required before resolve (playbook E chase).
    IncidentState.DISPATCHED: frozenset({IncidentState.TRACKING}),
    IncidentState.TRACKING: frozenset({IncidentState.RESOLVED}),
    IncidentState.RESOLVED: frozenset(),
    IncidentState.DISMISSED: frozenset(),
}


@dataclass
class StateMachine:
    incident_id: str
    state: IncidentState = IncidentState.NEW
    _seen_actions: set[str] = field(default_factory=set)

    def transition(self, new_state: IncidentState, *, action: str) -> IncidentState:
        key = f"{self.incident_id}:{action}"
        if key in self._seen_actions:
            return self.state  # idempotent retry
        if new_state not in ALLOWED[self.state]:
            raise ValueError(
                f"invalid transition {self.state.value} → {new_state.value} "
                f"for action={action!r}"
            )
        self._seen_actions.add(key)
        self.state = new_state
        return self.state

    def can(self, new_state: IncidentState) -> bool:
        return new_state in ALLOWED[self.state]
