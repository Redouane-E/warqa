"""`python -m warqa_worker --port 8790` (or the `warqa-worker` script)."""

from __future__ import annotations

import argparse
import logging
import os


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="warqa-worker", description="Warqa's optional Python worker (OCR, alignment, tashkeel, local TTS).")
    parser.add_argument("--host", default=os.environ.get("WARQA_WORKER_HOST", "127.0.0.1"), help="bind address (default 127.0.0.1; use 0.0.0.0 in containers)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("WARQA_WORKER_PORT", "8790")), help="port (default 8790)")
    parser.add_argument("--log-level", default=os.environ.get("WARQA_WORKER_LOG", "info"), choices=["debug", "info", "warning", "error"])
    args = parser.parse_args(argv)

    logging.basicConfig(level=args.log_level.upper(), format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    import uvicorn

    from .app import create_app

    uvicorn.run(create_app(), host=args.host, port=args.port, log_level=args.log_level)


if __name__ == "__main__":
    main()
