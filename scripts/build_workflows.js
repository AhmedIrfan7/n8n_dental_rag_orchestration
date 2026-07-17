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

// ---------------- 01_ingestion_pipeline ----------------
const discover = read('scraping/discover.js');

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
  ],
  connections: {
    Webhook: { main: [[{ node: 'Discover', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
});
