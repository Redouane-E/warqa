from __future__ import annotations

import base64
import io
import struct
import sys
import wave
import zlib

import pytest
from fastapi.testclient import TestClient

from warqa_worker.app import create_app

# every optional package an engine may import
OPTIONAL_MODULES = [
    "pytesseract",
    "PIL",
    "rapidocr",
    "rapidocr_onnxruntime",
    "onnxruntime",
    "bidi",
    "stable_whisper",
    "catt_tashkeel",
    "piper",
    "habibi_tts",
    "f5_tts",
]


@pytest.fixture(autouse=True)
def _isolated_cache(tmp_path, monkeypatch):
    monkeypatch.setenv("WARQA_WORKER_CACHE", str(tmp_path / "cache"))
    for key in ("WARQA_OCR_ENGINES", "WARQA_TTS_VOICE_AR", "WARQA_WORKER_MAX_BYTES"):
        monkeypatch.delenv(key, raising=False)


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def block(monkeypatch: pytest.MonkeyPatch, *names: str) -> None:
    """Make `import name` fail (sys.modules[name] = None), as if the package were not installed."""
    for name in names or OPTIONAL_MODULES:
        monkeypatch.setitem(sys.modules, name, None)


@pytest.fixture
def no_engines(monkeypatch):
    block(monkeypatch)


def tiny_png() -> bytes:
    """A valid 1×1 white PNG built by hand (no Pillow needed)."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    raw = zlib.compress(b"\x00\xff\xff\xff")
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")


def tiny_wav(seconds: float = 0.1, rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(seconds * rate))
    return buf.getvalue()


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")
