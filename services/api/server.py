"""stdlib asyncio API on :8080 — /health, /ws, /mjpeg/{camera_id}.

No third-party deps. WebSocket is a minimal RFC6455 server sufficient for
one JSON object per text frame (contracts/events.py envelopes).
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import os
import struct
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from .hub import DemoHub, dumps
from .vision_bridge import VisionBridge, vision_enabled

DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8080

# Seville locked pack (sibling of repo). Override with CS_MEDIA_ROOT.
_REPO = Path(__file__).resolve().parents[2]
_DEFAULT_MEDIA = (
    _REPO.parent / "campus_sentinel_media" / "feeds" / "seville_option1_3cam_locked"
)
MEDIA_ROOT = Path(os.environ.get("CS_MEDIA_ROOT", str(_DEFAULT_MEDIA)))

CLIP_BY_CAM = {
    "cam-01": "CAM01_lobby_entrance_IN_then_OUT_339s.mp4",
    "cam-02": "CAM02_hallway_east_IN_then_OUT_339s.mp4",
    "cam-03": "CAM03_hallway_west_IN_then_OUT_339s.mp4",
}


class WsClient:
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self.reader = reader
        self.writer = writer
        self.alive = True

    async def send_text(self, data: bytes) -> None:
        if not self.alive:
            return
        header = bytearray([0x81])
        n = len(data)
        if n < 126:
            header.append(n)
        elif n < (1 << 16):
            header.append(126)
            header.extend(struct.pack("!H", n))
        else:
            header.append(127)
            header.extend(struct.pack("!Q", n))
        self.writer.write(header + data)
        await self.writer.drain()

    async def recv_text(self) -> str | None:
        hdr = await self.reader.readexactly(2)
        opcode = hdr[0] & 0x0F
        masked = (hdr[1] & 0x80) != 0
        length = hdr[1] & 0x7F
        if length == 126:
            length = struct.unpack("!H", await self.reader.readexactly(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", await self.reader.readexactly(8))[0]
        mask = await self.reader.readexactly(4) if masked else b""
        payload = bytearray(await self.reader.readexactly(length))
        if masked:
            for i in range(len(payload)):
                payload[i] ^= mask[i % 4]
        if opcode == 0x8:  # close
            self.alive = False
            return None
        if opcode == 0x9:  # ping → pong
            self.writer.write(bytes([0x8A, len(payload)]) + payload)
            await self.writer.drain()
            return await self.recv_text()
        if opcode != 0x1:
            return await self.recv_text()
        return payload.decode("utf-8")

    def close(self) -> None:
        self.alive = False
        try:
            self.writer.close()
        except Exception:
            pass


class ApiServer:
    def __init__(self, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT):
        self.host = host
        self.port = port
        self.clients: set[WsClient] = set()
        self.hub = DemoHub(broadcast=self.broadcast)
        self.vision = VisionBridge(self.hub) if vision_enabled() else None

    async def broadcast(self, envelope: dict[str, Any]) -> None:
        blob = dumps(envelope)
        dead: list[WsClient] = []
        for c in list(self.clients):
            try:
                await c.send_text(blob)
            except Exception:
                dead.append(c)
        for c in dead:
            self.clients.discard(c)
            c.close()

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            req = await reader.readuntil(b"\r\n\r\n")
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError):
            writer.close()
            return
        head = req.decode("latin-1", errors="replace")
        lines = head.split("\r\n")
        if not lines:
            writer.close()
            return
        parts = lines[0].split()
        if len(parts) < 2:
            writer.close()
            return
        method, path = parts[0], parts[1]
        headers = {}
        for line in lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()

        if method == "GET" and path.startswith("/ws"):
            await self._ws(reader, writer, headers)
            return
        if method == "GET" and (path == "/health" or path.startswith("/health?")):
            await self._http_json(writer, 200, {"ok": True, "service": "api"})
            return
        if method == "GET" and path.startswith("/mjpeg/"):
            cam = unquote(path[len("/mjpeg/") :].split("?")[0])
            await self._mjpeg(writer, cam)
            return
        if method == "OPTIONS":
            await self._http_raw(
                writer,
                204,
                b"",
                extra={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                    "Access-Control-Allow-Methods": "GET,OPTIONS",
                },
            )
            return
        await self._http_raw(writer, 404, b"not found\n")

    async def _ws(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
        headers: dict[str, str],
    ) -> None:
        key = headers.get("sec-websocket-key", "")
        if not key:
            await self._http_raw(writer, 400, b"missing websocket key\n")
            return
        accept = base64.b64encode(
            hashlib.sha1(
                (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()
            ).digest()
        ).decode()
        resp = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n"
            "Access-Control-Allow-Origin: *\r\n"
            "\r\n"
        )
        writer.write(resp.encode())
        await writer.drain()

        client = WsClient(reader, writer)
        self.clients.add(client)
        first = len(self.clients) == 1
        try:
            if first:
                await self.hub.seed()
                await self.hub.start_loops()
                if self.vision is not None:
                    self.vision.start()
            while client.alive:
                raw = await client.recv_text()
                if raw is None:
                    break
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    await client.send_text(dumps({"ok": False, "error": "bad json"}))
                    continue
                if isinstance(msg, dict) and (
                    "cmd" in msg or msg.get("type") == "demo.control"
                ):
                    if msg.get("type") == "demo.control":
                        action = msg.get("action")
                        msg = {
                            "cmd": {
                                "scenario": "runScenario",
                                "reset": "reset",
                                "prewarm": "start",
                            }.get(action, action),
                            "scenario_id": msg.get("scenario_id"),
                        }
                    result = await self.hub.handle_cmd(msg)
                    if result is not None:
                        await client.send_text(dumps(result))
        except (asyncio.IncompleteReadError, ConnectionResetError, BrokenPipeError):
            pass
        finally:
            self.clients.discard(client)
            client.close()
            if not self.clients:
                await self.hub.stop_loops()
                if self.vision is not None:
                    await self.vision.stop()

    async def _mjpeg(self, writer: asyncio.StreamWriter, camera_id: str) -> None:
        name = CLIP_BY_CAM.get(camera_id)
        path = MEDIA_ROOT / name if name else None
        if path is None or not path.is_file():
            await self._http_raw(writer, 404, b"no clip for camera\n")
            return
        # Multipart MJPEG via ffmpeg. Falls back to 503 if ffmpeg missing.
        try:
            proc = await asyncio.create_subprocess_exec(
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-re",
                "-stream_loop",
                "-1",
                "-i",
                str(path),
                "-f",
                "mjpeg",
                "-q:v",
                "8",
                "pipe:1",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
        except FileNotFoundError:
            await self._http_raw(writer, 503, b"ffmpeg not available\n")
            return
        boundary = b"frame"
        header = (
            b"HTTP/1.1 200 OK\r\n"
            b"Content-Type: multipart/x-mixed-replace; boundary=frame\r\n"
            b"Access-Control-Allow-Origin: *\r\n"
            b"Cache-Control: no-cache\r\n"
            b"Connection: close\r\n"
            b"\r\n"
        )
        writer.write(header)
        assert proc.stdout is not None
        buf = b""
        try:
            while True:
                chunk = await proc.stdout.read(4096)
                if not chunk:
                    break
                buf += chunk
                while True:
                    start = buf.find(b"\xff\xd8")
                    end = buf.find(b"\xff\xd9", start + 2)
                    if start < 0 or end < 0:
                        if start > 0:
                            buf = buf[start:]
                        break
                    end += 2
                    frame = buf[start:end]
                    buf = buf[end:]
                    part = (
                        b"--"
                        + boundary
                        + b"\r\nContent-Type: image/jpeg\r\nContent-Length: "
                        + str(len(frame)).encode()
                        + b"\r\n\r\n"
                        + frame
                        + b"\r\n"
                    )
                    writer.write(part)
                    await writer.drain()
        except (ConnectionResetError, BrokenPipeError):
            pass
        finally:
            proc.kill()
            try:
                await proc.wait()
            except Exception:
                pass
            try:
                writer.close()
            except Exception:
                pass

    async def _http_json(
        self, writer: asyncio.StreamWriter, code: int, obj: dict[str, Any]
    ) -> None:
        body = dumps(obj)
        await self._http_raw(
            writer,
            code,
            body,
            extra={
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
        )

    async def _http_raw(
        self,
        writer: asyncio.StreamWriter,
        code: int,
        body: bytes,
        *,
        extra: dict[str, str] | None = None,
    ) -> None:
        reason = {200: "OK", 204: "No Content", 400: "Bad Request", 404: "Not Found", 503: "Unavailable"}.get(
            code, "OK"
        )
        headers = {
            "Content-Length": str(len(body)),
            "Connection": "close",
            **(extra or {}),
        }
        lines = [f"HTTP/1.1 {code} {reason}"] + [f"{k}: {v}" for k, v in headers.items()]
        writer.write(("\r\n".join(lines) + "\r\n\r\n").encode() + body)
        await writer.drain()
        writer.close()

    async def run(self) -> None:
        server = await asyncio.start_server(self.handle, self.host, self.port)
        addrs = ", ".join(str(s.getsockname()) for s in server.sockets or [])
        print(f"api listening on {addrs}  (/health /ws /mjpeg/{{cam}})", flush=True)
        async with server:
            await server.serve_forever()


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description="Campus Sentinel api")
    p.add_argument("--host", default=DEFAULT_HOST)
    p.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = p.parse_args(argv)
    asyncio.run(ApiServer(args.host, args.port).run())


if __name__ == "__main__":
    main()
