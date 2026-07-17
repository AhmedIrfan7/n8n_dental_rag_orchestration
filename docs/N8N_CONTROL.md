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
- Webhook trigger: `n8n-nodes-base.webhook` typeVersion **2**, `responseMode:"lastNode"`. Set `responseData:"allEntries"` to return every item (default returns only the first). Production URL: `/webhook/<path>`.
- Code (JS): `n8n-nodes-base.code` typeVersion **2**, `parameters.jsCode`, returns `[{json:{...}}]`.
- Committed workflow JSON contains only `{name, nodes, connections, settings}` (no instance `id`); the deploy helper upserts by `name` and sends the **raw JSON as UTF-8 bytes** (PS 5.1 `ConvertTo-Json`/string bodies corrupt large `jsCode`).
- **Activation flow (2.x):** create/update via `/rest` → `n8n publish:workflow --id` → PATCH `active:true` → **restart** to register webhooks. The deploy helper's `-Activate` does all of this.

## ⚠️ JS Task Runner sandbox constraints (critical for all Code nodes)
Code nodes run in the **JS Task Runner** (out-of-process). The sandbox is restricted:
- **No `URL` global** — `new URL()` throws `URL is not defined`. Parse/join URLs with string ops.
- **No `$env`** — not reliably present; pass config via the request body / previous nodes instead.
- **No `fetch`** — use `this.helpers.httpRequest({url, method, headers, json:false})` (this IS available; returns a string when `json:false`).
- Standard JS (`Set`, `Map`, `Array`, regex, `JSON`, `parseInt`, ...) works. Prefer `.match()` over `matchAll()`+spread.
- Wrap node bodies in `try/catch` returning `{__error}` — webhook 500s expose no error body, so self-report errors in the output during dev.
