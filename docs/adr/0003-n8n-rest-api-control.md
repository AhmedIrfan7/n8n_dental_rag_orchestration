# ADR-0003: Drive n8n via its internal `/rest` API, not the CLI

## Context
n8n 2.x's CLI `import:workflow`/`export:workflow` don't cleanly support the iterate-fast, upsert-by-name, activate-in-one-step loop this project needed (100+ small verified steps, each committed before the next). The CLI's `publish:workflow` and the REST API's `active` flag are also separate concerns in 2.x.

## Decision
Drive n8n through its internal `/rest` API (the same endpoints the editor UI itself uses): login for a session cookie, `POST/PATCH /rest/workflows` to upsert by name, `n8n publish:workflow` + `PATCH {"active":true}` + a container restart to register webhooks. Wrapped in `scripts/n8n_deploy.ps1`. Workflow logic itself is authored as plain, readable `.js`/`.sql` files and assembled into deployable JSON by `scripts/build_workflows.js` (Node — not PowerShell's `ConvertTo-Json`, which corrupts large multi-line strings in PS 5.1), so node logic is reviewable in a normal code diff.

## Consequences
- No manual clicking in the n8n editor was needed for any of the 10 workflows built.
- The internal API is undocumented/unversioned — verified empirically against n8n 2.9.4 specifically (see `docs/N8N_CONTROL.md`); a major n8n upgrade could change these endpoints.
- Committed workflow JSON contains no instance-specific `id`; credential ids are placeholder-substituted from `.env` at deploy time (`__PG_CRED_ID__`, `__OPENAI_CRED_ID__`), keeping the JSON portable across a fresh n8n instance.
