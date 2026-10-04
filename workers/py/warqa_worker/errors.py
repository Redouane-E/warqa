"""Errors that map to HTTP statuses. Every error body is JSON: {"error": str} (plus optional extras)."""

from __future__ import annotations

from typing import Any


class WorkerError(Exception):
    status = 500

    def __init__(self, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.message = message
        self.extra = extra

    def body(self) -> dict[str, Any]:
        return {"error": self.message, **self.extra}


class BadInput(WorkerError):
    """400: the request is malformed (bad base64, empty text, unreadable image...)."""

    status = 400


class UnknownVoice(WorkerError):
    """404: the requested voice is not available; the body lists the voices that are."""

    status = 404

    def __init__(self, voice: str, voices: list[str]) -> None:
        listing = ", ".join(voices) if voices else "none"
        super().__init__(f'unknown voice "{voice}"; available voices: {listing}', voices=voices)


class NotInstalled(WorkerError):
    """501: the capability needs an optional package (or system tool) that is not installed."""

    status = 501


class PayloadTooLarge(WorkerError):
    status = 413
