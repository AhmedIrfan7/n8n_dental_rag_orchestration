// Router + Parallel Executor — n8n Code node (Run Once for All Items).
// Parses the classifier's intents, fans out to the relevant sub-agent
// webhooks CONCURRENTLY via Promise.all (true parallel execution, not
// sequential HTTP nodes), and tolerates partial failures (one agent
// erroring/timing out does not fail the whole request).
const helpers = this.helpers;
const CONFIDENCE_THRESHOLD = 0.4;
const AGENT_TIMEOUT_MS = 60000;
const BASE = 'http://localhost:5678/webhook/';
const AGENT_PATHS = {
  pricing: 'agent/pricing',
  services: 'agent/services-faq',
  general: 'agent/general',
  booking: 'agent/booking',
};

const cls = $('ClassifyIntent').first().json;
const query = cls.query;
const session_id = cls.session_id;
const website_url = cls.website_url;
const history = $('LoadHistory').first().json.history || []; // LoadHistory returns 1 row with a jsonb array field

let intents = [];
try { intents = (JSON.parse($input.first().json.choices[0].message.content).intents) || []; } catch (e) { intents = []; }
const routed = intents.filter(function (i) { return i && AGENT_PATHS[i.name] && i.confidence >= CONFIDENCE_THRESHOLD; });

async function callAgent(name, path) {
  try {
    let res = await helpers.httpRequest({
      method: 'POST', url: BASE + path,
      body: { query, website_url, session_id, history }, json: true, timeout: AGENT_TIMEOUT_MS,
    });
    // Sub-agent webhooks respond with responseData:'allEntries', so the raw
    // body is a JSON array of items (n8n's dedicated HTTP Request node
    // auto-unwraps this; helpers.httpRequest called from a Code node does not).
    if (Array.isArray(res)) res = res[0] || {};
    return { intent: name, ok: true, ...res };
  } catch (e) {
    return { intent: name, ok: false, error: String((e && e.message) || e) };
  }
}

let results;
let usedFallback = false;
if (routed.length === 0) {
  usedFallback = true;
  results = [{
    intent: 'fallback', ok: true, grounded: false,
    answer: "I'm not sure I can help with that from what I know about this clinic. Could you rephrase, or ask about services, pricing, hours, or booking an appointment?",
  }];
} else {
  results = await Promise.all(routed.map(function (r) { return callAgent(r.name, AGENT_PATHS[r.name]); }));
}

return [{
  json: {
    query, session_id, website_url,
    intents: intents,
    routed: routed.map(function (r) { return r.name; }),
    used_fallback: usedFallback,
    agent_results: results,
  },
}];
