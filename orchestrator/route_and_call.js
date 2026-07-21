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

// Every sub-agent webhook now requires this header (see docs/N8N_CONTROL.md
// and scripts/n8n_deploy.ps1). A dedicated HTTP Request node gets this from
// a credential automatically; a Code node's manual helpers.httpRequest()
// does not, so the literal placeholder below is substituted with the real
// secret at deploy time - never committed with a real value (same pattern
// as __PG_CRED_ID__/__OPENAI_CRED_ID__ elsewhere in this codebase).
const WEBHOOK_KEY = '__WEBHOOK_API_KEY__';

async function callAgent(name, path) {
  try {
    let res = await helpers.httpRequest({
      method: 'POST', url: BASE + path,
      headers: { 'X-Webhook-Key': WEBHOOK_KEY },
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
  // Covers two very different real cases with one message: a plain greeting
  // ("hello", "hi there") that matches none of the four topic intents by
  // design, and a genuinely unrelated/unclear question. Both want the same
  // reply - something warm and inviting rather than the old "I'm not sure I
  // can help with that", which read as a confused/broken response to a
  // simple hello and was reported as such.
  results = [{
    intent: 'fallback', ok: true, grounded: false,
    answer: "Hi! I'm the clinic's virtual assistant - I can help with services, pricing, hours, or booking an appointment. What would you like to know?",
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
