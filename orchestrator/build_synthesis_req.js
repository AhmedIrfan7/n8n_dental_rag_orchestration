// Synthesizer request builder — n8n Code node.
// Merges the (already-grounded-safe) sub-agent answers into ONE professional
// reply. If no sub-agent ran (used_fallback) or produced an answer, skip the
// LLM call entirely and pass the safe deflection straight through - never
// hand a fully-unrelated query to a "make it sound nice" pass.
const d = $input.first().json;

if (d.used_fallback || d.answers.length === 0) {
  return [{
    json: {
      query: d.query, session_id: d.session_id,
      skip_llm: true,
      final_answer: (d.answers[0] && d.answers[0].text) ||
        "I'm not sure I can help with that from what I know about this clinic. Could you ask about services, pricing, hours, or booking an appointment?",
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
    oai_body: {
      model: 'gpt-4o',
      temperature: 0.3,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
    },
  },
}];
