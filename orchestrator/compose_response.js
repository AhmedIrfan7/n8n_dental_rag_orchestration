// Terminal node - runs after SaveAssistantMsg (whose own output is a
// {id} row, not the reply). Read the already-resolved data from
// PrepAssistantMsg to build the orchestrator's response shape.
const f = $('PrepAssistantMsg').first().json;

return [{
  json: {
    reply: f.reply,
    session_id: f.session_id,
    intents: f.intents,
    routed: f.routed,
    grounded: f.grounded,
    sources: f.sources,
  },
}];
