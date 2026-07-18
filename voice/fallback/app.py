"""Lightweight voice fallback service.

Same REST contract as voicebox's backend (POST /transcribe, POST /speak,
GET /profiles, GET /health) so the rest of the system (n8n voice glue,
the browser voice client) can point at either implementation without
changes. Unlike voicebox's /speak (async job + requires a pre-cloned
voice profile), this /speak is synchronous - text in, WAV audio out -
which is all a clinic receptionist bot actually needs.

STT: faster-whisper (CPU, small/base model - fast enough for short
utterances on a laptop). TTS: Piper (ONNX, CPU-only, ~60MB voice model,
no GPU dependency at all).
"""

import io
import os
import tempfile
import wave
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

app = FastAPI(title="Voice Fallback Service")

WHISPER_MODEL_SIZE = os.environ.get("WHISPER_MODEL_SIZE", "base")
PIPER_VOICE = os.environ.get("PIPER_VOICE", "en_US-lessac-medium")
PIPER_MODEL_DIR = Path(os.environ.get("PIPER_MODEL_DIR", "/app/voices"))

_whisper_model = None
_piper_voice = None


def get_whisper():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        _whisper_model = WhisperModel(WHISPER_MODEL_SIZE, device="cpu", compute_type="int8")
    return _whisper_model


def get_piper():
    global _piper_voice
    if _piper_voice is None:
        from piper import PiperVoice
        onnx_path = PIPER_MODEL_DIR / f"{PIPER_VOICE}.onnx"
        if not onnx_path.exists():
            raise HTTPException(status_code=503, detail=f"Piper voice model not found at {onnx_path}")
        _piper_voice = PiperVoice.load(str(onnx_path))
    return _piper_voice


@app.get("/health")
def health():
    return {"status": "ok", "whisper_model": WHISPER_MODEL_SIZE, "piper_voice": PIPER_VOICE}


@app.get("/profiles")
def profiles():
    """Static profile list, matching voicebox's shape loosely (name + id)."""
    return [{"id": PIPER_VOICE, "name": PIPER_VOICE, "engine": "piper"}]


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str | None = Form(None),
    model: str | None = Form(None),
):
    """Multipart audio upload -> {text, duration}. Mirrors voicebox's /transcribe shape."""
    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        whisper = get_whisper()
        segments, info = whisper.transcribe(tmp_path, language=language)
        text = "".join(seg.text for seg in segments).strip()
        return {"text": text, "duration": info.duration}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@app.post("/speak")
async def speak(payload: dict):
    """{text, voice?} -> raw WAV audio bytes (synchronous, no job polling)."""
    text = (payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    voice = get_piper()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        voice.synthesize(text, wav_file)
    audio_bytes = buf.getvalue()
    return Response(content=audio_bytes, media_type="audio/wav")
