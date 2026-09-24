"""HP Z Runtime client (OpenAI-compatible on :8000).

Playbook: prefill with frames + factual metadata only
(track_id, camera_id, peak timestamp, target person).
Never send the router's scores to the VLM.

Forced/demo classify works offline. Live path posts 16 frames to /v1/chat/completions
and reads a single six-class token (Completion A).
"""

from __future__ import annotations

import base64
import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from io import BytesIO
from typing import Any

from contracts import IncidentClass


DEFAULT_BASE_URL = os.environ.get("ZRT_BASE_URL", "http://127.0.0.1:8000")
DEFAULT_MODEL = os.environ.get(
    "ZRT_MODEL", "Qwen/Qwen3-VL-30B-A3B-Instruct-FP8"
)
CLASS_TOKENS = tuple(c.value for c in IncidentClass)
_MAX_SIDE = 384


@dataclass
class ClassifyResult:
    class_token: IncidentClass
    logprob: float
    forced: bool
    raw: dict[str, Any] | None = None


class ZRTClient:
    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        *,
        forced: bool = False,
        timeout_s: float = 90.0,
        model: str = DEFAULT_MODEL,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.forced = forced
        self.timeout_s = timeout_s
        self.model = model

    def health(self) -> bool:
        if self.forced:
            return True
        for path in ("/v1/models", "/health"):
            try:
                req = urllib.request.Request(self.base_url + path, method="GET")
                with urllib.request.urlopen(req, timeout=min(self.timeout_s, 5.0)) as resp:
                    if 200 <= resp.status < 300:
                        return True
            except (urllib.error.URLError, TimeoutError, ValueError):
                continue
        return False

    def classify_forced(self, class_token: IncidentClass) -> ClassifyResult:
        """Demo / scenario path — no network."""
        return ClassifyResult(class_token=class_token, logprob=0.0, forced=True)

    def classify(
        self,
        *,
        class_token_forced: IncidentClass | None = None,
        track_id: str,
        camera_id: str,
        peak_ts_iso: str,
        person_hint: str = "",
        frames: list[Any] | None = None,
    ) -> ClassifyResult:
        """Completion A: single token from the six-class set.

        Live path: 16 frames + facts, never router scores.
        Forced path: offline demo. If both frames and forced=True, forced wins
        so check.py stays network-free.
        """
        has_frames = bool(frames)
        if self.forced or (class_token_forced is not None and not has_frames):
            token = class_token_forced or IncidentClass.BENIGN
            return self.classify_forced(token)
        if not has_frames:
            raise NotImplementedError(
                "live ZRT classify needs the 16 sampled frames over the wire; "
                "use forced=True / class_token_forced until vision supplies frames "
                f"(frames_provided={frames is not None})"
            )
        return self._classify_live(
            track_id=track_id,
            camera_id=camera_id,
            peak_ts_iso=peak_ts_iso,
            person_hint=person_hint,
            frames=list(frames or []),
        )

    def _classify_live(
        self,
        *,
        track_id: str,
        camera_id: str,
        peak_ts_iso: str,
        person_hint: str,
        frames: list[Any],
    ) -> ClassifyResult:
        facts = (
            f"camera_id={camera_id} track_id={track_id} "
            f"peak_ts={peak_ts_iso} target_person={person_hint or 'unspecified'} "
            f"n_frames={len(frames)}"
        )
        # Six-class only. No FIRE. No router scores / fused_prob.
        text = (
            "Classify this campus security clip. Facts only: "
            f"{facts}. Reply with exactly one token from this set: "
            + " ".join(CLASS_TOKENS)
            + "."
        )
        content: list[dict[str, Any]] = [{"type": "text", "text": text}]
        for img in frames[:16]:
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": _jpeg_data_url(img)},
                }
            )
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": 8,
            "temperature": 0.0,
            "logprobs": True,
            "top_logprobs": 5,
        }
        raw = self._post_json("/v1/chat/completions", payload)
        token, logprob = _parse_class_token(raw)
        return ClassifyResult(
            class_token=token, logprob=logprob, forced=False, raw=raw
        )

    def _post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        banned = ("router_score", "fused_prob")
        blob = json.dumps(payload)
        for b in banned:
            if b in blob:
                raise ValueError(f"refusing to send {b} to ZRT")
        body = blob.encode("utf-8")
        req = urllib.request.Request(
            self.base_url + path,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
            return json.loads(resp.read().decode("utf-8"))


def _jpeg_data_url(image: Any) -> str:
    try:
        import numpy as np
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("live classify needs numpy and Pillow") from exc
    arr = np.asarray(image)
    if arr.ndim == 2:
        arr = np.stack([arr, arr, arr], axis=-1)
    if arr.ndim != 3 or arr.shape[2] < 3:
        raise ValueError("frame must be HxWx3")
    arr = arr[:, :, :3]
    if arr.dtype != np.uint8:
        arr = np.clip(arr, 0, 255).astype("uint8")
    h, w = arr.shape[:2]
    m = max(h, w)
    im = Image.fromarray(arr)
    if m > _MAX_SIDE:
        s = _MAX_SIDE / m
        im = im.resize((max(1, int(w * s)), max(1, int(h * s))))
    buf = BytesIO()
    im.save(buf, format="JPEG", quality=80)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


def _parse_class_token(raw: dict[str, Any]) -> tuple[IncidentClass, float]:
    choice = (raw.get("choices") or [{}])[0]
    text = str((choice.get("message") or {}).get("content") or "")
    cleaned = "".join(ch if ch.isalnum() or ch.isspace() else " " for ch in text)
    words = [w.upper() for w in cleaned.split() if w]
    token = IncidentClass.BENIGN
    for w in words:
        if w in CLASS_TOKENS:
            token = IncidentClass(w)
            break
    logprob = -2.3  # ~0.10 if the model did not emit a known token
    lp = ((choice.get("logprobs") or {}).get("content") or [{}])
    if lp and isinstance(lp[0], dict) and "logprob" in lp[0]:
        try:
            logprob = float(lp[0]["logprob"])
        except (TypeError, ValueError):
            pass
    return token, logprob
