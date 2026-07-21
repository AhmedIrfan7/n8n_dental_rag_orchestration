# Voice Layer

## Architecture
```
mic (browser client, Phase 10)
  -> POST /webhook/voice/ask (n8n, multipart audio + session_id + website_url)
       -> POST {VOICE_BASE_URL}/transcribe  (STT: audio -> text)
       -> POST /webhook/ask                 (orchestrator: text -> grounded reply)
       -> POST {VOICE_BASE_URL}/speak       (TTS: text -> audio)
  <- audio/mpeg (mp3) response
```
`05_voice_ask` (`orchestrator/../voice/prep_ask.js`, `prep_speak.js`) is the n8n glue: one webhook that chains transcription → the existing text orchestrator → synthesis, returning raw audio directly (`responseData: 'firstEntryBinary'`).

## Two backends, one contract
Both expose `POST /transcribe` (multipart `file` field → `{text, duration}`) and `POST /speak` (`{text}` → audio).

- **voicebox** (`../voicebox`, cloned separately, not vendored in this repo) — full-featured local voice studio (Tauri desktop + FastAPI backend), Qwen3-TTS/Chatterbox/Kokoro engines, real Whisper STT. Its `/speak` is an **async job** requiring a pre-cloned voice **profile** (`POST /profiles` + samples first) — richer than a receptionist bot needs, but available as an upgrade path.
- **`voice/fallback`** (this repo) — lightweight, purpose-built: `faster-whisper` (CPU, `base` model) for STT, `Piper` (ONNX, CPU-only, ~60MB voice) for TTS. `/speak` here is **synchronous** (text in, MP3 bytes out) — no profile, no polling — because that's all this project actually needs. Piper itself only produces raw WAV; `/speak` re-encodes it to MP3 via `ffmpeg` (already in the image) before responding - see "Response size" below.

`05_voice_ask`'s `VOICE_BASE_URL` constant (in `scripts/build_workflows.js`) points at whichever backend is active; swapping is a one-line change since both speak the same contract.

## voicebox build note
Voicebox's own `.dockerignore` excludes `scripts/` entirely, but its `Dockerfile` needs `scripts/rocm-entrypoint.sh` — the stock repo's Docker build fails outright. Patched locally (`scripts/*` + `!scripts/rocm-entrypoint.sh` exception) to unblock it; this is an upstream bug, not a fork.

## Status: `voice/fallback` is built, running, and verified working
After several failed attempts (raw network measured at ~23KB/s at one point; pip hit both read-timeouts and one genuine hash-mismatch/corrupted-download; a real missing `requests` dependency bug; and finally an OS-level DNS outage that blocked further rebuilds), the `voice/fallback` container **built successfully and passed real, live smoke tests**:

- `GET /health` → `{"status":"ok",...}`
- `POST /speak` → a genuine 186KB `RIFF/WAVE` audio file (verified via header bytes, not just HTTP 200)
- `POST /transcribe` on that same generated audio → correctly transcribed it back to matching text
- Full round trip through n8n (`POST /webhook/voice/ask`: audio in → transcribe → orchestrator → synthesize → audio out) → returned valid audio, mechanically working end to end

**Domain-term accuracy, upgraded and re-verified:** the container initially ran Whisper **`tiny`** (smaller download while network was bad), which mistranscribed "How much does Invisalign cost?" as *"how much does invisible are in cost?"* — the orchestrator then correctly (if unhelpfully) fell back, since that text doesn't match any real intent. This was an STT accuracy gap, not a bug in the orchestrator/RAG pipeline (separately verified via 14/14 passing text-based eval cases). Upgraded to Whisper **`base`** (now the Dockerfile default) once network recovered:
- Isolated re-test: transcribed as *"How much does invisaline cost?"* — imperfect (missing the "g") but phonetically much closer.
- **Full round trip re-test: the orchestrator's LLM classifier understood it anyway** and returned the correct, grounded answer: *"The cost of invisalign can vary depending on the severity of your case and the length of treatment needed. For an exact quote, please contact the clinic directly."* No hallucination, correct intent, 8.5s round trip.

`voicebox` (the full/heavy backend) was not completed — its build kept failing on its own multi-GB dependency chain (torch/transformers/Qwen3-TTS/Chatterbox) under the network conditions encountered this session. `voice/fallback` is the actual working backend for this project; voicebox remains a documented upgrade path only.

## Response size fix: WAV -> MP3
Reported: text replies appeared quickly, but audio took noticeably longer to actually start playing on a real (non-localhost) connection - synthesis itself was already sub-second, so it wasn't obvious why. Measured directly: a realistic ~80-word reply produces roughly **1MB of raw WAV** (Piper's native output, uncompressed at ~44KB/sec of audio) - fine to transfer instantly on localhost, but that's real transfer time on any network with actual bandwidth limits, which is what was being felt as "voice is slow" even though the text and the synthesis step were both fast.

Fixed: `/speak` now pipes Piper's WAV output through `ffmpeg` (already in the image) to MP3 at 48kbps before responding - roughly a **10x size reduction** for spoken text with no perceptible quality loss, falling back to the original WAV bytes if the encode ever fails for any reason (never silently drop a reply). No client changes needed - the browser client just plays whatever blob/content-type it receives.

## Verification steps (once a backend is running)
```bash
# health
curl http://localhost:8000/health

# TTS smoke test (now MP3, not WAV)
curl -X POST http://localhost:8000/speak -H "Content-Type: application/json" \
  -d '{"text":"Hello, this is a test."}' --output test.mp3

# STT smoke test (faster-whisper/ffmpeg auto-detect format regardless of extension)
curl -X POST http://localhost:8000/transcribe -F "file=@test.mp3"

# full voice round-trip via n8n (once 05_voice_ask is deployed)
curl -X POST http://localhost:5679/webhook/voice/ask \
  -F "audio=@test.mp3" -F "website_url=https://www.deroodeortho.com/" --output reply.mp3

# domain-term accuracy check (the actual gap found in testing)
curl -X POST http://localhost:8000/speak -H "Content-Type: application/json" \
  -d '{"text":"How much does Invisalign cost?"}' --output question.mp3
curl -X POST http://localhost:8000/transcribe -F "file=@question.mp3"
# should transcribe "Invisalign" correctly (not "invisible are in" - that was the tiny-model failure mode)
```
