# Dental Clinic RAG Voice Assistant — n8n Agent Orchestration

A production-grade, **voice-enabled RAG assistant** for dental/orthodontic clinics, built with an **agent-orchestration** architecture in **n8n**. Give it a single clinic **website URL**; it auto-scrapes the site, extracts structured clinic data, builds a RAG knowledge base, and serves grounded, fact-based answers over voice.

> Reference clinic: [deroodeortho.com](https://www.deroodeortho.com/). The pipeline is **generic** — point it at any clinic URL and it re-ingests end-to-end.

## What it does

- **One input, full automation:** POST a `website_url` → crawl → clean → LLM structured extraction → Postgres facts + Qdrant vectors → ready to answer. No manual data entry.
- **Agent orchestration (not a linear flow):** Intent Classifier → parallel sub-agents (**Booking · Pricing · Services/FAQ · General**) → Fallback → Response Merger → Synthesizer.
- **Fact-grounded, no hallucination:** answers come from scraped facts + retrieved context; low-confidence queries route to a safe fallback.
- **Voice layer:** speech-in / speech-out via [voicebox](https://github.com/jamiepine/voicebox) (local), with a same-contract Whisper+Piper/Kokoro fallback.

## Architecture (3 planes)

```
                 ┌──────────────────────── PLANE A: INGESTION ────────────────────────┐
  website_url ─► │ discover(robots/sitemap/crawl) ─► fetch ─► clean ─► LLM extract ─►  │
                 │ Postgres fact tables ─► chunk ─► embed(Ollama) ─► Qdrant ─► manifest │
                 └────────────────────────────────────────────────────────────────────┘

                 ┌──────────────────── PLANE B: ORCHESTRATION ────────────────────────┐
  user query ─►  │ Intent Classifier ─► ┌─ Booking ─┐                                   │
                 │                      ├─ Pricing ─┤ (parallel) ─► Merger ─► Synthesizer ─► reply
                 │                      ├─ Services ┤                                    │
                 │                      └─ General ─┘   Fallback (low-confidence)        │
                 └────────────────────────────────────────────────────────────────────┘

                 ┌──────────────────────── PLANE C: VOICE ────────────────────────────┐
  mic ─► /transcribe ─► orchestrator webhook ─► reply ─► /speak ─► audio ─► browser client
                 └────────────────────────────────────────────────────────────────────┘
```

## Stack
- **Orchestration:** n8n (modular sub-workflows, version-controlled as JSON in `workflows/`)
- **LLM:** OpenAI `gpt-4o-mini` (classify/route/agents) + `gpt-4o` (extraction/synthesis)
- **Embeddings:** local Ollama `nomic-embed-text`
- **Vectors:** Qdrant · **Facts + memory:** Postgres · **Cache:** Redis
- **Voice:** voicebox (local) → Whisper + Piper/Kokoro fallback
- **Sharing:** cloudflared/ngrok tunnel

## Repo layout
| Path | Purpose |
|---|---|
| `infra/` | `docker-compose.yml`, stack config |
| `workflows/` | exported n8n workflow JSON |
| `db/` | schema, migrations, seeds |
| `scraping/` | crawl/extraction prompts + helpers |
| `rag/` | chunking + embedding config |
| `voice/` | voicebox integration + fallback service |
| `client/` | browser voice UI |
| `scripts/` | setup / export / health scripts |
| `tests/` | eval sets + smoke tests |
| `docs/` | architecture, runbook, ADRs |

## Status
Under active development — see **[PLAN.md](PLAN.md)** for the full 170-step build plan and progress.

## Quickstart
_Coming as the stack lands (Phase 1). See `docs/RUNBOOK.md`._

## License
MIT — see [LICENSE](LICENSE).
