# workers/py — optional Python worker

Read the root `AGENTS.md` first; this file adds what applies inside `workers/py/`.

- Optional FastAPI service (OCR, alignment, diacritics, local voices). The TypeScript core never imports it.
  It is reached over HTTP when `pipeline.worker` is set.
- Run it with uv: `cd workers/py && uv run --locked --with pytest pytest -q`. Change dependencies in
  `pyproject.toml`, then run `uv lock`; never edit `uv.lock` by hand.
- Heavy engines are optional extras. Tests stub them (`tests/conftest.py`). Each engine states its licence;
  research-only or non-commercial weights must say so.
