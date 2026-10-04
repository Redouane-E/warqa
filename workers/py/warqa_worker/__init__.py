"""Warqa worker: an optional HTTP sidecar for OCR, forced alignment, Arabic diacritics and local speech.

The TypeScript core never imports this package; it calls it over HTTP when `pipeline.worker` is set.
Every engine is optional and imported lazily, so the server starts with only FastAPI installed.
"""

__version__ = "0.1.0"
