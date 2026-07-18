// Build a grounded-answer LLM request from retriever output (Code node).
// Input : { query, grounded, top_score, matches[] } from Retrieve, plus
//         a static `agentRole`/`instructions` baked in per sub-agent workflow.
// Output: { query, grounded, oai_body } for the following OpenAI node.
// AGENT_ROLE and AGENT_RULES are injected by string-substitution at build time
// (see scripts/build_workflows.js) so this one file serves every sub-agent.
const AGENT_ROLE = '__AGENT_ROLE__';
const AGENT_RULES = '__AGENT_RULES__';

const d = $input.first().json;
const query = d.query;
const grounded = !!d.grounded;
const matches = d.matches || [];

if (!grounded || matches.length === 0) {
  return [{
    json: {
      query, grounded: false,
      answer: null,
      needs_fallback: true,
    },
  }];
}

const context = matches.map(function (m, i) {
  return '[' + (i + 1) + '] (' + m.type + ') ' + m.text;
}).join('\n\n');

const sys = [
  'You are the ' + AGENT_ROLE + ' for a dental/orthodontic clinic chatbot.',
  AGENT_RULES,
  'CRITICAL: Only use facts present in the CONTEXT below. Never invent prices, names, hours, or policies.',
  'If the context does not fully answer the question, say what you do know and suggest contacting the clinic for specifics.',
  'Cite nothing explicitly (no [1] markers in the reply) - just write a natural, professional, concise answer (<= 80 words).',
].join('\n');

const user = 'QUESTION: ' + query + '\n\nCONTEXT:\n' + context;

return [{
  json: {
    query, grounded: true, needs_fallback: false,
    oai_body: {
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
    },
  },
}];
