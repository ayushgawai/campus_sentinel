"""python -m services.api"""

from __future__ import annotations

import os
from pathlib import Path


def _load_dotenv() -> None:
    """Load repo `.env` into os.environ if present (never overrides existing)."""
    path = Path(__file__).resolve().parents[2] / ".env"
    if not path.is_file():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip("'").strip('"')
        if key and key not in os.environ:
            os.environ[key] = val


_load_dotenv()

from .server import main  # noqa: E402

if __name__ == "__main__":
    main()
