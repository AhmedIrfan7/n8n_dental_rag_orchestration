-- Load cleaned pages for a clinic for extraction.
-- Params: $1 website_url, $2 limit (nullable -> all)
SELECT p.url, p.page_type, p.clean_text
FROM pages_raw p
JOIN clinic c ON c.id = p.clinic_id
WHERE c.website_url = $1
  AND p.status_code = 200
  AND char_length(p.clean_text) > 40
ORDER BY p.id
LIMIT COALESCE($2::int, 1000);
