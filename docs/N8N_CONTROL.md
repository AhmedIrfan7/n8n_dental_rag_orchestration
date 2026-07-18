# n8n Headless Control (v2.9.4)

n8n 2.x separates **publish** (versioning) from **active** (listening), and its
CLI `import`/`publish` are awkward for iterative dev. We drive n8n via its
**internal `/rest` API** (the same endpoints the editor UI uses), which handles
schema/versioning natively and activates webhooks in-process (no restart).

## One-time setup (already done; state lives in gitignored `.env`)
- **Owner account** initialized: `POST /rest/owner/setup` `{email, firstName, lastName, password}`. Local instance only — creds in `.env` (`N8N_OWNER_EMAIL`, `N8N_OWNER_PASSWORD`).
- **Public API key** minted: `POST /rest/api-keys` `{label, expiresAt:null, scopes:[...]}` → `N8N_API_KEY` (used for read/export; writes go via `/rest`).
- **Postgres credential** created: `POST /rest/credentials` `{name, type:"postgres", data:{host:"dental-postgres",port:5432,database,user,password,ssl:"disable"}}` → id in `N8N_PG_CRED_ID`.
- **Webhook auth credential** created: `POST /rest/credentials` `{name:"Webhook Auth", type:"httpHeaderAuth", data:{name:"X-Webhook-Key", value:<random secret>}}` → id in `N8N_WEBHOOK_AUTH_CRED_ID`, secret in `N8N_WEBHOOK_API_KEY`. Every Webhook trigger node requires this header (`authentication:'headerAuth'` + this credential); every internal call to another workflow's webhook sends it too - dedicated HTTP Request nodes via the same credential (`authentication:'predefinedCredentialType', nodeCredentialType:'httpHeaderAuth'`), and the one Code-node case (`orchestrator/route_and_call.js`, which calls sub-agents via a manual `helpers.httpRequest` and can't use credential injection) via the `__WEBHOOK_API_KEY__` placeholder substituted at deploy time. Without this, every webhook was fully public - anyone with the URL could trigger scraping or burn OpenAI credits.

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

## ⚠️ A node with 0 output items silently stops the whole chain
Hit this **three times** across the project (`store_facts.sql` returning 0 rows when a run legitimately had zero policies; `find_open_booking.sql` returning 0 rows on a first-time booking; `load_history.sql` returning 0 rows for a brand-new conversation): if a node's output has 0 items, **every node connected downstream of it simply never executes** — no error anywhere, the execution just reports `success` and stops. This is easy to miss because nothing looks wrong until you notice the response is empty/wrong.

**A wrapper Code node placed immediately after does NOT fix this** — the wrapper is itself just another node receiving 0 items on its input, so it's skipped too. The only real fix is at the SQL/data level: make the query always return **exactly one row**, using either:
- `UNION ALL` with a `NULL`-filled sentinel row when nothing matches (see `db/queries/find_open_booking.sql`), or
- an aggregation (`jsonb_agg`) that collapses N rows — including zero — into one row containing a JSON array column (see `db/queries/load_history.sql`).

Related, separate gotcha: referencing another node via `$('NodeName')` **throws** if that node did not execute in the current run (e.g. the untaken branch of an IF) — it does not return `undefined`. Never write `$('A').first() ? ... : $('B').first()...` to pick between two IF branches; that throws on whichever branch didn't run. Use try/catch (see `orchestrator/prep_assistant_msg.js`, `orchestrator/compose_response.js`).

## ⚠️ A webhook's own response body is a JSON array, not the object itself
A webhook trigger with `responseData:'allEntries'` returns `[{...}]` — a **one-element array** — not `{...}` directly. n8n's own HTTP Request *node* auto-unwraps this when it calls another workflow's webhook. `this.helpers.httpRequest()` called manually from inside a **Code** node does **not** — it returns the raw array. `{ ...res }` spread on an unwrapped array silently produces `{0: {...}}` (a stray numeric key) instead of the real fields, with no error anywhere (see `orchestrator/route_and_call.js`'s fix: `if (Array.isArray(res)) res = res[0] || {}` before spreading).

## ⚠️ JS Task Runner sandbox constraints (critical for all Code nodes)
Code nodes run in the **JS Task Runner** (out-of-process). The sandbox is restricted:
- **No `URL` global** — `new URL()` throws `URL is not defined`. Parse/join URLs with string ops.
- **No `$env`** — not reliably present; pass config via the request body / previous nodes instead.
- **No `fetch`** — use `this.helpers.httpRequest({url, method, headers, json:false})` (this IS available; returns a string when `json:false`).
- Standard JS (`Set`, `Map`, `Array`, regex, `JSON`, `parseInt`, ...) works. Prefer `.match()` over `matchAll()`+spread.
- Wrap node bodies in `try/catch` returning `{__error}` — webhook 500s expose no error body, so self-report errors in the output during dev.
