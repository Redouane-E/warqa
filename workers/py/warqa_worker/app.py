"""The HTTP app: JSON in/out, {"error": str} on failure, ~30 MB body limit, CORS for localhost."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import __version__, align, ocr, tashkeel, tts
from .errors import WorkerError
from .util import decode_b64

log = logging.getLogger("warqa_worker")

DEFAULT_MAX_BYTES = 30 * 1024 * 1024
# the studio (vite dev server, preview, the CLI's server) may call the worker from a browser
LOCALHOST_ORIGINS = r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$"


class OcrRequest(BaseModel):
    image_base64: str
    lang: str = "ar"


class AlignRequest(BaseModel):
    audio_base64: str
    text: str
    lang: str = "ar"


class TashkeelRequest(BaseModel):
    text: str


class TtsRequest(BaseModel):
    text: str
    voice: str | None = None
    lang: str = "ar"
    rate: str | None = None


class BodyLimit:
    """Reject bodies over `max_bytes` with 413 before the app parses them (works without Content-Length)."""

    def __init__(self, app: Any, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http" or scope.get("method") in ("GET", "HEAD", "OPTIONS"):
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        length = headers.get(b"content-length")
        if length is not None and length.isdigit() and int(length) > self.max_bytes:
            await self._too_large(send)
            return
        body = bytearray()
        more = True
        while more:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body += message.get("body", b"")
            more = message.get("more_body", False)
            if len(body) > self.max_bytes:
                await self._too_large(send)
                return
        replayed = False

        async def replay() -> Any:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)

    async def _too_large(self, send: Any) -> None:
        payload = json.dumps({"error": f"request body too large (max {self.max_bytes // (1024 * 1024)} MB)"}).encode()
        await send({"type": "http.response.start", "status": 413, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode())]})
        await send({"type": "http.response.body", "body": payload})


def _validation_message(exc: RequestValidationError) -> str:
    parts = []
    for err in exc.errors():
        loc = ".".join(str(x) for x in err.get("loc", ()) if x != "body")
        parts.append(f"{loc}: {err.get('msg', 'invalid')}" if loc else str(err.get("msg", "invalid")))
    return "invalid request: " + "; ".join(parts) if parts else "invalid request body"


def capabilities() -> dict[str, list[str]]:
    return {"ocr": ocr.available(), "align": align.available(), "tashkeel": tashkeel.available(), "tts": tts.available()}


def create_app(max_bytes: int | None = None) -> FastAPI:
    app = FastAPI(title="Warqa worker", version=__version__, docs_url="/docs", redoc_url=None)
    limit = max_bytes or int(os.environ.get("WARQA_WORKER_MAX_BYTES", DEFAULT_MAX_BYTES))
    app.add_middleware(BodyLimit, max_bytes=limit)
    # added last = outermost, so 413s and errors carry CORS headers too
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=os.environ.get("WARQA_WORKER_CORS", LOCALHOST_ORIGINS),
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.exception_handler(WorkerError)
    async def _worker_error(_: Request, exc: WorkerError) -> JSONResponse:
        if exc.status >= 500 and exc.status != 501:
            log.error("%s", exc.message)
        return JSONResponse(exc.body(), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _bad_request(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse({"error": _validation_message(exc)}, status_code=400)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        status = 400 if exc.status_code == 422 else exc.status_code
        return JSONResponse({"error": str(exc.detail)}, status_code=status, headers=getattr(exc, "headers", None))

    @app.exception_handler(Exception)
    async def _crash(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error")
        return JSONResponse({"error": f"{type(exc).__name__}: {exc}"}, status_code=500)

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            "ok": True,
            "version": __version__,
            "capabilities": capabilities(),
            "engines": {"ocr": ocr.details(), "align": align.details(), "tashkeel": tashkeel.details(), "tts": tts.details()},
        }

    # sync handlers: FastAPI runs them in a thread pool, so model inference never blocks the event loop
    @app.post("/ocr")
    def post_ocr(req: OcrRequest) -> dict[str, Any]:
        image = decode_b64(req.image_base64, "image_base64")
        return ocr.ocr(image, req.lang)

    @app.post("/align")
    def post_align(req: AlignRequest) -> dict[str, Any]:
        audio = decode_b64(req.audio_base64, "audio_base64")
        return align.align(audio, req.text, req.lang)

    @app.post("/tashkeel")
    def post_tashkeel(req: TashkeelRequest) -> dict[str, Any]:
        return tashkeel.tashkeel(req.text)

    @app.post("/tts")
    def post_tts(req: TtsRequest) -> dict[str, Any]:
        return tts.tts(req.text, req.voice, req.lang, req.rate)

    return app
