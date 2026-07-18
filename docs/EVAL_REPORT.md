# Eval Report

Run date: 2026-07-18. Target: `POST /webhook/ask` (the full orchestrator), against the live KB for `https://www.deroodeortho.com/` (39 services, 3 doctors, 14 FAQs, 2 pricing rows, 2 policies).

**Result: 14/14 passed, average latency 4.2s.**

Reproduce: `node scripts/run_eval.js` (reads `tests/eval/qa.jsonl`, writes `tests/eval/results.json`).

## Categories

| Category | Pass | What it checks |
|---|---|---|
| pricing | 2/2 | Real service names, no invented dollar figures |
| services | 2/2 | Correct descriptions of real treatments |
| general | 2/2 | Correct doctor name/credentials |
| booking | 2/2 | Asks for missing info; acknowledges given info without inventing a confirmation |
| hallucination | 5/5 | See below — the core anti-hallucination probes |
| multi-intent | 1/1 | Two intents fire in parallel and merge into one reply |

## The 5 hallucination probes, and what they actually proved

1. **Off-topic** ("capital of France") — zero intents matched, safe deflection returned without ever calling the LLM synthesizer. Correct.
2. **Empty-table probe** ("Saturday closing time") — the `hours` table is genuinely empty in this KB. Reply: *"I don't have the specific closing time for Saturdays. Please contact the clinic directly."* No invented time. Correct.
3. **Fabricated doctor** ("is Dr. Smith available") — Dr. Smith doesn't exist in the KB (only Dr. deRoode does). Reply correctly redirects to the real doctor and real contact info without ever confirming Dr. Smith's existence or availability.
4. **Unknown payment method** ("bitcoin") — not stated anywhere in the KB. Reply declines to guess either way.
5. **Leading fabricated-price question** ("is it exactly $3000") — reply: *"I can't confirm if it's exactly $3000. For a specific quote, please contact the clinic directly."* This is the textbook-correct anti-hallucination response to a leading question.

### A real finding during eval design, not a system bug
Probes 3 and 5 initially "failed" against a naive `grounded === false` assertion. Reading the actual reply text showed the system was already behaving correctly — `grounded: true` just means *retrieval found relevant context above the similarity threshold* (real doctor/pricing content exists), not *the specific claim in the question was confirmed*. The eval assertions were wrong, not the system. Fixed the test cases to check what actually matters — that the reply text never confirms the fabricated specifics — and both now correctly pass. Documented here rather than quietly editing the numbers, since that distinction matters for trusting this report.

## Bonus finding: RAG compensates for a structured-extraction gap
The `clinic` fact table (name/phone/email/address) is still empty — the contact page's info is JS-rendered and the static-HTML extraction pipeline (documented limitation since Phase 3) can't see it. Despite that, the multi-intent test's reply correctly surfaced a real phone number and street address (`305-373-7799`, `175 SW 7th St, Suite 1408, Miami, FL 33130`) — because that text exists verbatim somewhere in the crawled page content, which the RAG layer retrieved and grounded on directly. The system degrades gracefully: a gap in structured extraction doesn't become a hallucination, because the raw-page RAG path picks up the slack.

## Genericity — verified live against a second, unrelated clinic
Ingested `https://www.ortegaortho.com/` (a real, different orthodontic practice) with the exact same `POST /webhook/ingest {website_url}` call, no code changes: **23 services, 4 doctors, 19 FAQs, 2 pricing rows, 7 hours rows, 1 policy — 75 pages → 317 chunks, in 104.6s.**

Cross-checked both clinics for correct isolation (same DB, same Qdrant collection, filtered by `clinic_id`/`website_url`):
- "who is the orthodontist" against Ortega → *"Dr. William 'Vaughn' Holland..."* (correct, not deRoode)
- "who is the orthodontist" against deroodeortho, same session → still correctly *"Dr. Elaine deRoode..."* (no cross-contamination either direction)

**A real gap this test found, and the fix:** Ortega's hours were correctly extracted into Postgres (Mon–Thu 7:30–16:30, closed Fri–Sun) but the assistant still said *"I don't have the clinic's opening hours available"* — because `db/queries/load_docs.sql` indexed pages/faqs/services/pricing/doctors/policies into Qdrant but never included `hours`. This went unnoticed with the first clinic only because deroodeortho genuinely has zero hours rows, so "I don't know" was coincidentally the correct answer for the wrong reason. Fixed by adding `hours` as an indexable synthetic document (one row per clinic, all 7 days combined into a readable block) and adding `hours` to the general-knowledge agent's retrieval filter. Re-indexed Ortega (`docs` 75→76, exactly +1) and re-tested: *"The clinic opens at 7:30 AM and closes at 4:30 PM from Monday to Thursday. We are closed on Friday, Saturday, and Sunday."* — correct, matches Postgres exactly. Re-ran the full eval suite afterward: still 14/14, no regression.

## Latency
Average 4.2s end-to-end (classify → parallel sub-agent(s) → synthesize → persist). Off-topic fallback is fastest (760ms — skips the LLM synthesis pass entirely). Multi-intent and booking-with-full-slots are the slowest (parallel agent calls + a synthesis pass), still well under 10s.
