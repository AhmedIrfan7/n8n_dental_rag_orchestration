-- Bulk-upsert crawled pages into pages_raw, ensuring the clinic row exists.
-- Params: $1 website_url (text), $2 pages (JSON array string)
-- Each page object: { url, url_hash, page_type, title, clean_text, status_code }
WITH c AS (
  INSERT INTO clinic (website_url) VALUES ($1)
  ON CONFLICT (website_url) DO UPDATE SET website_url = EXCLUDED.website_url
  RETURNING id
)
INSERT INTO pages_raw (clinic_id, url, url_hash, page_type, title, clean_text, status_code)
SELECT c.id, p.url, p.url_hash, p.page_type, p.title, p.clean_text, p.status_code
FROM c,
     jsonb_to_recordset($2::jsonb) AS p(
       url text, url_hash text, page_type text, title text, clean_text text, status_code int
     )
ON CONFLICT (url_hash) DO UPDATE SET
  clean_text  = EXCLUDED.clean_text,
  page_type   = EXCLUDED.page_type,
  title       = EXCLUDED.title,
  status_code = EXCLUDED.status_code,
  fetched_at  = now()
RETURNING id, page_type;
