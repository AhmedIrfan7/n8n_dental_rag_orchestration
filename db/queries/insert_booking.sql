-- Params: $1 clinic_id, $2 service_name, $3 preferred_date, $4 preferred_time,
--         $5 patient_name, $6 patient_contact, $7 status, $8 notes
INSERT INTO booking_requests
  (clinic_id, service_name, preferred_date, preferred_time, patient_name, patient_contact, status, notes)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, status;
