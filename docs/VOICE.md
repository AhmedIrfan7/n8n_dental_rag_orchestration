# Voice Layer

## Architecture
```
mic (browser client, Phase 10)
  -> POST /webhook/voice/ask (n8n, multipart audio + session_id + website_url)
       -> POST {VOICE_BASE_URL}/transcribe  (STT: audio -> text)
       -> POST /webhook/ask                 (orchestrator: text -> grounded reply)
       -> POST {VOICE_BASE_URL}/speak       (TTS: text -> audio)
  <- audio/wav response
```
`05_voice_ask` (`orchestrator/../voice/prep_ask.js`, `prep_speak.js`) is the n8n glue: one webhook that chains transcription → the existing text orchestrator → synthesis, returning raw audio directly (`responseData: 'firstEntryBinary'`).

## Two backends, one contract
Both expose `POST /transcribe` (multipart `file` field → `{text, duration}`) and `POST /speak` (`{text}` → audio).

- **voicebox** (`../voicebox`, cloned separately, not vendored in this repo) — full-featured local voice studio (Tauri desktop + FastAPI backend), Qwen3-TTS/Chatterbox/Kokoro engines, real Whisper STT. Its `/speak` is an **async job** requiring a pre-cloned voice **profile** (`POST /profiles` + samples first) — richer than a receptionist bot needs, but available as an upgrade path.
- **`voice/fallback`** (this repo) — lightweight, purpose-built: `faster-whisper` (CPU, `base` model) for STT, `Piper` (ONNX, CPU-only, ~60MB voice) for TTS. `/speak` here is **synchronous** (text in, WAV bytes out) — no profile, no polling — because that's all this project actually needs.

`05_voice_ask`'s `VOICE_BASE_URL` constant (in `scripts/build_workflows.js`) points at whichever backend is active; swapping is a one-line change since both speak the same contract.

## voicebox build note
Voicebox's own `.dockerignore` excludes `scripts/` entirely, but its `Dockerfile` needs `scripts/rocm-entrypoint.sh` — the stock repo's Docker build fails outright. Patched locally (`scripts/*` + `!scripts/rocm-entrypoint.sh` exception) to unblock it; this is an upstream bug, not a fork.

## Status (as of the session that added this file)
Both `voicebox` (full rebuild) and `voice/fallback` (lightweight) Docker builds were attempted. **Raw network throughput measured at ~23KB/s** on this machine at the time — a 235KB test file took 10s from pypi.org. At that rate, `voice/fallback`'s ~140MB Whisper model alone is 100+ minutes; voicebox's multi-GB stack (torch, transformers, Qwen3-TTS, Chatterbox) is many hours. Both builds were left running in the background rather than blocking the rest of the project; **the voice layer's code is written and contract-consistent, but the actual containers have not yet been verified running.**

Next session: check whether either background build completed; if so, run the verification steps below. If network is still poor, consider `WHISPER_MODEL_SIZE=tiny` (smaller download) as an interim measure.

## Verification steps (once a backend is running)
```bash
# health
curl http://localhost:8000/health

# TTS smoke test
curl -X POST http://localhost:8000/speak -H "Content-Type: application/json" \
  -d '{"text":"Hello, this is a test."}' --output test.wav

# STT smoke test (needs a real wav file)
curl -X POST http://localhost:8000/transcribe -F "file=@test.wav"

# full voice round-trip via n8n (once 05_voice_ask is deployed)
curl -X POST http://localhost:5679/webhook/voice/ask \
  -F "audio=@test.wav" -F "website_url=https://www.deroodeortho.com/" --output reply.wav
```
