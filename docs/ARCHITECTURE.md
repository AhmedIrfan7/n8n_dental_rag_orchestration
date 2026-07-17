# Architecture

## Overview
Three decoupled planes. **Ingestion** turns a URL into a knowledge base. **Orchestration** answers questions using that KB via a multi-agent pattern. **Voice** wraps the orchestrator with speech I/O. Planes communicate over HTTP webhooks + shared stores, so each is independently testable and replaceable.

## Plane A — Ingestion (`01_ingestion_pipeline` → `02_index_builder`)
Trigger: `Webhook { website_url }`.
1. **Discover** — robots.txt + sitemap.xml; fallback depth-limited same-domain BFS crawl (caps: `CRAWL_MAX_PAGES`, `CRAWL_MAX_DEPTH`).
2. **Fetch** — polite HTTP (rate-limit, retry/backoff, custom UA).
3. **Clean** — HTML → main-content text (strip nav/footer/scripts).
4. **Extract** — `gpt-4o` structured extraction into JSON per page type → rows in Postgres fact tables (`services`, `doctors`, `pricing`, `hours`, `faqs`, `policies`, `clinic`).
5. **Index** — heading-aware chunking → embed with Ollama `nomic-embed-text` → upsert to Qdrant `clinic_kb` (payload: url, section, type, entity refs). Structured facts also indexed as synthetic Q/A chunks.
6. **Manifest** — `ingestion_runs` + `page_coverage` for auditability.

**Why facts + vectors both?** Exact facts (prices, hours) are served from Postgres to eliminate hallucination; open-ended questions use vector retrieval. Hybrid = accurate + flexible.

## Plane B — Orchestration (`10_orchestrator` + sub-workflows)
Trigger: `Webhook { query, session_id }`.
- **Intent Classifier** (`gpt-4o-mini`) → `intents[]` + confidence (multi-intent capable).
- **Router / Parallel Executor** → fans out to relevant sub-workflows concurrently:
  - `11_booking_agent` — slot-filling, hours validation, confirmation → `booking_requests`.
  - `12_pricing_agent` — DB-first pricing, RAG-second; quotes only real rows.
  - `13_services_faq_agent` — RAG over services + FAQs (type-filtered).
  - `14_general_knowledge_agent` — clinic info (address/hours/contact) DB-first.
- **Fallback agent** — unknown/low-confidence → safe clarify, never invents.
- **Response Merger** — collects sub-agent JSON `{answer, sources, confidence, intent, needs}`; dedupes; prefers DB facts on conflict.
- **Synthesizer** (`gpt-4o`) — one professional grounded reply, strictly from provided context.
- **Memory** — `sessions`/`messages` (Postgres) for multi-turn (esp. booking).

Shared retrieval is factored into `03_retriever` (embed query → Qdrant top-k + score threshold + Postgres fact lookup + grounding guard).

## Plane C — Voice
`mic → /transcribe (Whisper) → orchestrator webhook → reply → /speak (Kokoro/Piper) → audio`.
- Primary: voicebox backend (Docker, REST). Fallback: FastAPI `faster-whisper` + Piper/Kokoro exposing the **same** `/transcribe` + `/speak` contract, so swapping doesn't touch the rest of the system.
- Browser `client/` captures mic (VAD), plays audio, shows transcript. Exposed to the team via cloudflared/ngrok tunnel.

## Anti-hallucination strategy
1. Fact tables serve exact answers (prices/hours) verbatim.
2. Retrieval carries source citations; synthesizer is instructed to answer only from context.
3. Score threshold + confidence gating → fallback when context is insufficient.
4. Eval suite includes hallucination probes (facts not on the site must be refused).

## Isolation & ops
Dedicated `infra/docker-compose.yml` — own network `dental_net`, distinct container names/ports (`n8n:5679`, `qdrant:6343`, `postgres:5433`, `redis:6380`) — coexists with the fahrschule stack without conflict. Secrets in `.env` (gitignored). Workflows exported as JSON and version-controlled.
