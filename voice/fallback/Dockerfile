# Lightweight voice fallback: faster-whisper (STT) + Piper (TTS), CPU only.
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# Network on this host has been measured very slow but steady - pip's
# default read-timeout is too short for that (it gives up between chunks
# even though the download IS still progressing), causing spurious
# ReadTimeoutError failures. Raise the timeout and add retries.
RUN pip install --no-cache-dir --timeout 300 --retries 10 -r requirements.txt

# Bake in the Piper voice model at build time (no runtime download flakiness).
# --retry/--retry-all-errors so a stalled connection is retried, not fatal.
ARG PIPER_VOICE=en_US-lessac-medium
RUN mkdir -p /app/voices && \
    curl --retry 10 --retry-all-errors --retry-delay 5 -fsSL -o /app/voices/${PIPER_VOICE}.onnx \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/${PIPER_VOICE}.onnx" && \
    curl --retry 10 --retry-all-errors --retry-delay 5 -fsSL -o /app/voices/${PIPER_VOICE}.onnx.json \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/${PIPER_VOICE}.onnx.json"

# Pre-download the Whisper model so the container's first real request isn't
# slowed down by (or fails on) a cold download. "base" gives meaningfully
# better accuracy on domain terms (e.g. "Invisalign") than "tiny" - worth
# the extra ~70MB. Override with --build-arg WHISPER_MODEL_SIZE=tiny if a
# smaller download is needed again.
ARG WHISPER_MODEL_SIZE=base
ENV HF_HUB_DOWNLOAD_TIMEOUT=300
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL_SIZE}', device='cpu', compute_type='int8')"

# COPY app.py comes AFTER every model download, not before - app.py changes
# on every code iteration, and Docker invalidates every layer after the one
# that changed. With this ordering, an app.py-only change (the common case)
# never re-triggers the whisper/piper downloads above, which matters a lot
# on a slow connection (previously re-downloaded the whisper model on every
# single code change, taking many minutes each time for no reason).
COPY app.py .

ENV WHISPER_MODEL_SIZE=${WHISPER_MODEL_SIZE}
ENV PIPER_VOICE=${PIPER_VOICE}
ENV PIPER_MODEL_DIR=/app/voices

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=30s \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
