// Parse extracted booking slots, decide status, prep DB params (Code node).
// Input : OpenAI response (from BuildBookingReq's oai_body).
const query = $('BuildBookingReq').first().json.query;
const clinicRows = $('LookupClinic').all().map(function (i) { return i.json; });
const clinic = clinicRows.length ? clinicRows[0] : null;

let slots = {};
try { slots = JSON.parse($input.first().json.choices[0].message.content); } catch (e) { slots = {}; }

const service_name = slots.service_name || null;
const preferred_date = slots.preferred_date || null;
const preferred_time = slots.preferred_time || null;
const patient_name = slots.patient_name || null;
const patient_contact = slots.patient_contact || null;

const missing = [];
if (!service_name) missing.push('service');
if (!preferred_date && !preferred_time) missing.push('preferred date or time');
if (!patient_name) missing.push('your name');

const status = missing.length === 0 ? 'confirming' : 'collecting';

return [{
  json: {
    query,
    clinic_id: clinic ? clinic.id : null,
    clinic_name: clinic ? clinic.name : null,
    clinic_phone: clinic ? clinic.phone : null,
    clinic_booking_url: clinic ? clinic.booking_url : null,
    service_name, preferred_date, preferred_time, patient_name, patient_contact,
    status, missing,
  },
}];
