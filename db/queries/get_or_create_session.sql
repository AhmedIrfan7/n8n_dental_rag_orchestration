-- Resolve a session: reuse if the client supplied a known id, create one
-- otherwise (using the client's id if given and unknown, so the FIRST call
-- of a new conversation still gets a stable id from here on).
-- Param: $1 session_id (nullable UUID text)
-- Always returns exactly 1 row (see store_facts.sql lesson: never let
-- RETURNING depend on a single conditional branch alone).
WITH existing AS (
  SELECT id FROM sessions WHERE $1::uuid IS NOT NULL AND id = $1::uuid
),
upd AS (
  UPDATE sessions SET last_active_at = now() WHERE id IN (SELECT id FROM existing) RETURNING id
),
ins AS (
  INSERT INTO sessions (id, channel)
  SELECT COALESCE($1::uuid, gen_random_uuid()), 'text'
  WHERE NOT EXISTS (SELECT 1 FROM existing)
  RETURNING id
)
SELECT id FROM upd
UNION ALL
SELECT id FROM ins;
