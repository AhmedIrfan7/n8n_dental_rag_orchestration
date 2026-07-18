// Format the final booking reply (Code node), after InsertBooking wrote the row.
const s = $('ParseSlots').first().json;
const inserted = $input.first().json; // { id, status } from InsertBooking

const contactBits = [];
if (s.clinic_phone) contactBits.push('call ' + s.clinic_phone);
if (s.clinic_booking_url) contactBits.push('book online at ' + s.clinic_booking_url);
const contactLine = contactBits.length ? ' You can also ' + contactBits.join(' or ') + '.' : '';

let answer;
if (s.status === 'confirming') {
  const when = [s.preferred_date, s.preferred_time].filter(Boolean).join(' at ');
  answer = 'Got it' + (s.patient_name ? ', ' + s.patient_name : '') + '! I\'ve noted your request for ' +
    (s.service_name || 'an appointment') + (when ? ' on ' + when : '') +
    '. The clinic will confirm your appointment shortly.' + contactLine;
} else {
  const asks = [];
  if (s.missing.indexOf('service') !== -1) asks.push('which service or treatment you need');
  if (s.missing.indexOf('preferred date or time') !== -1) asks.push('a preferred date or time');
  if (s.missing.indexOf('your name') !== -1) asks.push('your name');
  answer = 'I can help book that. Could you tell me ' + asks.join(' and ') + '?' + contactLine;
}

return [{
  json: {
    query: s.query,
    booking_id: inserted.id,
    status: inserted.status,
    answer,
  },
}];
