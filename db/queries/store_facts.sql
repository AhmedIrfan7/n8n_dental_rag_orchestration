-- Store extracted facts into all fact tables in one statement.
-- Params: $1 website_url, $2 clinic(json), $3 services, $4 doctors, $5 pricing,
--         $6 hours, $7 faqs, $8 policies  (each $3..$8 is a JSON array string)
WITH c AS (
  INSERT INTO clinic (website_url) VALUES ($1)
  ON CONFLICT (website_url) DO UPDATE SET website_url = EXCLUDED.website_url
  RETURNING id
),
cid AS (SELECT id FROM c),
upd_clinic AS (
  UPDATE clinic SET
    name        = COALESCE(NULLIF($2::jsonb->>'name',''), name),
    phone       = COALESCE(NULLIF($2::jsonb->>'phone',''), phone),
    email       = COALESCE(NULLIF($2::jsonb->>'email',''), email),
    address     = COALESCE(NULLIF($2::jsonb->>'address',''), address),
    booking_url = COALESCE(NULLIF($2::jsonb->>'booking_url',''), booking_url),
    about       = COALESCE(NULLIF($2::jsonb->>'about',''), about)
  WHERE id = (SELECT id FROM cid)
),
d_pricing  AS (DELETE FROM pricing  WHERE clinic_id = (SELECT id FROM cid)),
d_faqs     AS (DELETE FROM faqs     WHERE clinic_id = (SELECT id FROM cid)),
d_policies AS (DELETE FROM policies WHERE clinic_id = (SELECT id FROM cid)),
ins_services AS (
  INSERT INTO services (clinic_id, name, category, description, source_url)
  SELECT (SELECT id FROM cid), s.name, s.category, s.description, s.source_url
  FROM jsonb_to_recordset($3::jsonb) AS s(name text, category text, description text, source_url text)
  ON CONFLICT (clinic_id, name) DO UPDATE
    SET category = EXCLUDED.category, description = EXCLUDED.description, source_url = EXCLUDED.source_url
),
ins_doctors AS (
  INSERT INTO doctors (clinic_id, name, title, bio, specialties, source_url)
  SELECT (SELECT id FROM cid), d.name, d.title, d.bio,
         CASE WHEN d.specialties IS NULL THEN NULL
              ELSE ARRAY(SELECT jsonb_array_elements_text(d.specialties)) END,
         d.source_url
  FROM jsonb_to_recordset($4::jsonb) AS d(name text, title text, bio text, specialties jsonb, source_url text)
  ON CONFLICT (clinic_id, name) DO UPDATE
    SET title = EXCLUDED.title, bio = EXCLUDED.bio, specialties = EXCLUDED.specialties, source_url = EXCLUDED.source_url
),
ins_pricing AS (
  INSERT INTO pricing (clinic_id, service_name, price_min, price_max, currency, unit, notes, source_url)
  SELECT (SELECT id FROM cid), p.service_name, p.price_min, p.price_max, COALESCE(p.currency,'USD'), p.unit, p.notes, p.source_url
  FROM jsonb_to_recordset($5::jsonb) AS p(service_name text, price_min numeric, price_max numeric, currency text, unit text, notes text, source_url text)
),
ins_hours AS (
  INSERT INTO hours (clinic_id, day_of_week, open_time, close_time, is_closed)
  SELECT (SELECT id FROM cid), h.day_of_week, h.open_time, h.close_time, COALESCE(h.is_closed,false)
  FROM jsonb_to_recordset($6::jsonb) AS h(day_of_week smallint, open_time time, close_time time, is_closed boolean)
  ON CONFLICT (clinic_id, day_of_week) DO UPDATE
    SET open_time = EXCLUDED.open_time, close_time = EXCLUDED.close_time, is_closed = EXCLUDED.is_closed
),
ins_faqs AS (
  INSERT INTO faqs (clinic_id, question, answer, category, source_url)
  SELECT (SELECT id FROM cid), f.question, f.answer, f.category, f.source_url
  FROM jsonb_to_recordset($7::jsonb) AS f(question text, answer text, category text, source_url text)
)
INSERT INTO policies (clinic_id, policy_type, title, content, source_url)
SELECT (SELECT id FROM cid), po.policy_type, po.title, po.content, po.source_url
FROM jsonb_to_recordset($8::jsonb) AS po(policy_type text, title text, content text, source_url text)
RETURNING (SELECT id FROM cid) AS clinic_id;
