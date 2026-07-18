-- Merge newly-extracted slots into an existing open booking request.
-- Params: $1 id, $2 service_name, $3 preferred_date, $4 preferred_time,
--         $5 patient_name, $6 patient_contact, $7 status
UPDATE booking_requests SET
  service_name    = COALESCE($2, service_name),
  preferred_date  = COALESCE($3, preferred_date),
  preferred_time  = COALESCE($4, preferred_time),
  patient_name    = COALESCE($5, patient_name),
  patient_contact = COALESCE($6, patient_contact),
  status          = $7,
  updated_at      = now()
WHERE id = $1
RETURNING id, status;
