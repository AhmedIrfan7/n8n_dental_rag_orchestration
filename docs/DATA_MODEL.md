# Data Model

## Postgres — ground truth + memory
Schema in [`db/migrations/0001_init.sql`](../db/migrations/0001_init.sql). Mirrored to `infra/initdb/` so fresh volumes auto-init; applied to the live DB via migration.

### Fact tables (answer grounding)
| Table | Key columns | Used by |
|---|---|---|
| `clinic` | website_url (unique), name, address, phone, email, booking_url, hours-ref | General agent |
| `doctors` | name, title, bio, specialties[] | Services/General |
| `services` | name (unique per clinic), category, description | Services agent |
| `pricing` | service_name, price_min/max, currency, unit, notes | Pricing agent (quote real rows only) |
| `hours` | day_of_week (0=Sun), open/close, is_closed | Booking/General |
| `faqs` | question, answer, category | Services/FAQ agent |
| `policies` | policy_type, title, content | General/FAQ |

### Ingestion audit
- `pages_raw` — raw+clean text per URL, idempotent by `url_hash`; source of chunks.
- `ingestion_runs` — per-run counts (discovered/fetched/extracted/indexed), coverage JSON, status.
- `page_coverage` — per-page extracted entities + confidence.

### Conversation memory
- `sessions` (uuid, channel) · `messages` (role, content, intents, sources) · `booking_requests` (slot-filling state machine: collecting→confirming→booked).

## Qdrant — vectors
- Collection **`clinic_kb`**: 768-dim (nomic-embed-text), cosine.
- Payload: `url`, `section`, `type` (page|faq|service|pricing|doctor|policy|hours), `page_type`, `service_name`, `doctor`, `source_id` (→ `pages_raw.id` for citation).
- `hours` is indexed as one synthetic document per clinic (all 7 days combined) — added after a second-clinic genericity test found it was extracted into Postgres but never made retrievable; see `docs/EVAL_REPORT.md`.
- Payload indexes on `type`, `page_type`, `service_name` for filtered retrieval per sub-agent.
- Created via [`scripts/init_qdrant.ps1`](../scripts/init_qdrant.ps1).

## Grounding principle
Exact facts (pricing, hours, contact) are served from Postgres verbatim. Open-ended questions use Qdrant retrieval with source citations. Every vector carries a `source_id` back to its page so answers can cite and never fabricate.
