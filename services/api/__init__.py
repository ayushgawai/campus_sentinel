"""API service — WS + MJPEG for the officer dashboard."""

from .server import ApiServer, main

__all__ = ["ApiServer", "main"]
