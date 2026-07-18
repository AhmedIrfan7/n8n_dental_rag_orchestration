// Parse extracted booking slots, MERGE with any already-open booking for
// this session, decide status, prep DB params (Code node).
// Input : OpenAI response (from BuildBookingReq's oai_body).
const req = $('BuildBookingReq').first().json;
const query = req.query;
const clinicRows = $('LookupClinic').all().map(function (i) { return i.json; });
const clinic = clinicRows.length ? clinicRows[0] : null;
const openRows = $('FindOpenBooking').all().map(function (i) { return i.json; });
const open = (openRows.length && openRows[0].id != null) ? openRows[0] : null;

let slots = {};
try { slots = JSON.parse($input.first().json.choices[0].message.content); } catch (e) { slots = {}; }

// New values win when present this turn; otherwise carry forward the
// already-collected ones from the open booking (if any).
const service_name = slots.service_name || (open && open.service_name) || null;
const preferred_date = slots.preferred_date || (open && open.preferred_date) || null;
const preferred_time = slots.preferred_time || (open && open.preferred_time) || null;
const patient_name = slots.patient_name || (open && open.patient_name) || null;
const patient_contact = slots.patient_contact || (open && open.patient_contact) || null;

const missing = [];
if (!service_name) missing.push('service');
if (!preferred_date && !preferred_time) missing.push('preferred date or time');
if (!patient_name) missing.push('your name');

const status = missing.length === 0 ? 'confirming' : 'collecting';

return [{
  json: {
    query,
    booking_id: open ? open.id : null,
    is_update: !!open,
    clinic_id: clinic ? clinic.id : null,
    clinic_name: clinic ? clinic.name : null,
    clinic_phone: clinic ? clinic.phone : null,
    clinic_booking_url: clinic ? clinic.booking_url : null,
    session_id: req.session_id,
    service_name, preferred_date, preferred_time, patient_name, patient_contact,
    status, missing,
  },
}];
