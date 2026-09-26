# contracts/ — FROZEN after this commit (schema_version 1.0)

Files:
- `incident.py` — IncidentRecord, states, 6-class tokens, severity
- `events.py` — WebSocket event types (no pixel payloads); `usage.tick` = per-window counts by model id every 10 s, sent only when non-empty
- `call_brief.py` — facts-only brief for voice tools

Do not add or rename fields without messaging the group first.
