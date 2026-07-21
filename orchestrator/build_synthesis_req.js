// Synthesizer request builder — n8n Code node.
// Merges the (already-grounded-safe) sub-agent answers into ONE professional
// reply - but ONLY when there's genuinely more than one answer to merge.
// A single sub-agent's answer is already a complete, well-formed reply (see
// rag/build_answer_req.js's own system prompt), so running it through a
// second LLM pass just to "sound nice" was pure added latency for the
// common case (one topic per question) - this used to cost a whole extra
// gpt-4o round trip on top of classify + the sub-agent's own call, which
// was the single biggest contributor to response time. Only 2+ genuinely
// different sub-agent answers need an actual merge pass.
const d = $input.first().json;

const FALLBACK_MESSAGE = "Hi! I'm the clinic's virtual assistant - I can help with services, pricing, hours, or booking an appointment. What would you like to know?";

if (d.used_fallback || d.answers.length <= 1) {
  return [{
    json: {
      query: d.query, session_id: d.session_id,
      skip_llm: true,
      final_answer: (d.answers[0] && d.answers[0].text) || FALLBACK_MESSAGE,
    },
  }];
}

const bundle = d.answers.map(function (a, i) {
  return '[' + (i + 1) + '] (' + a.intent + (a.grounded ? '' : ', not grounded') + ') ' + a.text;
}).join('\n\n');

const sys = [
  'You are the front-desk voice/chat assistant for a dental/orthodontic clinic.',
  'Combine the sub-agent answers below into ONE natural, warm, professional reply to the patient.',
  'Do not add any fact not present in the sub-agent answers. Do not repeat the same point twice.',
  'If some answers say information is unavailable, acknowledge that briefly rather than glossing over it.',
  'Keep it concise (<= 100 words), no bullet points, no citation markers - just plain conversational text suitable for text-to-speech.',
].join('\n');

const user = 'PATIENT QUESTION: ' + d.query + '\n\nSUB-AGENT ANSWERS:\n' + bundle;

return [{
  json: {
    query: d.query, session_id: d.session_id,
    skip_llm: false,
    // gpt-4o-mini, not gpt-4o: this pass only merges/rewrites 2-4 short
    // already-correct paragraphs into one - it doesn't need frontier
    // reasoning, and mini is meaningfully faster for the same task.
    oai_body: {
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
    },
  },
}];
