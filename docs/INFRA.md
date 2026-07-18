# Infrastructure

Isolated Docker stack defined in [`infra/docker-compose.yml`](../infra/docker-compose.yml). Project name `dental-rag`, network `dental_net`, all containers prefixed `dental-`. Coexists with other stacks (fahrschule, starter-kit) via distinct names/ports/volumes.

## Services

| Service | Container | Host port | Internal | Purpose |
|---|---|---|---|---|
| n8n | `dental-n8n` | 5679 | 5678 | Workflow orchestration engine |
| Qdrant | `dental-qdrant` | 6343 (6344 gRPC) | 6333 | Vector store (`clinic_kb`) |
| Postgres (pgvector) | `dental-postgres` | 5433 | 5432 | Clinic facts + session memory |
| Redis | `dental-redis` | 6380 | 6379 | Cache / session scratch |
| Ollama | `dental-ollama` | 11435 | 11434 | Local embeddings (`nomic-embed-text`) |
| Voice fallback | `dental-voice` | 8000 | 8000 | STT/TTS (`faster-whisper` + Piper) — see `docs/VOICE.md` |

Internal service-to-service URLs (used inside n8n nodes):
`http://dental-qdrant:6333`, `dental-postgres:5432`, `http://dental-ollama:11434`, `dental-redis:6379`.

## Common commands
```powershell
./scripts/up.ps1            # start stack
./scripts/healthcheck.ps1   # verify all services
./scripts/down.ps1          # stop (keep data);  down.ps1 -v  removes volumes
./scripts/export_workflows.ps1   # n8n -> workflows/*.json (version control)
./scripts/import_workflows.ps1   # workflows/*.json -> n8n (restore)
```

## Access
- n8n editor: http://localhost:5679
- Qdrant dashboard: http://localhost:6343/dashboard

## Config & secrets
- `.env` (gitignored) holds real secrets; `.env.example` is the committed template.
- `N8N_ENCRYPTION_KEY` and `POSTGRES_PASSWORD` are auto-generated on setup.
- `OPENAI_API_KEY` is added when the ingestion/extraction phase begins.

## Notes
- Ollama runs CPU-only by default (embeddings are light). GPU passthrough block is commented in the compose file for later opt-in.
- n8n uses its default SQLite store (in the `dental_n8n` volume) for workflow/exec data; application data lives in Postgres/Qdrant.
- Data volumes are Docker-managed (`dental_n8n`, `dental_qdrant`, `dental_pg`, `dental_redis`, `dental_ollama`) and are **not** committed.
