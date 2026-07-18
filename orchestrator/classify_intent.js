// Intent Classifier — build the OpenAI request (Code node).
// Input : webhook body { query, session_id?, website_url }
// Output: { query, session_id, website_url, oai_body }
const body = $input.first().json.body || $input.first().json || {};
const query = String(body.query || '').trim();
if (!query) throw new Error('query is required');

const sys = [
  'Classify a dental/orthodontic clinic chatbot query into one or more intents.',
  'Intents: "pricing" (cost/price/insurance questions), "services" (treatments, FAQs, general dental/ortho questions),',
  '"general" (clinic info: doctors, location, contact, policies, about), "booking" (scheduling/appointment requests).',
  'A query can match multiple intents. Return ONLY JSON:',
  '{ "intents": [ { "name": "pricing"|"services"|"general"|"booking", "confidence": 0.0-1.0 } ] }',
  'Include only intents that are plausibly relevant; omit ones that clearly do not apply.',
  'If the query is unrelated to a dental/orthodontic clinic (e.g. general trivia, unrelated topics), return { "intents": [] }.',
].join('\n');

return [{
  json: {
    query, session_id: body.session_id || null, website_url: body.website_url,
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
