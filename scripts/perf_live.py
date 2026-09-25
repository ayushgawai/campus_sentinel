#!/usr/bin/env python3
"""Live pipeline performance sample (WS + HTTP + optional local vision step).

Does NOT start a second GPU job. Measures against an already-running api.

  PYTHONPATH=. python3 scripts/perf_live.py
  PYTHONPATH=. python3 scripts/perf_live.py --seconds 45 --api http://127.0.0.1:8080
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import statistics
import struct
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _pct(xs: list[float], p: float) -> float | None:
    if not xs:
        return None
    s = sorted(xs)
    i = min(len(s) - 1, max(0, int(round((p / 100.0) * (len(s) - 1)))))
    return s[i]


def http_ms(url: str, timeout: float = 5.0) -> tuple[float, int, int]:
    t0 = time.perf_counter()
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read(65536)
        code = resp.status
    return (time.perf_counter() - t0) * 1000.0, code, len(body)


def zrt_models_ms(base: str = "http://127.0.0.1:8000") -> tuple[float, bool]:
    t0 = time.perf_counter()
    try:
        req = urllib.request.Request(base.rstrip("/") + "/v1/models", method="GET")
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            ok = 200 <= resp.status < 300
            resp.read(4096)
        return (time.perf_counter() - t0) * 1000.0, ok
    except (urllib.error.URLError, TimeoutError, ValueError):
        return (time.perf_counter() - t0) * 1000.0, False


async def ws_sample(host: str, port: int, seconds: float) -> dict:
    reader, writer = await asyncio.open_connection(host, port)
    key = base64.b64encode(os.urandom(16)).decode()
    req = (
        f"GET /ws HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\n"
        f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
        f"Sec-WebSocket-Version: 13\r\n\r\n"
    )
    writer.write(req.encode())
    await writer.drain()
    resp = await reader.readuntil(b"\r\n\r\n")
    if b"101" not in resp:
        raise RuntimeError(f"ws handshake failed: {resp[:80]!r}")

    # start
    payload = json.dumps({"cmd": "start"}).encode()
    mask = b"\x01\x02\x03\x04"
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    header = bytearray([0x81, 0x80 | len(payload)])
    writer.write(header + mask + masked)
    await writer.drain()

    counts: dict[str, int] = defaultdict(int)
    gaps: dict[str, list[float]] = defaultdict(list)
    last: dict[str, float] = {}
    classes: dict[str, int] = defaultdict(int)
    severities: dict[str, int] = defaultdict(int)
    fused: list[float] = []
    t_end = time.perf_counter() + seconds
    t0 = time.perf_counter()

    while time.perf_counter() < t_end:
        try:
            hdr = await asyncio.wait_for(reader.readexactly(2), timeout=2.0)
        except asyncio.TimeoutError:
            continue
        opcode = hdr[0] & 0x0F
        length = hdr[1] & 0x7F
        if length == 126:
            length = struct.unpack("!H", await reader.readexactly(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", await reader.readexactly(8))[0]
        data = await reader.readexactly(length)
        if opcode != 0x1:
            continue
        try:
            msg = json.loads(data.decode())
        except json.JSONDecodeError:
            continue
        typ = msg.get("type") or "?"
        if typ == "ok" or "cmd" in msg and "type" not in msg:
            continue
        now = time.perf_counter()
        counts[typ] += 1
        if typ in last:
            gaps[typ].append((now - last[typ]) * 1000.0)
        last[typ] = now
        if typ == "incident.upsert":
            inc = msg.get("incident") or {}
            classes[str(inc.get("class_token") or "?")] += 1
            severities[str(inc.get("severity") or "?")] += 1
            try:
                fused.append(float(inc.get("fused_prob")))
            except (TypeError, ValueError):
                pass

    writer.close()
    elapsed = time.perf_counter() - t0

    def gap_stats(name: str) -> dict:
        xs = gaps.get(name) or []
        if not xs:
            return {"n": counts.get(name, 0), "hz": counts.get(name, 0) / elapsed}
        return {
            "n": counts.get(name, 0),
            "hz": counts.get(name, 0) / elapsed,
            "gap_ms_p50": _pct(xs, 50),
            "gap_ms_p95": _pct(xs, 95),
            "gap_ms_max": max(xs),
        }

    return {
        "elapsed_s": round(elapsed, 2),
        "counts": dict(counts),
        "overlay.boxes": gap_stats("overlay.boxes"),
        "incident.upsert": gap_stats("incident.upsert"),
        "call.transcript_delta": gap_stats("call.transcript_delta"),
        "classes": dict(classes),
        "severities": dict(severities),
        "fused_prob": {
            "n": len(fused),
            "mean": statistics.fmean(fused) if fused else None,
            "p50": _pct(fused, 50),
            "p95": _pct(fused, 95),
            "max": max(fused) if fused else None,
        },
    }


def local_vision_step_ms(n: int = 5) -> dict | None:
    """Optional: time VisionRouter.step on CPU (same flags as lab). Skip if import fails."""
    os.environ.setdefault("CS_VISION_YOLO", "pt")
    os.environ.setdefault("CS_VISION_DEVICE", "cpu")
    try:
        from services.vision.decode import FileSource
        from services.vision.pipeline import VisionRouter
    except Exception as exc:
        return {"skipped": True, "reason": str(exc)}
    feed = ROOT / "data" / "feeds" / "seville_option1_3cam_locked.json"
    if not feed.is_file():
        return {"skipped": True, "reason": "missing seville feed json"}
    data = json.loads(feed.read_text())
    roots = data.get("media_root") or {}
    media = None
    for key in ("zgx", "mac_mount"):
        raw = roots.get(key)
        if raw and Path(raw).expanduser().is_dir():
            media = Path(raw).expanduser()
            break
    if media is None:
        return {"skipped": True, "reason": "seville media missing"}
    paths = {c["camera_id"]: str(media / c["file"]) for c in data["cameras"]}
    src = FileSource(paths)
    router = VisionRouter(list(paths), forced=False, source=src)
    times: list[float] = []
    boxes = 0
    escs = 0
    try:
        for _ in range(n):
            t0 = time.perf_counter()
            ovs = router.step()
            times.append((time.perf_counter() - t0) * 1000.0)
            boxes += sum(len(o.boxes) for o in ovs)
            escs += len(router.last_escalations)
    finally:
        src.close()
    return {
        "steps": n,
        "step_ms_p50": _pct(times, 50),
        "step_ms_p95": _pct(times, 95),
        "step_ms_max": max(times) if times else None,
        "boxes_total": boxes,
        "escalations_total": escs,
        "device": os.environ.get("CS_VISION_DEVICE", "cuda:0"),
        "yolo": "yolo26s-pose.pt",
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default=os.environ.get("CS_API", "http://127.0.0.1:8080"))
    ap.add_argument("--zrt", default=os.environ.get("ZRT_BASE_URL", "http://127.0.0.1:8000"))
    ap.add_argument("--seconds", type=float, default=30.0)
    ap.add_argument("--vision-steps", type=int, default=0, help="extra local CPU steps (0=skip)")
    ap.add_argument(
        "--out",
        default=str(ROOT / "bench" / "perf_latest.json"),
    )
    args = ap.parse_args()
    api = args.api.rstrip("/")
    from urllib.parse import urlparse

    u = urlparse(api)
    host = u.hostname or "127.0.0.1"
    port = u.port or 8080

    report: dict = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "api": api,
        "zrt": args.zrt,
    }

    try:
        ms, code, _ = http_ms(api + "/health")
        report["health_ms"] = round(ms, 1)
        report["health_code"] = code
    except Exception as exc:
        report["health_error"] = str(exc)

    try:
        ms, code, n = http_ms(api + "/mjpeg/cam-01", timeout=8.0)
        report["mjpeg_first_chunk_ms"] = round(ms, 1)
        report["mjpeg_code"] = code
        report["mjpeg_bytes"] = n
    except Exception as exc:
        report["mjpeg_error"] = str(exc)

    zms, zok = zrt_models_ms(args.zrt)
    report["zrt_models_ms"] = round(zms, 1)
    report["zrt_ok"] = zok

    report["ws"] = asyncio.run(ws_sample(host, port, args.seconds))

    if args.vision_steps > 0:
        report["local_vision_step"] = local_vision_step_ms(args.vision_steps)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    print(f"\nwrote {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
