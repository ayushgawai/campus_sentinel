"""Durable history: incidents, calls and transcripts survive Reset and restarts.

Reset starts a new run (fresh dashboard); earlier runs stay in the database.
  CS_DB_PATH=data/runtime/sentinel.db (default)
"""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]

_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
  run_id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS incidents (
  run_id INTEGER NOT NULL,
  incident_id TEXT NOT NULL,
  class_token TEXT, severity TEXT, state TEXT, camera_id TEXT,
  created_at TEXT, updated_at TEXT,
  record TEXT NOT NULL,
  PRIMARY KEY (run_id, incident_id)
);
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  incident_id TEXT, call_sid TEXT, status TEXT NOT NULL, detail TEXT, ts TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage (
  ts TEXT NOT NULL, model TEXT NOT NULL,
  requests REAL, tokens_in REAL, tokens_out REAL, audio_s REAL, chars REAL, frames REAL, live REAL
);
CREATE INDEX IF NOT EXISTS usage_ts ON usage (ts);
CREATE TABLE IF NOT EXISTS transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  incident_id TEXT, speaker TEXT, text TEXT, ts TEXT NOT NULL
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class History:
    # ponytail: synchronous sqlite on the event loop; rows are tiny and rare
    # (a few per second at most). Move to a writer thread if it ever shows in p95.
    def __init__(self, path: str | Path | None = None) -> None:
        raw = path or os.environ.get("CS_DB_PATH") or ROOT / "data" / "runtime" / "sentinel.db"
        self.path = Path(raw)
        if str(self.path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(self.path), isolation_level=None)
        self.db.executescript(_SCHEMA)
        self.run_id = 0
        self.new_run()

    def new_run(self) -> int:
        cur = self.db.execute("INSERT INTO runs (started_at) VALUES (?)", (_now(),))
        self.run_id = int(cur.lastrowid)
        return self.run_id

    def save_incident(self, rec: dict[str, Any]) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO incidents VALUES (?,?,?,?,?,?,?,?,?)",
            (
                self.run_id,
                rec.get("incident_id"),
                rec.get("class_token"),
                rec.get("severity"),
                rec.get("state"),
                rec.get("camera_id"),
                rec.get("created_at"),
                rec.get("updated_at"),
                json.dumps(rec),
            ),
        )

    def save_call(
        self, incident_id: str, status: str, *, call_sid: str = "", detail: str = ""
    ) -> None:
        self.db.execute(
            "INSERT INTO calls (run_id, incident_id, call_sid, status, detail, ts)"
            " VALUES (?,?,?,?,?,?)",
            (self.run_id, incident_id, call_sid, status, detail, _now()),
        )

    def save_transcript(self, env: dict[str, Any]) -> None:
        self.db.execute(
            "INSERT INTO transcripts (run_id, incident_id, speaker, text, ts)"
            " VALUES (?,?,?,?,?)",
            (
                self.run_id,
                env.get("incident_id"),
                env.get("speaker"),
                env.get("text"),
                env.get("ts") or _now(),
            ),
        )

    # Usage is never tied to a run: Reset does not touch it.
    USAGE_FIELDS = ("requests", "tokens_in", "tokens_out", "audio_s", "chars", "frames", "live")

    def save_usage(self, ts: str, by_model: dict[str, dict[str, float]]) -> None:
        self.db.executemany(
            "INSERT INTO usage VALUES (?,?,?,?,?,?,?,?,?)",
            [
                (ts, model, *(float(row.get(f) or 0) for f in self.USAGE_FIELDS))
                for model, row in by_model.items()
            ],
        )

    def usage_totals(self) -> dict[str, float]:
        """All-time sums per field, across every model and run."""
        cols = ", ".join(f"COALESCE(SUM({f}), 0)" for f in self.USAGE_FIELDS)
        row = self.db.execute(f"SELECT {cols} FROM usage").fetchone()
        return dict(zip(self.USAGE_FIELDS, row))

    def usage_buckets(self, since_iso: str, bucket_s: int = 300) -> list[tuple[str, dict]]:
        """Per-bucket, per-model sums since `since_iso`, oldest first."""
        sums = ", ".join(f"SUM({f})" for f in self.USAGE_FIELDS)
        rows = self.db.execute(
            f"SELECT CAST(strftime(\"%s\", substr(ts, 1, 19)) / {bucket_s} AS INTEGER) * {bucket_s} AS b,"
            f" model, {sums} FROM usage WHERE ts >= ? GROUP BY b, model ORDER BY b",
            (since_iso,),
        ).fetchall()
        out: dict[int, dict] = {}
        for b, model, *vals in rows:
            out.setdefault(int(b), {})[model] = {
                f: v for f, v in zip(self.USAGE_FIELDS, vals) if v
            }
        return [
            (datetime.fromtimestamp(b, timezone.utc).isoformat(), by) for b, by in out.items()
        ]

    def rows(self, table: str, run_id: int | None = None) -> list[tuple]:
        assert table in {"runs", "incidents", "calls", "transcripts", "usage"}
        if run_id is None or table == "runs":
            return self.db.execute(f"SELECT * FROM {table}").fetchall()
        return self.db.execute(
            f"SELECT * FROM {table} WHERE run_id = ?", (run_id,)
        ).fetchall()
