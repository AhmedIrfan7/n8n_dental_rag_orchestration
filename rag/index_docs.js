// RAG indexing — n8n Code node (Run Once for All Items).
// Input : documents { ext_id, dtype, section, url, text } from LoadDocs.
// Action: chunk pages, embed every chunk via Ollama, upsert to Qdrant (clear prior
//         points for this website first). Ollama + Qdrant need no auth and are on
//         the docker network, so this.helpers.httpRequest reaches both.
const helpers = this.helpers;
const OLLAMA = 'http://dental-ollama:11434';
const QDRANT = 'http://dental-qdrant:6333';
const COLL = 'clinic_kb';
const MODEL = 'nomic-embed-text';
const website_url = $('Webhook').first().json.body.website_url;

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0; const v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16);
  });
}
function chunkText(t, size) {
  size = size || 800;
  const paras = String(t).split(/\n{2,}|\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  const out = []; let cur = '';
  for (const p of paras) {
    if ((cur + ' ' + p).length > size) {
      if (cur) out.push(cur.trim());
      if (p.length > size) { for (let i = 0; i < p.length; i += size) out.push(p.slice(i, i + size)); cur = ''; }
      else cur = p;
    } else cur = cur ? cur + ' ' + p : p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
async function embed(text) {
  const r = await helpers.httpRequest({ method: 'POST', url: OLLAMA + '/api/embeddings', body: { model: MODEL, prompt: text }, json: true, timeout: 30000 });
  return r.embedding;
}

const docs = $input.all().map(function (i) { return i.json; });
const points = [];
for (const d of docs) {
  const chunks = d.dtype === 'page' ? chunkText(d.text) : [d.text];
  for (let ci = 0; ci < chunks.length; ci++) {
    const text = String(chunks[ci] || '').trim();
    if (text.length < 20) continue;
    const vector = await embed(text);
    points.push({
      id: uuid(),
      vector,
      payload: { website_url, ext_id: d.ext_id, type: d.dtype, section: d.section, url: d.url, chunk_index: ci, text },
    });
  }
}

// Clear prior points for this clinic (idempotent re-index)
await helpers.httpRequest({
  method: 'POST', url: QDRANT + '/collections/' + COLL + '/points/delete',
  body: { filter: { must: [{ key: 'website_url', match: { value: website_url } }] } }, json: true, timeout: 30000,
});
// Upsert in batches
for (let i = 0; i < points.length; i += 100) {
  await helpers.httpRequest({
    method: 'PUT', url: QDRANT + '/collections/' + COLL + '/points?wait=true',
    body: { points: points.slice(i, i + 100) }, json: true, timeout: 30000,
  });
}
return [{ json: { website_url, docs: docs.length, chunks_indexed: points.length } }];
