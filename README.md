# Dental Clinic RAG Voice Assistant — n8n Agent Orchestration

A voice-enabled, fact-grounded AI receptionist for dental/orthodontic clinics, built as a multi-agent system in **n8n**. Give it one clinic **website URL**; it scrapes the site, extracts structured clinic data, builds a knowledge base, and answers patient questions — by text or by voice — using only what it actually found on that site.

> Built against [deroodeortho.com](https://www.deroodeortho.com/) as the reference clinic. The pipeline is **generic**: nothing in the code is specific to that clinic — point `/webhook/ingest` at any clinic's URL and it re-ingests end to end.

## What it actually does (verified, not aspirational)

- **One input, full automation:** `POST /webhook/ingest {website_url}` → crawl → clean → LLM extraction → Postgres facts + Qdrant vectors, ready to answer. No manual data entry, no per-clinic code.
- **Agent orchestration, not a linear chatbot:** an intent classifier fans a query out to the relevant sub-agents **in parallel** (verified: a two-intent question fires both agents simultaneously and merges them into one reply), with a real `collecting → confirming` booking state machine that carries slot info across turns instead of re-asking.
- **Fact-grounded — proven with an eval suite, not just claimed:** `tests/eval/qa.jsonl` runs 14 cases including 5 hallucination probes (off-topic trivia, a fact known to be missing from the KB, a fabricated doctor name, an unstated payment method, a leading fabricated price). **14/14 pass.** See `docs/EVAL_REPORT.md`.
- **Real multi-turn memory:** conversations persist in Postgres; a follow-up like "and who is the doctor that does it" correctly resolves against the prior turn.
- **Voice, tested with an actual spoken question, not a synthetic smoke test:** speech in → the same grounded text pipeline → speech out, verified locally and through public tunnels simulating a remote user. See `docs/VOICE.md`.

## Architecture

```mermaid
flowchart TB
    subgraph ingest["Plane A — Ingestion (one URL in)"]
        direction LR
        I1["01 Discover + fetch + clean"] --> I2["02 Extract facts (gpt-4o-mini)"]
        I2 --> I3["03 Chunk + embed + index"]
    end

    subgraph ask["Plane B — Orchestration (one query in)"]
        direction TB
        B1["Classify intent"] --> B2{Route}
        B2 -->|parallel| B3["Pricing agent"]
        B2 -->|parallel| B4["Services/FAQ agent"]
        B2 -->|parallel| B5["General agent"]
        B2 -->|parallel| B6["Booking agent"]
        B3 & B4 & B5 & B6 --> B7["Merge"]
        B7 --> B8["Synthesize (gpt-4o)"]
    end

    subgraph voice["Plane C — Voice"]
        direction LR
        V1["Mic (client/)"] --> V2["Transcribe"]
        V2 --> ask
        ask --> V3["Speak"]
        V3 --> V1
    end

    website(["clinic website_url"]) --> ingest
    ingest -->|Postgres facts + Qdrant vectors| ask
    text(["text query"]) --> ask
```

## Stack
- **Orchestration:** n8n — 10 workflows, version-controlled as JSON in `workflows/`, assembled from readable `.js`/`.sql` in `scraping/`, `orchestrator/`, `booking/`, `rag/`, `db/queries/` via `scripts/build_workflows.js`
- **LLM:** OpenAI `gpt-4o-mini` (classify/route/agents) + `gpt-4o` (extraction/synthesis)
- **Embeddings:** local Ollama `nomic-embed-text`
- **Vectors:** Qdrant · **Facts + memory:** Postgres · **Cache:** Redis
- **Voice:** `voice/fallback` — local `faster-whisper` (STT) + Piper (TTS), synchronous, no cloud dependency
- **Client:** `client/` — a single-screen browser voice UI
- **Sharing:** `cloudflared` quick tunnels (`scripts/start_demo.ps1`)

## Repo layout
| Path | Purpose |
|---|---|
| `infra/` | `docker-compose.yml` — n8n, Postgres, Qdrant, Redis, Ollama, voice-fallback |
| `workflows/` | Deployable n8n workflow JSON (generated — see `scripts/build_workflows.js`) |
| `scraping/`, `orchestrator/`, `booking/`, `rag/` | Node source for each workflow's Code nodes |
| `db/` | Schema (`migrations/0001_init.sql`) + parameterized queries (`queries/`) |
| `voice/` | `voice/fallback` (the real, working STT/TTS backend) + n8n voice glue |
| `client/` | Browser voice UI |
| `scripts/` | Deploy, bootstrap, health-check, eval, demo-tunnel tooling |
| `tests/eval/` | The eval suite (`qa.jsonl`) and its last run (`results.json`) |
| `docs/` | Architecture, runbook, data model, voice, demo, eval report, ADRs |

## Quickstart
```powershell
cp .env.example .env   # then set OPENAI_API_KEY at minimum
./scripts/bootstrap.ps1
curl -X POST http://localhost:5679/webhook/ingest -H "Content-Type: application/json" `
  -d '{"website_url":"https://www.deroodeortho.com/"}'
curl -X POST http://localhost:5679/webhook/ask -H "Content-Type: application/json" `
  -d '{"query":"how much does invisalign cost","website_url":"https://www.deroodeortho.com/"}'
```
Full step-by-step, troubleshooting, and one-time n8n credential setup: **[docs/RUNBOOK.md](docs/RUNBOOK.md)**.

## Try it by voice
```powershell
python -m http.server 8080 --directory client
# open http://localhost:8080, allow microphone access
```
To share a live link with a team: **[docs/DEMO.md](docs/DEMO.md)**.

## Documentation
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — how each plane works, why facts+vectors, what's verified
- **[docs/RUNBOOK.md](docs/RUNBOOK.md)** — setup, common operations, troubleshooting table
- **[docs/DATA_MODEL.md](docs/DATA_MODEL.md)** — Postgres schema + Qdrant collection
- **[docs/N8N_CONTROL.md](docs/N8N_CONTROL.md)** — headless n8n deployment + hard-won gotchas
- **[docs/VOICE.md](docs/VOICE.md)** — voice backend details and what was actually tested
- **[docs/DEMO.md](docs/DEMO.md)** — the voice client and live tunnel sharing
- **[docs/EVAL_REPORT.md](docs/EVAL_REPORT.md)** — the 14/14 eval run in detail
- **[docs/adr/](docs/adr/)** — why the key decisions were made this way
- **[PLAN.md](PLAN.md)** — the original 170-step build plan this project was built from

## Known limitations (stated plainly, not hidden)
- `ingestion_runs`/`page_coverage` audit tables exist in the schema but nothing writes to them yet — ingestion itself works and is idempotent, there's just no per-run audit trail.
- STT on domain-specific brand names ("Invisalign") isn't perfect with the current Whisper model — verified acceptable in practice (the orchestrator's classifier tends to understand it anyway) but not guaranteed for every phrasing.
- `voicebox` (the richer voice backend originally named in the brief) never completed building in this environment; `voice/fallback` is the real, working backend. See `docs/adr/0002-voice-fallback-over-voicebox.md`.
- The demo tunnel setup (`cloudflared` quick tunnels) has no authentication — fine for a short team demo, not for a long-lived deployment.
- ~~Genericity not re-verified against a second clinic~~ **Verified**: ingested a second, unrelated real clinic (ortegaortho.com) with zero code changes — 23 services/4 doctors/19 FAQs/7 hours rows extracted, both clinics' data confirmed isolated (asking each clinic "who is the orthodontist" correctly returns its own doctor, never the other's). Found and fixed a real gap in the process: `hours` facts were extracted into Postgres but never indexed for retrieval — see `docs/EVAL_REPORT.md`.

## License
MIT — see [LICENSE](LICENSE).
