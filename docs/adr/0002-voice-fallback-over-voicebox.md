# ADR-0002: `voice/fallback` is the real backend; voicebox is an upgrade path, not a dependency

## Context
The brief named [voicebox](https://github.com/jamiepine/voicebox) specifically. On inspection, its `/speak` endpoint is an **async job** requiring a pre-cloned voice **profile** (`POST /profiles` + sample uploads first) — designed for personal voice cloning, not a stateless clinic receptionist bot. Its Docker build also pulls a multi-GB dependency chain (torch, transformers, Chatterbox, Qwen3-TTS via git) and, in this environment, never completed across many attempts under degraded network conditions. Its own `.dockerignore` also excludes a file its `Dockerfile` needs (`scripts/rocm-entrypoint.sh`) — a real upstream bug, patched locally in the separately-cloned `voicebox/` directory (not part of this repo).

## Decision
Build `voice/fallback` — a small FastAPI service (`faster-whisper` for STT, Piper for TTS) exposing the same two endpoints voicebox has (`/transcribe`, `/speak`) but **synchronous**: text in, audio out, no profile setup, no job polling. This is the actual, verified-working backend the rest of the system (n8n voice glue, browser client) is built against. `VOICE_BASE_URL` is one constant/query-param, so pointing at voicebox instead — if it's ever built and its `/speak` contract is adapted to be synchronous, or the client is updated to handle its async job pattern — is a small, contained change.

## Consequences
- The working voice layer is lighter and faster to iterate on, at the cost of voicebox's richer feature set (multiple TTS engines, real voice cloning).
- STT accuracy depends on the Whisper model size chosen (`base` by default) — verified acceptable for this use case (the orchestrator's classifier compensates for minor transcription noise) but not perfect on every brand-specific term.
- If the project ever needs true voice cloning (a specific person's voice), voicebox (or a similar profile-based engine) would need to be revisited.
