// Intent Classifier — build the OpenAI request (Code node).
// Input : this node's own $input is LoadHistory's rows; query/website_url
//         come from PrepSession, the resolved session id from GetOrCreateSession.
// Output: { query, session_id, website_url, oai_body }
const prep = $('PrepSession').first().json;
const query = prep.query;
const session_id = $('GetOrCreateSession').first().json.id;
const history = $input.first().json.history || []; // [{role, content}] (PackHistory wraps LoadHistory's rows)

const sys = [
  'Classify a dental/orthodontic clinic chatbot query into one or more intents.',
  'Intents: "pricing" (cost/price/insurance questions), "services" (treatments, FAQs, general dental/ortho questions),',
  '"general" (clinic info: doctors, location, contact, policies, about), "booking" (scheduling/appointment requests).',
  'A query can match multiple intents. Use the recent conversation to resolve follow-ups ("what about that", "and the price?").',
  'Return ONLY JSON:',
  '{ "intents": [ { "name": "pricing"|"services"|"general"|"booking", "confidence": 0.0-1.0 } ] }',
  'Include only intents that are plausibly relevant; omit ones that clearly do not apply.',
  'If the query is unrelated to a dental/orthodontic clinic (e.g. general trivia, unrelated topics), return { "intents": [] }.',
].join('\n');

const historyText = history.length
  ? 'RECENT CONVERSATION:\n' + history.map(function (h) { return h.role + ': ' + h.content; }).join('\n') + '\n\n'
  : '';

return [{
  json: {
    query, session_id, website_url: prep.website_url,
    oai_body: {
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: historyText + 'LATEST MESSAGE: ' + query },
      ],
    },
  },
}];
