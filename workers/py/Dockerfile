# syntax=docker/dockerfile:1
#
# Warqa worker — the optional Python sidecar (Apache-2.0).
#
# Default image: OCR (tesseract with ara/fra/eng + RapidOCR) and Arabic tashkeel (CATT).
#   docker build -t warqa-worker workers/py
#   docker run --rm -p 8790:8790 -v warqa-models:/cache warqa-worker
#
# Optional capabilities (build args, all off by default):
#   --build-arg WITH_ALIGN=1    forced alignment: stable-ts + Whisper (MIT), CPU torch, ffmpeg
#   --build-arg WITH_TTS=1      Piper voices: piper-tts is GPL-3.0-or-later — including it is your choice
#   --build-arg WITH_HABIBI=1   Habibi-TTS Arabic voices (weight licence unverified, see README)
#
# Model weights are NOT baked in. They download on first use into /cache (mount a volume to keep
# them) and every download logs a "[licence]" line naming the model, its licence and its source.

FROM python:3.12-slim

ARG WITH_ALIGN=0
ARG WITH_TTS=0
ARG WITH_HABIBI=0

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    WARQA_WORKER_CACHE=/cache \
    XDG_CACHE_HOME=/cache/xdg \
    HF_HOME=/cache/huggingface \
    UV_NO_CACHE=1

# tesseract + Arabic/French/English traineddata; libgl1/libglib2.0-0 for OpenCV (RapidOCR);
# ffmpeg decodes mp3 for alignment and reference clips for Habibi.
RUN set -eux; \
    pkgs="tesseract-ocr tesseract-ocr-ara tesseract-ocr-fra tesseract-ocr-eng libgl1 libglib2.0-0"; \
    if [ "$WITH_ALIGN" = "1" ] || [ "$WITH_HABIBI" = "1" ]; then pkgs="$pkgs ffmpeg"; fi; \
    apt-get update; \
    apt-get install -y --no-install-recommends $pkgs; \
    rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml README.md ./
COPY warqa_worker ./warqa_worker

# catt-tashkeel declares onnxruntime-gpu, which clashes with onnxruntime: drop it (CPU runtime is used).
# torch (align/habibi) comes from the CPU wheel index, not the multi-GB CUDA build.
RUN set -eux; \
    extras="ocr,tashkeel"; \
    if [ "$WITH_ALIGN" = "1" ]; then extras="$extras,align"; fi; \
    if [ "$WITH_TTS" = "1" ]; then extras="$extras,tts"; fi; \
    if [ "$WITH_HABIBI" = "1" ]; then extras="$extras,habibi"; fi; \
    echo 'onnxruntime-gpu; sys_platform == "never"' > /tmp/overrides.txt; \
    uv pip install --system --torch-backend cpu --overrides /tmp/overrides.txt ".[$extras]"; \
    rm /tmp/overrides.txt; \
    python -c "import warqa_worker, pytesseract, rapidocr, catt_tashkeel"

RUN useradd --create-home --uid 10001 warqa && mkdir -p /cache && chown warqa /cache
USER warqa
VOLUME ["/cache"]

EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
    CMD python -c "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8790/health', timeout=4).status == 200 else 1)"

CMD ["python", "-m", "warqa_worker", "--host", "0.0.0.0", "--port", "8790"]
