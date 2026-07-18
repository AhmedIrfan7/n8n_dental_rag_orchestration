# Lightweight voice fallback: faster-whisper (STT) + Piper (TTS), CPU only.
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake in the Piper voice model at build time (no runtime download flakiness).
ARG PIPER_VOICE=en_US-lessac-medium
RUN mkdir -p /app/voices && \
    curl -fsSL -o /app/voices/${PIPER_VOICE}.onnx \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/${PIPER_VOICE}.onnx" && \
    curl -fsSL -o /app/voices/${PIPER_VOICE}.onnx.json \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/${PIPER_VOICE}.onnx.json"

COPY app.py .

# Pre-download the Whisper model so the container's first real request isn't
# slowed down by (or fails on) a cold download.
ARG WHISPER_MODEL_SIZE=base
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL_SIZE}', device='cpu', compute_type='int8')"

ENV WHISPER_MODEL_SIZE=${WHISPER_MODEL_SIZE}
ENV PIPER_VOICE=${PIPER_VOICE}
ENV PIPER_MODEL_DIR=/app/voices

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=30s \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
