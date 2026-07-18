// Booking slot extraction — build the OpenAI request (Code node).
// Input : webhook body { query, website_url } (read via named reference since
//         LookupClinic sits between Webhook and this node, so $input here is
//         the Postgres row, not the webhook payload).
// Output: { query, website_url, oai_body }
const webhookJson = $('Webhook').first().json;
const body = webhookJson.body || webhookJson || {};
const query = String(body.query || '').trim();
if (!query) throw new Error('query is required');
const today = new Date().toISOString().slice(0, 10);

const sys = [
  "Extract a dental/orthodontic appointment request from the patient's message.",
  'Today\'s date is ' + today + ' (YYYY-MM-DD). Resolve relative dates ("next Monday", "tomorrow") against it; use null if you cannot resolve a date confidently.',
  'Return ONLY JSON: { "service_name": string|null, "preferred_date": "YYYY-MM-DD"|null, "preferred_time": "HH:MM"|null (24h), "patient_name": string|null, "patient_contact": string|null }',
  'Do not invent values not implied by the message. Leave a field null if absent.',
].join('\n');

return [{
  json: {
    query, website_url: body.website_url,
    oai_body: {
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: query },
      ],
    },
  },
}];
