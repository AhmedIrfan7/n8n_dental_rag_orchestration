# Architecture

## Overview
Three decoupled planes. **Ingestion** turns a URL into a knowledge base. **Orchestration** answers questions using that KB via a multi-agent pattern. **Voice** wraps the orchestrator with speech I/O. Planes communicate over HTTP webhooks + shared stores, so each is independently testable and replaceable. All verified live, not just designed — see `tests/eval/results.json` (14/14) and `docs/EVAL_REPORT.md`, `docs/VOICE.md`, `docs/DEMO.md` for the actual test evidence behind every claim below.

## Plane A — Ingestion (`01_ingestion_pipeline` → `02_extract_facts` → `03_build_index`)
Trigger: `POST /webhook/ingest {website_url}` — this single call runs the entire chain.
1. **Discover** (`01`) — robots.txt + sitemap.xml; fallback depth-limited same-domain crawl (`max_pages` param, default 80).
2. **Fetch + clean** (`01`) — concurrent HTTP fetch (bounded concurrency, per-request timeout — tolerant of a slow/flaky origin site), HTML → main-content text, page-type classification.
3. **Store pages** (`01`) → `pages_raw`, then triggers `02_extract_facts`.
4. **Extract** (`02`) — `gpt-4o-mini` structured extraction into JSON per page type → Postgres fact tables (`services`, `doctors`, `pricing`, `hours`, `faqs`, `policies`, `clinic`), then triggers `03_build_index`.
5. **Index** (`03`) — heading-aware chunking of pages + facts → embed with local Ollama `nomic-embed-text` → upsert to Qdrant `clinic_kb` (idempotent per clinic — re-ingesting a URL clears and rebuilds its own vectors, not anyone else's).

**Why facts + vectors both?** Exact facts (prices, hours, doctor names) live in Postgres so they can be quoted verbatim; open-ended questions use Qdrant retrieval. Verified in practice: even when a fact isn't captured structurally (the `clinic` table's phone/address stayed empty because that content is JS-rendered on the source site), the RAG layer still surfaced the real number/address correctly from raw page text — a structural gap degraded gracefully instead of causing a hallucination.

**Known gap:** `ingestion_runs`/`page_coverage` audit tables exist in the schema (`db/migrations/0001_init.sql`) but nothing currently writes to them — ingestion works and is idempotent, but there's no per-run audit trail yet.

## Plane B — Orchestration (`10_orchestrator` + sub-workflows)
Trigger: `POST /webhook/ask {query, session_id?, website_url}`.
1. **Session** — `PrepSession` (validates a client-supplied `session_id`) → `GetOrCreateSession` (reuses or creates a row, always exactly one) → `LoadHistory` (last 8 turns, aggregated into one row via `jsonb_agg`).
2. **Classify** — `gpt-4o-mini`, sees the recent conversation, returns `intents: [{name, confidence}]` (pricing/services/general/booking) — empty array for anything unrelated to the clinic.
3. **Route + parallel execute** (`RouteAndCall`) — fans out to every intent above the confidence threshold **concurrently** via `Promise.all` inside one Code node (not sequential HTTP nodes) — verified with a real multi-intent query firing two sub-agents simultaneously and merging into one coherent reply. Tolerant of a single sub-agent failing.
4. **Sub-agents:**
   - `12_pricing_agent`, `13_services_faq_agent`, `14_general_knowledge_agent` — share one factory (retrieve type-filtered Qdrant context → grounding check → LLM answer strictly from that context, or a safe fallback if nothing relevant was found).
   - `11_booking_agent` — its own flow: looks up any already-open booking for the session, extracts new slots via LLM, **merges** them with whatever was already collected (so a later turn doesn't need to repeat the service/name), and writes `booking_requests` with a real `collecting → confirming` state transition (not a fresh row per message).
5. **Merge + synthesize** — `MergeResults` dedupes sub-agent answers; `gpt-4o` combines them into one natural reply (skipped entirely — no LLM call — when nothing was grounded, so an off-topic query gets the safe deflection verbatim rather than an LLM "polishing" a refusal).
6. **Persist** — both turns (user + assistant) saved to `messages` before responding.

## Plane C — Voice
```
mic (client/) → POST /transcribe (voice/fallback) → text
             → POST /webhook/ask (10_orchestrator, unchanged) → grounded reply
             → POST /speak (voice/fallback) → audio → played back
```
- **`voice/fallback`** (this repo) is the actual, verified-working backend: `faster-whisper` (CPU, `base` model) for STT, `Piper` (ONNX, CPU-only) for TTS, synchronous (`/speak` returns audio directly — no job polling, no voice-profile setup).
- **`voicebox`** (cloned separately, not vendored here) was attempted as a richer alternative (multiple TTS engines, real voice cloning) but never completed building in this environment (multi-GB dependency chain under a degraded network) — it remains a documented upgrade path in `docs/VOICE.md`, not something the working system depends on.
- The browser client (`client/`) calls `voice/fallback` and `10_orchestrator` **directly** (not through an n8n binary-response workflow) — lower-risk integration, and it gives the client the transcript/reply text directly for the conversation UI. An n8n-mediated single-endpoint path (`05_voice_ask`) also exists and works, for callers that want one webhook instead of three calls.
- Verified with a real spoken domain-specific question, locally and through public tunnels simulating a remote user — see `docs/VOICE.md` and `docs/DEMO.md`.

## Anti-hallucination strategy
1. Fact tables serve exact answers (prices/hours/names) verbatim where they were captured.
2. Retrieval carries a similarity-score grounding guard (`min_score`, default 0.55) — an off-topic or fabricated-premise question scores below it and the caller knows to fall back rather than invent.
3. Every sub-agent's system prompt is constrained to answer only from the provided context.
4. The synthesizer is skipped (not just told to be careful) when nothing was grounded, so an off-topic reply never passes through an LLM "smoothing" pass.
5. **Eval suite proves this, not just claims it:** `tests/eval/qa.jsonl` includes 5 hallucination probes (off-topic trivia, a question about a fact known to be missing from the KB, a fabricated doctor name, an unstated payment method, a leading fabricated price) — all 5 pass. Full results in `docs/EVAL_REPORT.md`.

## Isolation & ops
Dedicated `infra/docker-compose.yml` — own network `dental_net`, distinct container names/ports — coexists with other local stacks without conflict. Secrets in `.env` (gitignored, never committed — verified via `git log --all -- .env`). Workflows exported as JSON (`workflows/*.json`) and assembled from readable `.js`/`.sql` source via `scripts/build_workflows.js`, so node logic is reviewable in a normal diff rather than buried in exported JSON blobs.
