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
  ],
  connections: {
    Webhook: { main: [[{ node: 'Discover', type: 'main', index: 0 }]] },
    Discover: { main: [[{ node: 'FetchClean', type: 'main', index: 0 }]] },
    FetchClean: { main: [[{ node: 'PreparePages', type: 'main', index: 0 }]] },
    PreparePages: { main: [[{ node: 'StorePages', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
});
