-- Load all indexable documents for a clinic: page text + structured facts.
-- Param: $1 website_url
WITH cid AS (SELECT id FROM clinic WHERE website_url = $1)
SELECT 'page:' || url_hash AS ext_id, 'page' AS dtype, page_type AS section, url,
       clean_text AS text
  FROM pages_raw
  WHERE clinic_id = (SELECT id FROM cid) AND status_code = 200 AND char_length(clean_text) > 60
UNION ALL
SELECT 'faq:' || id::text, 'faq', 'faq', source_url,
       'Q: ' || question || E'\nA: ' || answer
  FROM faqs WHERE clinic_id = (SELECT id FROM cid)
UNION ALL
SELECT 'service:' || id::text, 'service', 'service', source_url,
       'Service: ' || name || COALESCE(' (' || category || ')', '') || COALESCE('. ' || description, '')
  FROM services WHERE clinic_id = (SELECT id FROM cid)
UNION ALL
SELECT 'pricing:' || id::text, 'pricing', 'pricing', source_url,
       'Pricing for ' || service_name || ': ' || COALESCE(notes, '')
       || COALESCE(' (from ' || price_min::text, '') || COALESCE(' to ' || price_max::text || ')', '')
       || ' ' || COALESCE(currency, '')
  FROM pricing WHERE clinic_id = (SELECT id FROM cid)
UNION ALL
SELECT 'doctor:' || id::text, 'doctor', 'doctor', source_url,
       'Doctor: ' || name || COALESCE(', ' || title, '') || COALESCE('. ' || bio, '')
  FROM doctors WHERE clinic_id = (SELECT id FROM cid)
UNION ALL
SELECT 'policy:' || id::text, 'policy', 'policy', source_url,
       'Policy (' || COALESCE(policy_type, '') || '): ' || COALESCE(title || '. ', '') || content
  FROM policies WHERE clinic_id = (SELECT id FROM cid)
UNION ALL
-- One synthetic document combining all 7 days into a single readable block,
-- so opening-hours questions are retrievable (previously extracted into the
-- `hours` table but never indexed - a real gap found via a second-clinic test).
SELECT 'hours:' || (SELECT id FROM cid)::text, 'hours', 'hours', NULL,
       'Opening hours: ' || string_agg(
         (ARRAY['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[day_of_week + 1]
         || ': ' || CASE WHEN is_closed THEN 'closed'
                         ELSE COALESCE(to_char(open_time, 'HH24:MI'), '?') || '-' || COALESCE(to_char(close_time, 'HH24:MI'), '?') END,
         '; ' ORDER BY day_of_week)
  FROM hours WHERE clinic_id = (SELECT id FROM cid)
  HAVING count(*) > 0;
