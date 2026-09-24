"""Vision service — decode, ring buffer, YOLO26s-pose, ByteTrack (Pratham)."""

from .bundle import FrameBundle, build_bundle
from .decode import FileSource, Frame, SyntheticSource
from .detector import Detection, PoseDetector
from .fusion import fuse, should_escalate
from .pipeline import Escalation, VisionRouter, tracks_to_overlay
from .ring import RingBuffer
from .rules import FALL, LONG_DWELL, RUN, SUDDEN_ACCEL, evaluate
from .tracker import ByteTracker, Track
from .vadclip import FIGHT, THEFT, VadClip, VadScore

__all__ = [
    "ByteTracker",
    "Detection",
    "Escalation",
    "FALL",
    "FIGHT",
    "FileSource",
    "Frame",
    "FrameBundle",
    "LONG_DWELL",
    "PoseDetector",
    "RUN",
    "RingBuffer",
    "SUDDEN_ACCEL",
    "SyntheticSource",
    "THEFT",
    "Track",
    "VadClip",
    "VadScore",
    "VisionRouter",
    "build_bundle",
    "evaluate",
    "fuse",
    "should_escalate",
    "tracks_to_overlay",
]
