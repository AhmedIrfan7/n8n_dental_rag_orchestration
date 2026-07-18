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

// Resolve relative-date phrases ("next Monday", "tomorrow") ourselves with
// real Date arithmetic rather than trusting the LLM's math - verified the
// LLM alone gets this wrong (resolved "next Monday" a week off). The model
// only extracts the phrase (build_extract_req.js); this does the computing.
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function resolveRelativeDate(phrase, todayStr) {
  if (!phrase) return null;
  const p = String(phrase).toLowerCase();
  const today = new Date(todayStr + 'T00:00:00Z');
  const fmt = function (d) { return d.toISOString().slice(0, 10); };
  const addDays = function (d, n) { const r = new Date(d.getTime()); r.setUTCDate(r.getUTCDate() + n); return r; };

  if (/\btoday\b/.test(p)) return fmt(today);
  if (/\btomorrow\b/.test(p)) return fmt(addDays(today, 1));

  const dayIdx = WEEKDAYS.findIndex(function (w) { return p.indexOf(w) !== -1; });
  if (dayIdx === -1) return null; // an unrecognized phrase - leave null rather than guess

  const todayIdx = today.getUTCDay();
  let diff = (dayIdx - todayIdx + 7) % 7; // 0 = today, 1-6 = the closest upcoming occurrence
  if (diff === 0 && !/\bthis\b/.test(p)) diff = 7; // "monday"/"next monday" said ON a monday means next week's, unless "this monday"
  return fmt(addDays(today, diff));
}
const today = new Date().toISOString().slice(0, 10);
const resolvedDate = slots.explicit_date || resolveRelativeDate(slots.relative_day_phrase, today);

// New values win when present this turn; otherwise carry forward the
// already-collected ones from the open booking (if any).
const service_name = slots.service_name || (open && open.service_name) || null;
const preferred_date = resolvedDate || (open && open.preferred_date) || null;
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
