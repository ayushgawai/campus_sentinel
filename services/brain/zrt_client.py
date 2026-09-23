"""HP Z Runtime client (OpenAI-compatible on :8000).

Playbook: prefill with frames + factual metadata only
(track_id, camera_id, peak timestamp, target person).
Never send the router's scores to the VLM.

Skeleton: forced/demo classify works offline. Live multimodal classify
is NotImplemented until vision supplies the 16 sampled frames.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from contracts import IncidentClass


DEFAULT_BASE_URL = os.environ.get("ZRT_BASE_URL", "http://127.0.0.1:8000")


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
        timeout_s: float = 30.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.forced = forced
        self.timeout_s = timeout_s

    def health(self) -> bool:
        if self.forced:
            return True
        for path in ("/v1/models", "/health"):
            try:
                req = urllib.request.Request(self.base_url + path, method="GET")
                with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
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

        Live path requires real multimodal prefill (16 frames). Until that
        lands, only forced/demo classify is allowed — no metadata-only fake.
        Router scores must never appear in any future prompt payload.
        """
        _ = (track_id, camera_id, peak_ts_iso, person_hint)  # call-site stable
        if self.forced or class_token_forced is not None:
            token = class_token_forced or IncidentClass.BENIGN
            return self.classify_forced(token)

        raise NotImplementedError(
            "live ZRT classify needs the 16 sampled frames over the wire; "
            "use forced=True / class_token_forced until vision + multimodal client land "
            f"(frames_provided={frames is not None})"
        )

    def _post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        """HTTP helper retained for the upcoming multimodal classify."""
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
