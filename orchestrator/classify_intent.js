// Intent Classifier — build the OpenAI request (Code node).
// Input : this node's own $input is LoadHistory's rows; query/website_url
//         come from PrepSession, the resolved session id from GetOrCreateSession.
// Output: { query, session_id, website_url, is_greeting, oai_body }
const prep = $('PrepSession').first().json;
const query = prep.query;
const session_id = $('GetOrCreateSession').first().json.id;
const history = $input.first().json.history || []; // [{role, content}] (PackHistory wraps LoadHistory's rows)

// A plain greeting/pleasantry ("hi", "thanks", "good morning") matches none
// of the four real intents by design - it used to still pay for a full
// OpenAI network round trip just to learn that. Only the ENTIRE message
// (not a substring) matching one of these conservative patterns short-
// circuits the classify call - "hi, how much does invisalign cost" still
// goes through the LLM normally, only bare chit-chat skips it.
function isGreeting(q) {
  const norm = String(q || '').toLowerCase().trim().replace(/[!.?]+$/, '');
  const patterns = [
    /^(hi|hello|hey|hiya|yo|howdy)$/,
    /^(hi|hello|hey)\s+(there|guys|team)$/,
    /^good\s*(morning|afternoon|evening|day)$/,
    /^how\s*(are|r)\s*(you|u)(\s*doing)?$/,
    /^what'?s\s*up$/,
    /^(thanks|thank you|thank you very much|thx|ty)$/,
    /^(bye|goodbye|see you|see ya)$/,
    /^(ok|okay|cool|great|nice|sounds good)$/,
  ];
  return patterns.some(function (p) { return p.test(norm); });
}
// Only short-circuits the FIRST message of a session - "thanks" said mid
// conversation (after a real question) should not reset to the canned
// intro reply, only an opening "hi" should.
const is_greeting = history.length === 0 && isGreeting(query);

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
    query, session_id, website_url: prep.website_url, is_greeting,
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
