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
import subprocess
import tempfile
import wave
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

app = FastAPI(title="Voice Fallback Service")

# The browser voice client calls this service directly (cross-origin from
# wherever the static client is served). Local dev tool with no auth/session
# state of its own, so an open CORS policy is fine here.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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


def encode_mp3(wav_bytes: bytes) -> bytes:
    """Piper's raw WAV output is uncompressed (~44KB/sec of audio) - fine on
    localhost, but painfully slow to transfer over a real network (a normal
    reply-length WAV comes out to roughly 1MB). ffmpeg (already in this
    image) re-encodes it to MP3 at a speech-appropriate bitrate, which cuts
    that by roughly 10x with no perceptible quality loss for spoken text -
    this was the actual bottleneck reported between "text appears" and
    "audio starts playing" on a real (non-localhost) connection, not
    synthesis time itself (which was already sub-second).
    """
    proc = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-f", "mp3", "-codec:a", "libmp3lame", "-b:a", "48k", "pipe:1"],
        input=wav_bytes, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError("ffmpeg mp3 encode failed: " + proc.stderr.decode(errors="replace"))
    return proc.stdout


@app.post("/speak")
async def speak(payload: dict):
    """{text, voice?} -> MP3 audio bytes (synchronous, no job polling)."""
    text = (payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    voice = get_piper()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        voice.synthesize(text, wav_file)
    wav_bytes = buf.getvalue()

    try:
        audio_bytes = encode_mp3(wav_bytes)
        media_type = "audio/mpeg"
    except Exception:
        # Never let a broken/missing encoder take down voice replies entirely -
        # fall back to the original (larger but always-correct) WAV bytes.
        audio_bytes = wav_bytes
        media_type = "audio/wav"

    return Response(content=audio_bytes, media_type=media_type)
