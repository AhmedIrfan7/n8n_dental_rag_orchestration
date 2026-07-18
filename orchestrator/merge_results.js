// Response Merger — n8n Code node (Run Once for All Items).
// Collects the parallel sub-agent outputs into one deduped context bundle.
// Input : RouteAndCall's output { query, agent_results[], used_fallback, ... }
const d = $input.first().json;
const results = d.agent_results || [];

const seen = new Set();
const answers = [];
let any_grounded = false;
for (const r of results) {
  if (!r || !r.answer) continue;
  const key = r.answer.trim().toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);
  if (r.grounded) any_grounded = true;
  answers.push({ intent: r.intent, grounded: !!r.grounded, text: r.answer });
}

return [{
  json: {
    query: d.query, session_id: d.session_id, website_url: d.website_url,
    intents: d.intents, routed: d.routed, used_fallback: d.used_fallback,
    any_grounded,
    answers,
  },
}];
