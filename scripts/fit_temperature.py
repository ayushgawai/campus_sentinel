"""Fit CS_VLM_TEMPERATURE from labelled live classifications.

Input: the JSONL written by adjudicate when CS_CALIB_LOG=path is set, with a
human-added "label" per row (true class token). Rows without a label are
skipped. Fits one temperature T for sigmoid(logit(p)/T) on "was Qwen's class
right?", minimising NLL (golden-section search over log T, stdlib only).

  python3 scripts/fit_temperature.py calib.jsonl
  python3 scripts/fit_temperature.py --selftest

CPU only, no model calls. Needs roughly 100+ labelled rows before T means much.
"""

from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.brain.fuse import apply_temperature, logprob_to_prob  # noqa: E402

_EPS = 1e-6


def load_rows(path: str) -> list[tuple[float, bool]]:
    rows = []
    for line in Path(path).read_text().splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        label = str(rec.get("label") or "").strip().upper()
        if not label:
            continue
        rows.append((logprob_to_prob(float(rec["logprob"])), rec["class_token"] == label))
    return rows


def nll(rows: list[tuple[float, bool]], t: float) -> float:
    total = 0.0
    for p, ok in rows:
        q = min(max(apply_temperature(p, t), _EPS), 1 - _EPS)
        total -= math.log(q if ok else 1 - q)
    return total / len(rows)


def ece(rows: list[tuple[float, bool]], t: float, bins: int = 10) -> float:
    buckets: list[list[tuple[float, bool]]] = [[] for _ in range(bins)]
    for p, ok in rows:
        q = apply_temperature(p, t)
        buckets[min(bins - 1, int(q * bins))].append((q, ok))
    return sum(
        len(b) / len(rows) * abs(sum(q for q, _ in b) / len(b) - sum(ok for _, ok in b) / len(b))
        for b in buckets
        if b
    )


def fit(rows: list[tuple[float, bool]]) -> float:
    lo, hi = math.log(0.05), math.log(20.0)
    g = (math.sqrt(5) - 1) / 2
    a, b = hi - g * (hi - lo), lo + g * (hi - lo)
    for _ in range(80):
        if nll(rows, math.exp(a)) < nll(rows, math.exp(b)):
            hi, b = b, a
            a = hi - g * (hi - lo)
        else:
            lo, a = a, b
            b = lo + g * (hi - lo)
    return math.exp((lo + hi) / 2)


def report(rows: list[tuple[float, bool]]) -> float:
    t = fit(rows)
    acc = sum(ok for _, ok in rows) / len(rows)
    print(f"rows={len(rows)} accuracy={acc:.3f}")
    print(f"T=1.000 nll={nll(rows, 1.0):.4f} ece={ece(rows, 1.0):.4f}")
    print(f"T={t:.3f} nll={nll(rows, t):.4f} ece={ece(rows, t):.4f}")
    print(f"CS_VLM_TEMPERATURE={t:.3f}")
    return t


def _selftest() -> None:
    # Overconfident synthetic model: true accuracy tracks sigmoid(logit/3).
    rng = random.Random(7)
    rows = []
    for _ in range(2000):
        p = rng.uniform(0.5, 0.999)
        rows.append((p, rng.random() < apply_temperature(p, 3.0)))
    t = report(rows)
    assert 2.4 < t < 3.6, t
    assert nll(rows, t) < nll(rows, 1.0)
    print("fit_temperature selftest OK")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        _selftest()
    elif len(sys.argv) == 2:
        data = load_rows(sys.argv[1])
        if len(data) < 2:
            raise SystemExit("need labelled rows (add \"label\" to CS_CALIB_LOG lines)")
        report(data)
    else:
        raise SystemExit(__doc__)
