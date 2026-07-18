-- Params: $1 session_id (nullable UUID text), $2 clinic_id, $3 service_name,
--         $4 preferred_date, $5 preferred_time, $6 patient_name,
--         $7 patient_contact, $8 status, $9 notes
INSERT INTO booking_requests
  (session_id, clinic_id, service_name, preferred_date, preferred_time, patient_name, patient_contact, status, notes)
VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING id, status;
