-- Params: $1 session_id, $2 role, $3 content, $4 intents(json text|null), $5 sources(json text|null)
INSERT INTO messages (session_id, role, content, intents, sources)
VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
RETURNING id;
