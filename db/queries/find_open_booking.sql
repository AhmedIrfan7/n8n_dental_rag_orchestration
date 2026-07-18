-- Param: $1 session_id (nullable UUID text)
-- Always returns exactly 1 row: the open booking if one exists, otherwise
-- a NULL-filled sentinel (id IS NULL means "no open booking") so the
-- downstream Code node always gets exactly 1 input item to run on.
WITH found AS (
  SELECT id, service_name, preferred_date, preferred_time, patient_name, patient_contact, status
  FROM booking_requests
  WHERE $1::uuid IS NOT NULL AND session_id = $1::uuid AND status = 'collecting'
  ORDER BY id DESC
  LIMIT 1
)
SELECT id, service_name, preferred_date, preferred_time, patient_name, patient_contact, status FROM found
UNION ALL
SELECT NULL, NULL, NULL, NULL, NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM found);
