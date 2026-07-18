# ADR-0004: Grounding = Postgres fact tables + Qdrant vectors, not vectors alone

## Context
A vectors-only RAG setup still lets an LLM paraphrase or round retrieved numbers ("around $3,000" from a chunk that never actually states a price). The brief explicitly required fact-based, no-hallucination answers, including exact things like pricing and hours.

## Decision
Structured extraction (`02_extract_facts`) writes exact values into typed Postgres tables (`pricing.price_min/max`, `hours.open_time/close_time`, etc.) as the ground truth. The same facts are *also* indexed into Qdrant as synthetic chunks so they're retrievable by open-ended questions, but a sub-agent whose job is a specific fact type can read the Postgres row directly rather than trusting an LLM's reading of a chunk.

## Consequences
- Proven in the eval suite: pricing questions consistently return "cost varies... contact for a quote" (matching what's actually in the `pricing` table — real rows have no exact number) rather than a fabricated figure, across many independent test runs.
- Adds ingestion complexity (structured extraction can fail to capture something the raw page text still has — observed with clinic contact info, JS-rendered and missed by static extraction). Mitigated: RAG retrieval still finds it in raw page text, so the gap degrades gracefully rather than causing a wrong answer.
- Requires the extraction schema (`db/queries/store_facts.sql`) to stay in sync with the actual fact tables; adding a new fact type means updating both the extraction prompt and the schema.
