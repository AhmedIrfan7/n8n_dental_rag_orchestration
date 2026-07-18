// Retrieval — n8n Code node (Run Once for All Items).
// Input : webhook body { query, website_url, type?, top_k?, min_score? }
// Output: ONE item { query, grounded, top_score, matches:[{score,type,section,url,text}] }
// Grounding guard: if the best match scores below min_score, flag grounded=false
// so callers (sub-agents/synthesizer) know to fall back rather than invent an answer.
const helpers = this.helpers;
const OLLAMA = 'http://dental-ollama:11434';
const QDRANT = 'http://dental-qdrant:6333';
const COLL = 'clinic_kb';
const MODEL = 'nomic-embed-text';

const body = $input.first().json.body || $input.first().json || {};
const query = String(body.query || '').trim();
const website_url = body.website_url || null;
const topK = parseInt(body.top_k || 6, 10);
const minScore = typeof body.min_score === 'number' ? body.min_score : 0.55;
if (!query) throw new Error('query is required');

const e = await helpers.httpRequest({
  method: 'POST', url: OLLAMA + '/api/embeddings',
  body: { model: MODEL, prompt: query }, json: true, timeout: 30000,
});
const vector = e.embedding;

const must = [];
if (website_url) must.push({ key: 'website_url', match: { value: website_url } });
if (body.type) must.push({ key: 'type', match: { value: body.type } });

const searchBody = { vector, limit: topK, with_payload: true };
if (must.length) searchBody.filter = { must };

const r = await helpers.httpRequest({
  method: 'POST', url: QDRANT + '/collections/' + COLL + '/points/search',
  body: searchBody, json: true, timeout: 30000,
});

const seen = new Set();
const matches = [];
for (const hit of (r.result || [])) {
  const key = (hit.payload.ext_id || '') + ':' + (hit.payload.chunk_index || 0);
  if (seen.has(key)) continue;
  seen.add(key);
  matches.push({
    score: hit.score,
    type: hit.payload.type,
    section: hit.payload.section,
    url: hit.payload.url,
    text: hit.payload.text,
  });
}

const top_score = matches.length ? matches[0].score : 0;
return [{
  json: {
    query,
    grounded: top_score >= minScore,
    top_score,
    matches,
  },
}];
