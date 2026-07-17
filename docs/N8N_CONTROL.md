# n8n Headless Control (v2.9.4)

n8n 2.x separates **publish** (versioning) from **active** (listening), and its
CLI `import`/`publish` are awkward for iterative dev. We drive n8n via its
**internal `/rest` API** (the same endpoints the editor UI uses), which handles
schema/versioning natively and activates webhooks in-process (no restart).

## One-time setup (already done; state lives in gitignored `.env`)
- **Owner account** initialized: `POST /rest/owner/setup` `{email, firstName, lastName, password}`. Local instance only — creds in `.env` (`N8N_OWNER_EMAIL`, `N8N_OWNER_PASSWORD`).
- **Public API key** minted: `POST /rest/api-keys` `{label, expiresAt:null, scopes:[...]}` → `N8N_API_KEY` (used for read/export; writes go via `/rest`).
- **Postgres credential** created: `POST /rest/credentials` `{name, type:"postgres", data:{host:"dental-postgres",port:5432,database,user,password,ssl:"disable"}}` → id in `N8N_PG_CRED_ID`.

## Verified endpoints
| Action | Call |
|---|---|
| Login (cookie) | `POST /rest/login {emailOrLdapLoginId, password}` |
| List workflows | `GET /rest/workflows` |
| Create workflow | `POST /rest/workflows {name, nodes, connections, settings}` |
| Update workflow | `PATCH /rest/workflows/{id} {nodes, connections, settings, ...}` |
| **Activate** | `PATCH /rest/workflows/{id} {"active":true}` |
| Deactivate | `PATCH /rest/workflows/{id} {"active":false}` |
| Delete | deactivate → `POST /rest/workflows/{id}/archive` → `DELETE /rest/workflows/{id}` |
| Create credential | `POST /rest/credentials {name, type, data}` |

## Deploy helper
[`scripts/n8n_deploy.ps1`](../scripts/n8n_deploy.ps1) — idempotent upsert-by-name from a JSON file, with placeholder substitution and optional activation:
```powershell
./scripts/n8n_deploy.ps1 -File workflows/01_ingestion_pipeline.json -Activate
```
Placeholders substituted from `.env` at deploy time (keeps committed JSON portable):
- `__PG_CRED_ID__` → `N8N_PG_CRED_ID`

## Node authoring notes (validated on 2.9.4)
- Webhook trigger: `n8n-nodes-base.webhook` typeVersion **2**, `responseMode:"lastNode"` → response is the last node's JSON. Production URL: `/webhook/<path>`.
- Code (JS): `n8n-nodes-base.code` typeVersion **2**, `parameters.jsCode`, returns `[{json:{...}}]`. `$env.VAR` available (`N8N_BLOCK_ENV_ACCESS_IN_NODE=false`).
- OpenAI calls: HTTP Request node with `Authorization: Bearer {{$env.OPENAI_API_KEY}}` (no credential needed).
- Committed workflow JSON omits the instance-specific `id`; the deploy helper upserts by `name`.
