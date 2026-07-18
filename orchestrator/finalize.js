// Finalize — runs after either the Synthesizer OpenAI call or the skip-LLM
// passthrough. Produces the orchestrator's single response shape.
// Node name tells us which branch ran (IsSkipLLM routes here from both sides).
const d = $('BuildSynthesisReq').first().json;
const merged = $('MergeResults').first().json;

let reply;
if (d.skip_llm) {
  reply = d.final_answer;
} else {
  try { reply = $input.first().json.choices[0].message.content.trim(); }
  catch (e) { reply = (merged.answers[0] && merged.answers[0].text) || "I'm not sure - please contact the clinic directly."; }
}

return [{
  json: {
    query: merged.query,
    reply,
    session_id: d.session_id,
    intents: merged.intents,
    routed: merged.routed,
    grounded: merged.any_grounded,
    sources: merged.answers.map(function (a) { return { intent: a.intent, grounded: a.grounded }; }),
  },
}];
