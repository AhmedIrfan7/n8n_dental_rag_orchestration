// Resolve whichever Finalize branch executed (referencing a node that did
// NOT run in this execution path throws, not returns undefined - so this
// must be a try/catch, never a ternary on $('Node').first()).
function tryGet(nodeName) {
  try { const v = $(nodeName).first(); return v ? v.json : null; } catch (e) { return null; }
}
const f = tryGet('FinalizeSkip') || tryGet('FinalizeSynth');

return [{
  json: {
    query: f.query, reply: f.reply, session_id: f.session_id,
    intents: f.intents, routed: f.routed, grounded: f.grounded, sources: f.sources,
  },
}];
