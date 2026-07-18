// Booking slot extraction — build the OpenAI request (Code node).
// Input : webhook body { query, website_url, session_id? } (read via named
//         reference since LookupClinic/FindOpenBooking sit between Webhook
//         and this node, so $input here is FindOpenBooking's row, not the
//         webhook payload). Also sees any already-collected slots for this
//         session so the model can fill gaps rather than re-asking.
// Output: { query, website_url, session_id, has_open, oai_body }
const webhookJson = $('Webhook').first().json;
const body = webhookJson.body || webhookJson || {};
const query = String(body.query || '').trim();
if (!query) throw new Error('query is required');

const session_id = $('EnsureSession').first().json.id;

const openRows = $('FindOpenBooking').all().map(function (i) { return i.json; });
const open = (openRows.length && openRows[0].id != null) ? openRows[0] : null;

const today = new Date().toISOString().slice(0, 10);
const priorLine = open
  ? 'ALREADY COLLECTED THIS CONVERSATION (do not lose these unless the new message changes them): ' +
    JSON.stringify({ service_name: open.service_name, preferred_date: open.preferred_date, preferred_time: open.preferred_time, patient_name: open.patient_name, patient_contact: open.patient_contact }) + '\n'
  : '';

// The model extracts WHAT was said about the date, not a computed date -
// relative-date arithmetic ("next Monday" -> an actual calendar date) is
// done deterministically in parse_slots.js instead. An LLM doing that math
// itself was verified to get it wrong (resolved "next Monday" a week off).
const sys = [
  "Extract a dental/orthodontic appointment request from the patient's message.",
  'Do NOT compute or resolve any date yourself. If the message states an explicit calendar date ' +
    '("July 25th", "8/25", "the 25th"), put it in "explicit_date" as YYYY-MM-DD (today is ' + today + ', use it only to fill in an implied year/month, never to do weekday math). ' +
    'If the message uses relative/day-of-week language ("next Monday", "tomorrow", "this Friday", "Monday"), ' +
    'put the phrase VERBATIM (lowercase) in "relative_day_phrase" and leave "explicit_date" null - do not convert it to a date yourself.',
  priorLine + 'Return ONLY the NEW information found in the LATEST message below (leave a field null if this specific message does not mention it - prior values are merged in separately, do not repeat them).',
  'JSON shape: { "service_name": string|null, "explicit_date": "YYYY-MM-DD"|null, "relative_day_phrase": string|null, "preferred_time": "HH:MM"|null (24h), "patient_name": string|null, "patient_contact": string|null }',
  'Do not invent values not implied by the message.',
].join('\n');

return [{
  json: {
    query, website_url: body.website_url, session_id, has_open: !!open,
    oai_body: {
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: 'LATEST MESSAGE: ' + query },
      ],
    },
  },
}];
