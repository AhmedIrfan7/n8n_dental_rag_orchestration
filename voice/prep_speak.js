// Unwrap the orchestrator's response and build the /speak request (Code node).
// Input : AskOrchestrator's HTTP response - a JSON array (n8n webhook
// responseData:'allEntries' convention; see route_and_call.js for the
// same array-unwrap lesson learned in Phase 7).
let res = $input.first().json;
if (Array.isArray(res)) res = res[0] || {};

const reply = res.reply || "I'm not sure - please contact the clinic directly.";

return [{
  json: {
    reply,
    session_id: res.session_id,
    speak_body: { text: reply },
  },
}];
