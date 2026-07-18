# Runbook

Practical, copy-pasteable steps for running this system. For *what* the system does and *why* it's built this way, see `docs/ARCHITECTURE.md`. For voice specifics, `docs/VOICE.md`. For the demo client, `docs/DEMO.md`.

## 1. First-time setup
```powershell
cp .env.example .env
# edit .env: set OPENAI_API_KEY at minimum. N8N_OWNER_EMAIL/PASSWORD, N8N_ENCRYPTION_KEY,
# POSTGRES_PASSWORD can be anything for local dev.
./scripts/up.ps1                        # start the Docker stack
./scripts/healthcheck.ps1                # confirm n8n/Postgres/Qdrant/Redis/Ollama are all up
# One-time: create the n8n owner account, a Postgres credential, an
# OpenAI credential, and an httpHeaderAuth credential (name: X-Webhook-Key,
# value: a random secret you generate) inside n8n, then put their ids/
# values into .env as N8N_PG_CRED_ID / N8N_OPENAI_CRED_ID / N8N_API_KEY /
# N8N_WEBHOOK_AUTH_CRED_ID / N8N_WEBHOOK_API_KEY (see docs/N8N_CONTROL.md
# for the exact /rest calls - this only needs doing once per n8n volume).
# Every webhook below requires that key as an X-Webhook-Key header - the
# curl examples in this file include it via $env:N8N_WEBHOOK_API_KEY.
docker compose -f infra/docker-compose.yml build voice-fallback
docker compose -f infra/docker-compose.yml up -d voice-fallback
node scripts/build_workflows.js          # assemble workflow JSON from source
./scripts/n8n_deploy.ps1 -File workflows\01_ingestion_pipeline.json -Activate
./scripts/n8n_deploy.ps1 -File workflows\02_extract_facts.json -Activate
./scripts/n8n_deploy.ps1 -File workflows\03_build_index.json -Activate
./scripts/n8n_deploy.ps1 -File workflows\04_retriever.json -Activate
./scripts/n8n_deploy.ps1 -File workflows\11_booking_agent.json -Activate
./scripts/n8n_deploy.ps1 -File workflows\12_pricing_agent.json -Activate
./scripts/n8n_deploy.ps1 -File workflows\13_services_faq_agent.json -Activate
./scripts/n8n_deploy.ps1 -File workflows\14_general_knowledge_agent.json -Activate
./scripts/n8n_deploy.ps1 -File workflows\10_orchestrator.json -Activate
./scripts/n8n_deploy.ps1 -File workflows\05_voice_ask.json -Activate
```
Or just run `./scripts/bootstrap.ps1` to do the build+deploy steps in one go once the one-time credential setup above is done.

## 2. Ingest a clinic
```powershell
curl -X POST http://localhost:5679/webhook/ingest `
  -H "Content-Type: application/json" -H "X-Webhook-Key: $env:N8N_WEBHOOK_API_KEY" `
  -d '{"website_url":"https://www.deroodeortho.com/"}'
```
One call does everything: crawl → extract → index. Takes roughly 1-3 minutes depending on site size and how many pages successfully fetch (the crawler tolerates a slow/partial-failing origin site — it extracts from whatever it got rather than failing the whole run). Point it at a *different* clinic's URL to prove genericity; nothing in the code is specific to deroodeortho.com.

## 3. Ask it something (text)
```powershell
curl -X POST http://localhost:5679/webhook/ask `
  -H "Content-Type: application/json" -H "X-Webhook-Key: $env:N8N_WEBHOOK_API_KEY" `
  -d '{"query":"how much does invisalign cost","website_url":"https://www.deroodeortho.com/"}'
```
Pass the `session_id` returned back in the next call to continue the same conversation (needed for multi-turn booking).

## 4. Run the eval suite
```powershell
node scripts/run_eval.js
```
Should show 14/14 passing (see `docs/EVAL_REPORT.md` for what each case actually checks). Re-run any time after changing a prompt or workflow to catch a regression.

## 5. Try it by voice
```powershell
python -m http.server 8080 --directory client
# open http://localhost:8080, allow microphone access, press "Start talking"
```
See `docs/DEMO.md` for sharing this live with a team over a tunnel.

## 6. Troubleshooting
| Symptom | Likely cause | Check |
|---|---|---|
| Webhook returns empty `[]` or wrong data with no error | A node upstream returned 0 items and silently stopped the chain | See the "0 output items" gotcha in `docs/N8N_CONTROL.md`; check the n8n execution list in the editor UI |
| `psql`/Postgres node errors on `::uuid` cast | An invalid/malformed `session_id` was passed straight into a query | Every entry point validates this first (`PrepSession`/`PrepBookingSession`) — if you added a new one, do the same |
| A sub-agent's answer never reaches the final reply | `helpers.httpRequest` result wasn't unwrapped from its array | See the "webhook response is a JSON array" gotcha in `docs/N8N_CONTROL.md` |
| Docker build hangs or fails with a `ReadTimeoutError`/hash-mismatch/`IncompleteRead` | Slow or unstable network mid-build | Add `--timeout 300 --retries 10` to the relevant `pip install` (already done for `voice/fallback`); retry - some of these are transient corruption, not permanent |
| `nslookup`/any Docker pull fails with "no such host" | DNS resolution is down at the OS level, not a Docker/app problem | Wait and retry; confirm with `nslookup registry-1.docker.io` directly |
| Voice client shows "voice service unreachable" | `voice/fallback` container isn't running, or CORS isn't configured | `docker ps --filter name=dental-voice`; confirm `curl http://localhost:8000/health` |
| STT mishears a brand name (e.g. "Invisalign" → "invisaline") | Whisper `base` isn't perfect on domain terms; this is a known, tested limitation | Usually harmless — the orchestrator's classifier tends to understand it anyway (verified in `docs/VOICE.md`) |
| A webhook call returns 401/403 | Missing or wrong `X-Webhook-Key` header | Every `/webhook/*` endpoint requires it now (see `docs/N8N_CONTROL.md`) — check `.env`'s `N8N_WEBHOOK_API_KEY` matches what you're sending |

## 7. Tear down
```powershell
./scripts/down.ps1          # stop, keep data
./scripts/down.ps1 -v        # stop and remove volumes (full reset)
```
