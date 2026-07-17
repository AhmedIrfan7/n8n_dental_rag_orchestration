# Project Plan — Dental Clinic RAG Voice Assistant (n8n Agent Orchestration)

**Repo:** `AhmedIrfan7/n8n_dental_rag_orchestration`
**Author (sole contributor):** AhmedIrfan7 `<ahmedirfan4560@gmail.com>` — no other contributors, no Co-Authored-By trailers.
**Target clinic:** https://www.deroodeortho.com/ (generic — any clinic URL re-ingests end-to-end).

## Locked decisions
- **Brain:** Hybrid. OpenAI (`gpt-4o-mini` for classify/route/agents, `gpt-4o` for extraction/synthesis). Local Ollama `nomic-embed-text` for embeddings. Local voice.
- **Voice:** voicebox backend (Docker) first; drop-in Whisper + Piper/Kokoro fallback exposing the same REST contract if the Windows build fails.
- **Vectors:** Qdrant. **Facts + memory:** Postgres. **Cache/queue:** Redis.
- **Sharing:** cloudflared/ngrok tunnel for live team demo.
- **Isolation:** dedicated `docker-compose.yml` (own network, container names, ports) — does not touch the fahrschule stack.

## Execution rule
Do one step → verify it → commit → **push to GitHub** → next step. Never advance before pushing. Workflows are version-controlled as exported JSON under `workflows/`.

## Architecture (3 planes)
- **A — Ingestion:** `Webhook{url}` → discover (robots/sitemap/crawl) → fetch → clean → **LLM structured extraction** → Postgres fact tables → chunk → embed → Qdrant → coverage manifest.
- **B — Orchestration:** Intent Classifier → parallel sub-workflows (Booking / Pricing / Services-FAQ / General) → Fallback → Response Merger → Synthesizer. Session memory for multi-turn booking.
- **C — Voice:** mic → `/transcribe` → orchestrator webhook → reply → `/speak` → audio. Browser voice client + tunnel.

---

## Phase 0 — Foundations & Repo (steps 1–12)
1. Verify `gh` auth = AhmedIrfan7; confirm empty public repo exists.
2. Create project folder `n8n_dental_rag_orchestration` + directory skeleton.
3. `git init`; set local `user.name=AhmedIrfan7`, `user.email=ahmedirfan4560@gmail.com`.
4. Add `.gitignore` (node, python, `.env`, secrets, data dumps, model weights, qdrant/pg volumes).
5. Write `README.md` (overview, architecture, quickstart placeholders).
6. Write this `PLAN.md`.
7. Write `docs/ARCHITECTURE.md` (planes, data flow, diagrams).
8. Add `LICENSE` (MIT).
9. Add `.env.example` (all keys, no secrets).
10. Add `git remote add origin` → the GitHub repo; set default branch `main`.
11. First commit → push `main`; verify on GitHub.
12. Confirm single contributor (author + committer = AhmedIrfan7); add branch protection note.

## Phase 1 — Infra / Docker stack (steps 13–30)
13. Design `infra/docker-compose.yml` service list + isolated network `dental_net`.
14. Add **n8n** service (unique name `dental-n8n`, port `5679:5678`, persistent volume, env for webhooks/timezone).
15. Add **Qdrant** service (`dental-qdrant`, `6343:6333`, volume).
16. Add **Postgres** service (`dental-postgres`, `5433:5432`, volume, init mount).
17. Add **Redis** service (`dental-redis`, `6380:6379`).
18. Reuse host **Ollama** (already installed) or add `dental-ollama` service — decide by RAM; wire n8n → Ollama.
19. Write `.env` (real, gitignored) from `.env.example`.
20. `docker compose up -d`; verify all containers healthy.
21. Healthcheck: curl n8n `/healthz`, Qdrant `/readyz`, Postgres `pg_isready`, Redis `PING`.
22. Pull Ollama embedding model `nomic-embed-text`; verify `/api/embeddings`.
23. `scripts/healthcheck.ps1` + `scripts/healthcheck.sh` (verify whole stack).
24. `scripts/up.ps1` / `scripts/down.ps1` (start/stop stack).
25. n8n first-run: create owner account, capture instance URL.
26. Configure n8n env: `N8N_HOST`, `WEBHOOK_URL`, execution timeout, save-on-error.
27. Add OpenAI + n8n credentials placeholders (document, don't commit secrets).
28. Verify n8n can reach Qdrant/Postgres/Ollama over `dental_net` (internal DNS).
29. `scripts/export_workflows.ps1` (pull workflow JSON out of n8n → `workflows/`) + `import_workflows.ps1`.
30. Commit infra; push. Document stack in `docs/INFRA.md`.

## Phase 2 — Data model & stores (steps 31–40)
31. Design `db/schema.sql`: `clinic`, `services`, `doctors`, `pricing`, `hours`, `faqs`, `policies`, `pages_raw`.
32. Add `ingestion_runs` + `page_coverage` tables (auditability).
33. Add `sessions` + `messages` tables (conversation memory).
34. Add `booking_requests` table (slot, patient, status).
35. Add indexes + constraints (uniqueness on url, service name).
36. `db/migrations/0001_init.sql`; apply to Postgres; verify tables.
37. Define Qdrant collection `clinic_kb` (vector size = embed dim, cosine); payload schema (url, section, type, doctor, service).
38. `scripts/init_qdrant.ps1` creates collection; verify via REST.
39. `db/seed_min.sql` (tiny fixture for pipeline testing before real scrape).
40. Commit data model; push. `docs/DATA_MODEL.md`.

## Phase 3 — Scraping / Ingestion pipeline (steps 41–66)
41. Build n8n workflow `01_ingestion_pipeline` — `Webhook {website_url}` trigger.
42. Node: fetch `robots.txt`; parse allow/deny + sitemap refs.
43. Node: fetch `sitemap.xml` (+ nested); collect candidate URLs.
44. Fallback: depth-limited internal-link crawler (BFS, cap N pages, same-domain, dedupe).
45. Politeness: rate-limit + user-agent + concurrency cap (respect robots).
46. Node: HTTP fetch each page (retry/backoff, handle non-200).
47. Node: HTML → clean text (strip nav/footer/script; readability-style main content).
48. Store raw+clean per page → `pages_raw` (idempotent upsert by URL hash).
49. Classify page type (home/services/pricing/team/contact/faq/blog) via lightweight LLM/heuristics.
50. **[NEEDS OPENAI KEY]** LLM structured extraction prompt → JSON schema per page type.
51. Extract **services** (name, description, category) → `services`.
52. Extract **doctors/team** (name, title, bio, specialties) → `doctors`.
53. Extract **pricing** (service, price/range, currency, notes) → `pricing`.
54. Extract **hours/timings** (day → open/close, exceptions) → `hours`.
55. Extract **contact/address/phone/booking links** → `clinic`.
56. Extract **policies** (insurance, cancellation, new-patient) → `policies`.
57. Extract **FAQs** (question/answer) → `faqs`.
58. Normalize + dedupe entities (merge across pages, canonical names).
59. Confidence/coverage scoring per field; flag gaps.
60. Write `ingestion_runs` + `page_coverage` (counts, coverage %, timestamp).
61. JSON-schema validation of extracted output (reject malformed).
62. Idempotency: re-running same URL updates, not duplicates.
63. Error handling branch: partial failure → log + continue, never crash pipeline.
64. Test ingestion on deroodeortho.com; inspect extracted rows.
65. Tune prompts/selectors until coverage acceptable; snapshot sample output to `tests/eval/ingestion_sample.json`.
66. Export `01_ingestion_pipeline.json` → commit → push. `docs/INGESTION.md`.

## Phase 4 — RAG build: chunk / embed / index (steps 67–78)
67. Design chunking strategy (heading-aware, ~500–800 tokens, overlap) in `rag/chunking.md`.
68. n8n sub-flow `02_index_builder`: pull clean text + structured facts.
69. Build chunks with metadata (url, section, type, entity refs).
70. Also index structured facts as synthetic Q/A chunks (pricing rows, hours) for retrieval.
71. Embed chunks via Ollama `nomic-embed-text` (batch).
72. Upsert vectors + payload → Qdrant `clinic_kb`.
73. Store chunk↔source mapping for citations.
74. Verify vector count matches chunk count; spot-check a query.
75. Add re-index trigger (called at end of ingestion → one URL = full RAG rebuild).
76. Wire `01_ingestion_pipeline` → `02_index_builder` (Execute Workflow) = full automation from one URL.
77. End-to-end test: POST `{website_url}` → DB filled + Qdrant filled + manifest written.
78. Export `02_index_builder.json` → commit → push. `docs/RAG_BUILD.md`.

## Phase 5 — Retrieval + grounding layer (steps 79–86)
79. Sub-flow `03_retriever`: input `{query, filters}` → embed query → Qdrant search (top-k + score threshold).
80. Hybrid retrieval: vector + structured DB lookup (pricing/hours from Postgres for exact facts).
81. Metadata filtering (by type: pricing/faq/service) for targeted sub-agents.
82. Re-rank / dedupe retrieved context; assemble grounded context bundle with sources.
83. Grounding guard: if top score < threshold → signal "insufficient context".
84. Return structured context (chunks + citations + confidence) to callers.
85. Unit-test retriever on known questions; verify correct chunks return.
86. Export `03_retriever.json` → commit → push. `docs/RETRIEVAL.md`.

## Phase 6 — Sub-agents (steps 87–108)
87. `12_pricing_agent`: retrieve pricing (DB-first, RAG-second) → grounded price answer; "contact for exact quote" when unknown.
88. Pricing: currency/format handling; ranges; per-service.
89. Pricing: anti-hallucination guard (only quote existing rows).
90. Test + export `12_pricing_agent.json` → push.
91. `13_services_faq_agent`: RAG over services + FAQs (type-filtered retrieval).
92. Services: map user phrasing → service entities (synonyms).
93. Services: cite source; fallback if not covered.
94. Test + export `13_services_faq_agent.json` → push.
95. `14_general_knowledge_agent`: clinic info (address, hours, contact, about) — DB-first.
96. General: handle "where/when/how to reach" precisely from `clinic`/`hours`.
97. Test + export `14_general_knowledge_agent.json` → push.
98. `11_booking_agent`: detect booking intent; collect slots (service, preferred date/time, name, contact).
99. Booking: check `hours` for validity; propose available windows.
100. Booking: multi-turn slot-filling via session memory.
101. Booking: confirmation step ("shall I book X on Y?") → write `booking_requests`.
102. Booking: produce booking link / next-step when no live calendar.
103. Booking: guardrails (never confirm outside hours; require confirmation).
104. Test booking happy-path + edge cases; export `11_booking_agent.json` → push.
105. Standardize sub-agent I/O contract (JSON: {answer, sources, confidence, intent, needs}).
106. Add per-agent unit tests in `tests/eval/`.
107. `docs/AGENTS.md` documents each sub-agent contract.
108. Commit agent docs + tests; push.

## Phase 7 — Orchestrator: classify / route / parallel / merge / synthesize (steps 109–126)
109. `10_orchestrator`: `Webhook {query, session_id}` trigger.
110. Load session memory (last N turns) from Postgres.
111. **Intent Classifier agent**: → intents[] + confidence (multi-intent capable).
112. Classifier prompt + few-shots; JSON output validation.
113. Router: map intents → sub-workflow set to invoke.
114. **Parallel execution**: fan-out to relevant sub-agents concurrently (Execute Workflow / Split-in-Batches / parallel branches).
115. Timeout + partial-result handling per sub-agent.
116. **Fallback agent**: triggered on unknown intent OR all-low-confidence → safe clarify, no invention.
117. **Response Merger**: collect sub-agent JSON outputs into one context object.
118. Conflict handling (dedupe overlapping facts; prefer DB facts).
119. **Synthesizer agent** (`gpt-4o`): merge → single professional grounded reply; only from provided context; include no hallucinations.
120. Synthesizer tone/format (concise, friendly, clinic receptionist persona).
121. Append reply + turn to session memory.
122. Return `{reply, sources, intents, session_id}`.
123. End-to-end test: pricing, services, hours, booking, unknown queries.
124. Latency check; optimize parallelism.
125. Anti-hallucination eval pass (see Phase 11) against orchestrator.
126. Export `10_orchestrator.json` + all sub-flows → commit → push. `docs/ORCHESTRATION.md`.

## Phase 8 — Session memory & booking confirmation (steps 127–132)
127. Finalize `sessions`/`messages` read/write helpers.
128. Multi-turn context window management (trim/summarize old turns).
129. Booking confirmation state machine (collecting → confirming → booked).
130. Idempotent booking writes; status transitions.
131. Test full multi-turn booking conversation.
132. Commit memory layer; push.

## Phase 9 — Voice layer (voicebox + fallback) (steps 133–144)
133. Inspect cloned `voicebox`; read setup + Docker path; check Windows/CUDA support + Python 3.11 needs.
134. Attempt voicebox **backend-only** via `docker compose up` (skip Tauri desktop).
135. Verify REST: `/transcribe`, `/generate|/speak`, `/profiles` reachable.
136. Pick light models (Whisper small/base STT; Kokoro TTS) suited to 6 GB VRAM.
137. Smoke-test STT (sample wav → text) and TTS (text → audio).
138. **If voicebox fails on Windows/GPU:** build `voice/fallback` service — FastAPI wrapping `faster-whisper` (STT) + Piper/Kokoro (TTS), **same REST contract**.
139. Containerize the voice service (`infra/docker-compose.yml` add `dental-voice`).
140. n8n voice glue: HTTP nodes → `/transcribe` → orchestrator → `/speak`.
141. Handle audio formats, streaming/latency, barge-in basics.
142. Test spoken query end-to-end (audio in → grounded spoken answer out).
143. Test spoken booking confirmation flow.
144. Commit voice layer; push. `docs/VOICE.md`.

## Phase 10 — Voice client & sharing (steps 145–152)
145. `client/` minimal web voice UI (mic capture, VAD, playback, transcript view).
146. Wire client → voice/orchestrator endpoints.
147. Conversation UI (turns, "listening/thinking/speaking" states).
148. Booking confirmation UI affordance.
149. Serve client (static host / n8n / small server).
150. Set up **cloudflared/ngrok** tunnel → shareable URL for team.
151. Test live from another device via tunnel URL.
152. Commit client + tunnel scripts; push. `docs/DEMO.md`.

## Phase 11 — Testing / eval / anti-hallucination (steps 153–162)
153. Build eval set `tests/eval/qa.jsonl` (Q → expected/grounded answer, per category).
154. Automated eval runner (POST orchestrator, score grounding/accuracy).
155. Hallucination probes (ask for facts not on site → must refuse/deflect).
156. Booking flow tests (valid/invalid times, missing info).
157. Ingestion regression test (re-point to a 2nd clinic URL → verify generic).
158. Latency + parallelism benchmark.
159. Load/error resilience (bad URL, empty site, network fail).
160. Fix issues surfaced; re-run until green.
161. Capture eval report → `docs/EVAL_REPORT.md`.
162. Commit tests + report; push.

## Phase 12 — Docs, demo, polish (steps 163–150→ final)
163. Finalize `README.md` (architecture diagram, full setup, run, demo instructions).
164. `docs/RUNBOOK.md` (start stack, ingest a site, run assistant, troubleshoot).
165. Architecture diagram (mermaid) in docs.
166. ADRs for key decisions (`docs/adr/`).
167. One-command bootstrap script (`scripts/bootstrap.ps1`): up stack → ingest URL → ready.
168. Record demo script + walkthrough; capture tunnel demo.
169. Final cleanup: remove secrets, verify `.gitignore`, single-contributor audit.
170. Tag `v1.0`; final push; write project summary.

---
_Total: 170 granular steps across 13 phases. Each step is committed + pushed before the next._
