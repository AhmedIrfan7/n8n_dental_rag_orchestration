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

## Status: `voice/fallback` is built, running, and verified working
After several failed attempts (raw network measured at ~23KB/s at one point; pip hit both read-timeouts and one genuine hash-mismatch/corrupted-download; a real missing `requests` dependency bug; and finally an OS-level DNS outage that blocked further rebuilds), the `voice/fallback` container **built successfully and passed real, live smoke tests**:

- `GET /health` → `{"status":"ok",...}`
- `POST /speak` → a genuine 186KB `RIFF/WAVE` audio file (verified via header bytes, not just HTTP 200)
- `POST /transcribe` on that same generated audio → correctly transcribed it back to matching text
- Full round trip through n8n (`POST /webhook/voice/ask`: audio in → transcribe → orchestrator → synthesize → audio out) → returned valid audio, mechanically working end to end

**Known limitation, found via testing, not assumed:** the currently-running container uses Whisper **`tiny`** (chosen for its smaller download while network was bad). Isolated test: speaking "How much does Invisalign cost?" through Piper and transcribing it back with `tiny` produced **"how much does invisible are in cost?"** — the orchestrator then correctly (if unhelpfully) fell back, since that text doesn't match any real intent. This is an STT accuracy gap on domain-specific brand names, not a bug in the orchestrator/RAG pipeline (which has been separately and thoroughly verified via 14/14 passing text-based eval cases).

**Fix in progress, blocked by environment:** `Dockerfile`'s default was bumped to `WHISPER_MODEL_SIZE=base` (better accuracy, worth the extra ~70MB). The rebuild attempt hit a **new, separate problem**: DNS resolution failed completely at the OS level (`nslookup` timed out against the configured resolver) — confirmed as a host-level network issue, not Docker- or code-specific. Once DNS/network recovers, rebuild and re-verify:
```bash
docker compose -f infra/docker-compose.yml build --build-arg WHISPER_MODEL_SIZE=base voice-fallback
docker compose -f infra/docker-compose.yml up -d --force-recreate voice-fallback
# then re-run the "How much does Invisalign cost?" test below and confirm accurate transcription
```

`voicebox` (the full/heavy backend) was not completed — its build kept failing on its own multi-GB dependency chain (torch/transformers/Qwen3-TTS/Chatterbox) under the same network conditions. `voice/fallback` is the actual working backend for this project; voicebox remains a documented upgrade path only.

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

# domain-term accuracy check (the actual gap found in testing)
curl -X POST http://localhost:8000/speak -H "Content-Type: application/json" \
  -d '{"text":"How much does Invisalign cost?"}' --output question.wav
curl -X POST http://localhost:8000/transcribe -F "file=@question.wav"
# should transcribe "Invisalign" correctly (not "invisible are in" - that was the tiny-model failure mode)
```
