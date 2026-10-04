"""Shared helpers: optional imports, base64, languages, the model cache and licence notices."""

from __future__ import annotations

import base64
import binascii
import importlib
import importlib.util
import logging
import os
import re
import shutil
import sys
import tempfile
import urllib.request
from pathlib import Path
from types import ModuleType

from .errors import BadInput, NotInstalled

log = logging.getLogger("warqa_worker")


def has_module(name: str) -> bool:
    """True when `name` can be imported, without importing it (keeps /health fast).

    A module set to None in sys.modules counts as missing (that is how tests simulate it).
    """
    top = name.split(".")[0]
    for key in {name, top}:
        if key in sys.modules and sys.modules[key] is None:
            return False
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError, AttributeError):
        return False


def require(name: str, *, extra: str, what: str) -> ModuleType:
    """Import an optional module or raise NotInstalled (HTTP 501) naming the extra to install."""
    try:
        return importlib.import_module(name)
    except ImportError as e:
        raise NotInstalled(
            f"{what} is not installed ({e.name or name} missing): install the worker's '{extra}' extra, "
            f"e.g. `uv sync --extra {extra}` in workers/py"
        ) from e


def has_binary(cmd: str) -> bool:
    return shutil.which(cmd) is not None


_DATA_URL = re.compile(r"^data:[^,]*;base64,", re.I)


def decode_b64(value: str, field: str) -> bytes:
    """Strict base64 (standard or URL-safe, optional data: prefix, whitespace ignored) → bytes; 400 otherwise."""
    if not isinstance(value, str) or not value.strip():
        raise BadInput(f"{field} is empty")
    s = _DATA_URL.sub("", value.strip())
    s = re.sub(r"\s+", "", s)
    if "-" in s or "_" in s:
        s = s.replace("-", "+").replace("_", "/")
    s += "=" * (-len(s) % 4)
    try:
        data = base64.b64decode(s, validate=True)
    except (binascii.Error, ValueError) as e:
        raise BadInput(f"{field} is not valid base64: {e}") from e
    if not data:
        raise BadInput(f"{field} decodes to nothing")
    return data


def base_lang(lang: str | None) -> str:
    """'ar-MA' → 'ar', 'fr_FR' → 'fr', None → ''."""
    return re.split(r"[-_]", (lang or "").strip().lower(), maxsplit=1)[0]


def cache_dir(*parts: str) -> Path:
    """Where downloaded models live: $WARQA_WORKER_CACHE, else $XDG_CACHE_HOME/warqa-worker, else ~/.cache/warqa-worker."""
    root = os.environ.get("WARQA_WORKER_CACHE")
    if root:
        base = Path(root)
    else:
        base = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "warqa-worker"
    path = base.joinpath(*parts)
    path.mkdir(parents=True, exist_ok=True)
    return path


def licence_notice(what: str, licence: str, source: str) -> None:
    """One log line per model download, so whoever runs the worker sees what they are fetching."""
    log.warning("[licence] %s: %s (source: %s)", what, licence, source)


def download(url: str, target: Path, *, timeout: float = 60) -> Path:
    """Download to a temp file next to `target`, then rename (no half files on failure)."""
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=f".{target.name}.")
    try:
        with os.fdopen(fd, "wb") as out, urllib.request.urlopen(url, timeout=timeout) as res:  # noqa: S310 (fixed https URLs)
            shutil.copyfileobj(res, out)
        os.replace(tmp, target)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return target
