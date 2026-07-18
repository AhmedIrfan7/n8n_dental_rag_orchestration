-- Recent conversation turns, oldest first, as ONE row (always exactly 1
-- row regardless of history length - a downstream wrapper node does NOT
-- fix a 0-row SELECT, since it too would receive 0 items and be skipped;
-- the aggregation must happen here, at the SQL level).
-- Params: $1 session_id, $2 max messages (nullable, default 8)
SELECT COALESCE(
  (SELECT jsonb_agg(t ORDER BY t.id) FROM (
    SELECT id, role, content FROM messages
    WHERE session_id = $1
    ORDER BY id DESC
    LIMIT COALESCE($2::int, 8)
  ) t),
  '[]'::jsonb
) AS history;
