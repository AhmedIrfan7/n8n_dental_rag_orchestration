// Assemble deployable n8n workflow JSON from readable code parts.
// Node is used (not PowerShell ConvertTo-Json) for fast, reliable JSON assembly.
// Usage: node scripts/build_workflows.js
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const writeWf = (name, obj) => {
  const out = path.join(root, 'workflows', name);
  fs.writeFileSync(out, JSON.stringify(obj, null, 2));
  console.log('Built workflows/' + name);
};

const PG_CRED = { postgres: { id: '__PG_CRED_ID__', name: 'Dental Postgres' } };

// ---------------- 01_ingestion_pipeline ----------------
const discover = read('scraping/discover.js');
const fetchClean = read('scraping/fetch_clean.js');
const preparePages = read('scraping/prepare_pages.js');
const upsertPagesSql = read('db/queries/upsert_pages_bulk.sql');

writeWf('01_ingestion_pipeline.json', {
  name: '01_ingestion_pipeline',
  nodes: [
    {
      parameters: { httpMethod: 'POST', path: 'ingest', responseMode: 'lastNode', responseData: 'allEntries', options: {} },
      id: 'a1000000-0000-0000-0000-000000000001',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [-100, 0],
      webhookId: 'a1000000-0000-0000-0000-000000000001',
    },
    {
      parameters: { jsCode: discover },
      id: 'a1000000-0000-0000-0000-000000000002',
      name: 'Discover',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [140, 0],
    },
    {
      parameters: { jsCode: fetchClean },
      id: 'a1000000-0000-0000-0000-000000000003',
      name: 'FetchClean',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [380, 0],
    },
    {
      parameters: { jsCode: preparePages },
      id: 'a1000000-0000-0000-0000-000000000004',
      name: 'PreparePages',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [620, 0],
    },
    {
      parameters: {
        operation: 'executeQuery',
        query: upsertPagesSql,
        options: { queryReplacement: '={{ [$json.website_url, $json.pages_json] }}' },
      },
      id: 'a1000000-0000-0000-0000-000000000005',
      name: 'StorePages',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.6,
      position: [860, 0],
      credentials: PG_CRED,
    },
    {
      parameters: { jsCode: "return [{ json: { website_url: $('Webhook').first().json.body.website_url, pages_stored: $input.all().length } }];" },
      id: 'a1000000-0000-0000-0000-000000000006',
      name: 'Finalize',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1080, 0],
    },
    {
      parameters: {
        method: 'POST', url: 'http://localhost:5678/webhook/extract',
        sendBody: true, specifyBody: 'json',
        jsonBody: '={{ JSON.stringify({ website_url: $json.website_url }) }}',
        options: { timeout: 600000 },
      },
      id: 'a1000000-0000-0000-0000-000000000007',
      name: 'TriggerExtract',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1300, 0],
    },
  ],
  connections: {
    Webhook: { main: [[{ node: 'Discover', type: 'main', index: 0 }]] },
    Discover: { main: [[{ node: 'FetchClean', type: 'main', index: 0 }]] },
    FetchClean: { main: [[{ node: 'PreparePages', type: 'main', index: 0 }]] },
    PreparePages: { main: [[{ node: 'StorePages', type: 'main', index: 0 }]] },
    StorePages: { main: [[{ node: 'Finalize', type: 'main', index: 0 }]] },
    Finalize: { main: [[{ node: 'TriggerExtract', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
});

// ---------------- 02_extract_facts ----------------
const loadPagesSql = read('db/queries/load_pages.sql');
const buildExtractReq = read('scraping/build_extract_req.js');
const parseFacts = read('scraping/parse_facts.js');
const storeFactsSql = read('db/queries/store_facts.sql');

writeWf('02_extract_facts.json', {
  name: '02_extract_facts',
  nodes: [
    { parameters: { httpMethod: 'POST', path: 'extract', responseMode: 'lastNode', responseData: 'allEntries', options: {} },
      id: 'b2000000-0000-0000-0000-000000000001', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [-200, 0], webhookId: 'b2000000-0000-0000-0000-000000000001' },
    { parameters: { operation: 'executeQuery', query: loadPagesSql, options: { queryReplacement: '={{ [$json.body.website_url, $json.body.limit || null] }}' } },
      id: 'b2000000-0000-0000-0000-000000000002', name: 'LoadPages', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [20, 0], credentials: PG_CRED },
    { parameters: { jsCode: buildExtractReq },
      id: 'b2000000-0000-0000-0000-000000000003', name: 'BuildExtractReq', type: 'n8n-nodes-base.code', typeVersion: 2, position: [240, 0] },
    { parameters: {
        method: 'POST', url: 'https://api.openai.com/v1/chat/completions',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'openAiApi',
        sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.oai_body) }}',
        options: { timeout: 45000, batching: { batch: { batchSize: 5, batchInterval: 200 } } },
      },
      id: 'b2000000-0000-0000-0000-000000000004', name: 'OpenAI', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [460, 0],
      retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
      credentials: { openAiApi: { id: '__OPENAI_CRED_ID__', name: 'OpenAI Dental' } } },
    { parameters: { jsCode: parseFacts },
      id: 'b2000000-0000-0000-0000-000000000005', name: 'ParseFacts', type: 'n8n-nodes-base.code', typeVersion: 2, position: [680, 0] },
    { parameters: { operation: 'executeQuery', query: storeFactsSql,
        options: { queryReplacement: '={{ [$json.website_url, $json.clinic_json, $json.services_json, $json.doctors_json, $json.pricing_json, $json.hours_json, $json.faqs_json, $json.policies_json] }}' } },
      id: 'b2000000-0000-0000-0000-000000000006', name: 'StoreFacts', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [900, 0], credentials: PG_CRED },
    { parameters: {
        method: 'POST', url: 'http://localhost:5678/webhook/index',
        sendBody: true, specifyBody: 'json',
        jsonBody: '={{ JSON.stringify({ website_url: $(\'ParseFacts\').first().json.website_url }) }}',
        options: { timeout: 600000 },
      },
      id: 'b2000000-0000-0000-0000-000000000007', name: 'TriggerIndex', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1120, 0] },
    { parameters: { jsCode: "const c = $('ParseFacts').first().json.counts; return [{ json: { ok: true, website_url: $('ParseFacts').first().json.website_url, extracted: c, indexed: $input.first().json } }];" },
      id: 'b2000000-0000-0000-0000-000000000008', name: 'Done', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1340, 0] },
  ],
  connections: {
    Webhook: { main: [[{ node: 'LoadPages', type: 'main', index: 0 }]] },
    LoadPages: { main: [[{ node: 'BuildExtractReq', type: 'main', index: 0 }]] },
    BuildExtractReq: { main: [[{ node: 'OpenAI', type: 'main', index: 0 }]] },
    OpenAI: { main: [[{ node: 'ParseFacts', type: 'main', index: 0 }]] },
    ParseFacts: { main: [[{ node: 'StoreFacts', type: 'main', index: 0 }]] },
    StoreFacts: { main: [[{ node: 'TriggerIndex', type: 'main', index: 0 }]] },
    TriggerIndex: { main: [[{ node: 'Done', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
});

// ---------------- 03_build_index ----------------
const loadDocsSql = read('db/queries/load_docs.sql');
const indexDocs = read('rag/index_docs.js');

writeWf('03_build_index.json', {
  name: '03_build_index',
  nodes: [
    { parameters: { httpMethod: 'POST', path: 'index', responseMode: 'lastNode', responseData: 'allEntries', options: {} },
      id: 'b3000000-0000-0000-0000-000000000001', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], webhookId: 'b3000000-0000-0000-0000-000000000001' },
    { parameters: { operation: 'executeQuery', query: loadDocsSql, options: { queryReplacement: '={{ [$json.body.website_url] }}' } },
      id: 'b3000000-0000-0000-0000-000000000002', name: 'LoadDocs', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [220, 0], credentials: PG_CRED },
    { parameters: { jsCode: indexDocs },
      id: 'b3000000-0000-0000-0000-000000000003', name: 'IndexDocs', type: 'n8n-nodes-base.code', typeVersion: 2, position: [440, 0] },
  ],
  connections: {
    Webhook: { main: [[{ node: 'LoadDocs', type: 'main', index: 0 }]] },
    LoadDocs: { main: [[{ node: 'IndexDocs', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
});
