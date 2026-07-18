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

// ---------------- 04_retriever ----------------
const retrieveJs = read('rag/retrieve.js');

writeWf('04_retriever.json', {
  name: '04_retriever',
  nodes: [
    { parameters: { httpMethod: 'POST', path: 'retrieve', responseMode: 'lastNode', responseData: 'allEntries', options: {} },
      id: 'b4000000-0000-0000-0000-000000000001', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], webhookId: 'b4000000-0000-0000-0000-000000000001' },
    { parameters: { jsCode: retrieveJs },
      id: 'b4000000-0000-0000-0000-000000000002', name: 'Retrieve', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 0] },
  ],
  connections: {
    Webhook: { main: [[{ node: 'Retrieve', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
});

// ---------------- sub-agent factory (Pricing / Services-FAQ / General) ----------------
// Shared shape: Webhook -> Retrieve(typeFilter) -> BuildAnswerReq -> IF(grounded)
//   true  -> OpenAI -> ParseAnswer
//   false -> Fallback
// responseMode 'lastNode' returns whichever branch actually executed.
const buildAnswerReqTpl = read('rag/build_answer_req.js');
const parseAnswerJs = "const d = $input.first().json; let a = ''; try { a = d.choices[0].message.content.trim(); } catch (e) { a = ''; } return [{ json: { query: $('BuildAnswerReq').first().json.query, grounded: true, answer: a, needs_fallback: !a } }];";
const fallbackJs = "const d = $input.first().json; return [{ json: { query: d.query, grounded: false, answer: \"I don't have enough information from the clinic's site to answer that confidently. Please contact the clinic directly for details.\", needs_fallback: true } }];";

function buildSubAgentWorkflow(opts) {
  // opts: { fileName, workflowName, webhookPath, agentRole, agentRules, typeFilter }
  const buildAnswerReq = buildAnswerReqTpl
    .replace('__AGENT_ROLE__', opts.agentRole)
    .replace('__AGENT_RULES__', opts.agentRules);
  const retrieveWithFilter = retrieveJs.replace(
    "if (body.type) must.push({ key: 'type', match: { value: body.type } });",
    "if (body.type) must.push({ key: 'type', match: { value: body.type } });\n" +
    (opts.typeFilter ? "if (!body.type) must.push({ key: 'type', match: { any: " + JSON.stringify(opts.typeFilter) + " } });" : '')
  );

  writeWf(opts.fileName, {
    name: opts.workflowName,
    nodes: [
      { parameters: { httpMethod: 'POST', path: opts.webhookPath, responseMode: 'lastNode', responseData: 'allEntries', options: {} },
        id: opts.idPrefix + '01', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [-200, 0], webhookId: opts.idPrefix + '01' },
      { parameters: { jsCode: retrieveWithFilter },
        id: opts.idPrefix + '02', name: 'Retrieve', type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0] },
      { parameters: { jsCode: buildAnswerReq },
        id: opts.idPrefix + '03', name: 'BuildAnswerReq', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 0] },
      { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
          conditions: [{ id: 'c1', leftValue: '={{ $json.grounded }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' } },
        id: opts.idPrefix + '04', name: 'IsGrounded', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [440, 0] },
      { parameters: {
          method: 'POST', url: 'https://api.openai.com/v1/chat/completions',
          authentication: 'predefinedCredentialType', nodeCredentialType: 'openAiApi',
          sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.oai_body) }}',
          options: { timeout: 45000 },
        },
        id: opts.idPrefix + '05', name: 'OpenAI', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [660, -80],
        retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
        credentials: { openAiApi: { id: '__OPENAI_CRED_ID__', name: 'OpenAI Dental' } } },
      { parameters: { jsCode: parseAnswerJs },
        id: opts.idPrefix + '06', name: 'ParseAnswer', type: 'n8n-nodes-base.code', typeVersion: 2, position: [880, -80] },
      { parameters: { jsCode: fallbackJs },
        id: opts.idPrefix + '07', name: 'Fallback', type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 80] },
    ],
    connections: {
      Webhook: { main: [[{ node: 'Retrieve', type: 'main', index: 0 }]] },
      Retrieve: { main: [[{ node: 'BuildAnswerReq', type: 'main', index: 0 }]] },
      BuildAnswerReq: { main: [[{ node: 'IsGrounded', type: 'main', index: 0 }]] },
      IsGrounded: { main: [[{ node: 'OpenAI', type: 'main', index: 0 }], [{ node: 'Fallback', type: 'main', index: 0 }]] },
      OpenAI: { main: [[{ node: 'ParseAnswer', type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1' },
  });
}

// ---------------- 12_pricing_agent ----------------
buildSubAgentWorkflow({
  fileName: '12_pricing_agent.json', workflowName: '12_pricing_agent', webhookPath: 'agent/pricing',
  idPrefix: 'c1200000-0000-0000-0000-0000000000',
  agentRole: 'Pricing Agent',
  agentRules: 'Quote only prices/ranges/notes explicitly present in the context. If no price is listed for a service, say pricing varies and the clinic can provide an exact quote.',
  typeFilter: ['pricing', 'service'],
});

// ---------------- 13_services_faq_agent ----------------
buildSubAgentWorkflow({
  fileName: '13_services_faq_agent.json', workflowName: '13_services_faq_agent', webhookPath: 'agent/services-faq',
  idPrefix: 'c1300000-0000-0000-0000-0000000000',
  agentRole: 'Services & FAQ Agent',
  agentRules: 'Answer questions about treatments, services offered, and general orthodontic FAQs using only the clinic’s own service names and FAQ answers in the context.',
  typeFilter: ['service', 'faq', 'page'],
});

// ---------------- 14_general_knowledge_agent ----------------
buildSubAgentWorkflow({
  fileName: '14_general_knowledge_agent.json', workflowName: '14_general_knowledge_agent', webhookPath: 'agent/general',
  idPrefix: 'c1400000-0000-0000-0000-0000000000',
  agentRole: 'General Knowledge Agent',
  agentRules: 'Answer questions about the clinic itself: doctors, location, contact info, policies, and about-us content, using only the context provided.',
  typeFilter: ['doctor', 'policy', 'page', 'hours'],
});

// ---------------- 11_booking_agent ----------------
const lookupClinicSql = read('db/queries/lookup_clinic.sql');
const findOpenBookingSql = read('db/queries/find_open_booking.sql');
const insertBookingSql = read('db/queries/insert_booking.sql');
const updateBookingSql = read('db/queries/update_booking.sql');
const prepBookingSession = read('booking/prep_session.js');
const getOrCreateSessionSqlBk = read('db/queries/get_or_create_session.sql');
const buildBookingReq = read('booking/build_extract_req.js');
const parseSlots = read('booking/parse_slots.js');
const formatBookingReply = read('booking/format_reply.js');

writeWf('11_booking_agent.json', {
  name: '11_booking_agent',
  nodes: [
    { parameters: { httpMethod: 'POST', path: 'agent/booking', responseMode: 'lastNode', responseData: 'allEntries', options: {} },
      id: 'c1100000-0000-0000-0000-000000000001', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [-620, 0], webhookId: 'c1100000-0000-0000-0000-000000000001' },
    { parameters: { operation: 'executeQuery', query: lookupClinicSql, options: { queryReplacement: '={{ [$json.body.website_url] }}' } },
      id: 'c1100000-0000-0000-0000-000000000002', name: 'LookupClinic', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [-400, 0], credentials: PG_CRED },
    { parameters: { jsCode: prepBookingSession },
      id: 'c1100000-0000-0000-0000-00000000000b', name: 'PrepBookingSession', type: 'n8n-nodes-base.code', typeVersion: 2, position: [-400, 160] },
    { parameters: { operation: 'executeQuery', query: getOrCreateSessionSqlBk, options: { queryReplacement: '={{ [$json.session_id] }}' } },
      id: 'c1100000-0000-0000-0000-000000000010', name: 'EnsureSession', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [-290, 160], credentials: PG_CRED },
    { parameters: { operation: 'executeQuery', query: findOpenBookingSql, options: { queryReplacement: '={{ [$json.id] }}' } },
      id: 'c1100000-0000-0000-0000-00000000000c', name: 'FindOpenBooking', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [-180, 160], credentials: PG_CRED },
    { parameters: { jsCode: buildBookingReq },
      id: 'c1100000-0000-0000-0000-000000000003', name: 'BuildBookingReq', type: 'n8n-nodes-base.code', typeVersion: 2, position: [40, 80] },
    { parameters: {
        method: 'POST', url: 'https://api.openai.com/v1/chat/completions',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'openAiApi',
        sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.oai_body) }}',
        options: { timeout: 45000 },
      },
      id: 'c1100000-0000-0000-0000-000000000004', name: 'OpenAI', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [260, 80],
      retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
      credentials: { openAiApi: { id: '__OPENAI_CRED_ID__', name: 'OpenAI Dental' } } },
    { parameters: { jsCode: parseSlots },
      id: 'c1100000-0000-0000-0000-000000000005', name: 'ParseSlots', type: 'n8n-nodes-base.code', typeVersion: 2, position: [480, 80] },
    { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ id: 'c1', leftValue: '={{ $json.is_update }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' } },
      id: 'c1100000-0000-0000-0000-00000000000d', name: 'IsUpdate', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [700, 80] },
    { parameters: { operation: 'executeQuery', query: updateBookingSql,
        options: { queryReplacement: '={{ [$json.booking_id, $json.service_name, $json.preferred_date, $json.preferred_time, $json.patient_name, $json.patient_contact, $json.status] }}' } },
      id: 'c1100000-0000-0000-0000-00000000000e', name: 'UpdateBooking', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [920, -20], credentials: PG_CRED },
    { parameters: { operation: 'executeQuery', query: insertBookingSql,
        options: { queryReplacement: '={{ [$json.session_id, $json.clinic_id, $json.service_name, $json.preferred_date, $json.preferred_time, $json.patient_name, $json.patient_contact, $json.status, null] }}' } },
      id: 'c1100000-0000-0000-0000-000000000006', name: 'InsertBooking', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [920, 180], credentials: PG_CRED },
    { parameters: { jsCode: formatBookingReply },
      id: 'c1100000-0000-0000-0000-000000000007', name: 'FormatReply', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1140, 80] },
  ],
  connections: {
    Webhook: { main: [[{ node: 'LookupClinic', type: 'main', index: 0 }, { node: 'PrepBookingSession', type: 'main', index: 0 }]] },
    PrepBookingSession: { main: [[{ node: 'EnsureSession', type: 'main', index: 0 }]] },
    EnsureSession: { main: [[{ node: 'FindOpenBooking', type: 'main', index: 0 }]] },
    FindOpenBooking: { main: [[{ node: 'BuildBookingReq', type: 'main', index: 0 }]] },
    BuildBookingReq: { main: [[{ node: 'OpenAI', type: 'main', index: 0 }]] },
    OpenAI: { main: [[{ node: 'ParseSlots', type: 'main', index: 0 }]] },
    ParseSlots: { main: [[{ node: 'IsUpdate', type: 'main', index: 0 }]] },
    IsUpdate: { main: [[{ node: 'UpdateBooking', type: 'main', index: 0 }], [{ node: 'InsertBooking', type: 'main', index: 0 }]] },
    UpdateBooking: { main: [[{ node: 'FormatReply', type: 'main', index: 0 }]] },
    InsertBooking: { main: [[{ node: 'FormatReply', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
});

// ---------------- 10_orchestrator ----------------
const prepSession = read('orchestrator/prep_session.js');
const getOrCreateSessionSql = read('db/queries/get_or_create_session.sql');
const loadHistorySql = read('db/queries/load_history.sql');
const saveMessageSql = read('db/queries/save_message.sql');
const classifyIntent = read('orchestrator/classify_intent.js');
const routeAndCall = read('orchestrator/route_and_call.js');
const mergeResults = read('orchestrator/merge_results.js');
const buildSynthesisReq = read('orchestrator/build_synthesis_req.js');
const finalizeJs = read('orchestrator/finalize.js');
const prepAssistantMsg = read('orchestrator/prep_assistant_msg.js');
const composeResponse = read('orchestrator/compose_response.js');

writeWf('10_orchestrator.json', {
  name: '10_orchestrator',
  nodes: [
    { parameters: { httpMethod: 'POST', path: 'ask', responseMode: 'lastNode', responseData: 'allEntries', options: { allowedOrigins: '*' } },
      id: 'a0000000-0000-0000-0000-000000000001', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [-1080, 0], webhookId: 'a0000000-0000-0000-0000-000000000001' },
    { parameters: { jsCode: prepSession },
      id: 'a0000000-0000-0000-0000-00000000000b', name: 'PrepSession', type: 'n8n-nodes-base.code', typeVersion: 2, position: [-860, 0] },
    { parameters: { operation: 'executeQuery', query: getOrCreateSessionSql, options: { queryReplacement: '={{ [$json.session_id] }}' } },
      id: 'a0000000-0000-0000-0000-00000000000c', name: 'GetOrCreateSession', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [-640, 0], credentials: PG_CRED },
    { parameters: { operation: 'executeQuery', query: loadHistorySql, options: { queryReplacement: '={{ [$json.id, 8] }}' } },
      id: 'a0000000-0000-0000-0000-00000000000d', name: 'LoadHistory', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [-420, 0], credentials: PG_CRED },
    { parameters: { jsCode: classifyIntent },
      id: 'a0000000-0000-0000-0000-000000000002', name: 'ClassifyIntent', type: 'n8n-nodes-base.code', typeVersion: 2, position: [-200, 0] },
    { parameters: {
        method: 'POST', url: 'https://api.openai.com/v1/chat/completions',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'openAiApi',
        sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.oai_body) }}',
        options: { timeout: 45000 },
      },
      id: 'a0000000-0000-0000-0000-000000000003', name: 'ClassifyOpenAI', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [20, 0],
      retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
      credentials: { openAiApi: { id: '__OPENAI_CRED_ID__', name: 'OpenAI Dental' } } },
    { parameters: { jsCode: routeAndCall },
      id: 'a0000000-0000-0000-0000-000000000004', name: 'RouteAndCall', type: 'n8n-nodes-base.code', typeVersion: 2, position: [240, 0] },
    { parameters: { jsCode: mergeResults },
      id: 'a0000000-0000-0000-0000-000000000005', name: 'MergeResults', type: 'n8n-nodes-base.code', typeVersion: 2, position: [460, 0] },
    { parameters: { jsCode: buildSynthesisReq },
      id: 'a0000000-0000-0000-0000-000000000006', name: 'BuildSynthesisReq', type: 'n8n-nodes-base.code', typeVersion: 2, position: [680, 0] },
    { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ id: 'c1', leftValue: '={{ $json.skip_llm }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' } },
      id: 'a0000000-0000-0000-0000-000000000007', name: 'IsSkipLLM', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [900, 0] },
    { parameters: { jsCode: finalizeJs },
      id: 'a0000000-0000-0000-0000-000000000008', name: 'FinalizeSkip', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1120, 80] },
    { parameters: {
        method: 'POST', url: 'https://api.openai.com/v1/chat/completions',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'openAiApi',
        sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.oai_body) }}',
        options: { timeout: 45000 },
      },
      id: 'a0000000-0000-0000-0000-000000000009', name: 'SynthOpenAI', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1120, -80],
      retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
      credentials: { openAiApi: { id: '__OPENAI_CRED_ID__', name: 'OpenAI Dental' } } },
    { parameters: { jsCode: finalizeJs },
      id: 'a0000000-0000-0000-0000-00000000000a', name: 'FinalizeSynth', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1340, -80] },
    { parameters: { operation: 'executeQuery', query: saveMessageSql,
        options: { queryReplacement: "={{ [$json.session_id, 'user', $json.query, null, null] }}" } },
      id: 'a0000000-0000-0000-0000-00000000000e', name: 'SaveUserMsg', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1560, 0], credentials: PG_CRED },
    { parameters: { jsCode: prepAssistantMsg },
      id: 'a0000000-0000-0000-0000-000000000011', name: 'PrepAssistantMsg', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1780, 0] },
    { parameters: { operation: 'executeQuery', query: saveMessageSql,
        options: { queryReplacement: "={{ [$json.session_id, 'assistant', $json.reply, JSON.stringify($json.intents || []), JSON.stringify($json.sources || [])] }}" } },
      id: 'a0000000-0000-0000-0000-00000000000f', name: 'SaveAssistantMsg', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [2000, 0], credentials: PG_CRED },
    { parameters: { jsCode: composeResponse },
      id: 'a0000000-0000-0000-0000-000000000010', name: 'ComposeResponse', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2220, 0] },
  ],
  connections: {
    Webhook: { main: [[{ node: 'PrepSession', type: 'main', index: 0 }]] },
    PrepSession: { main: [[{ node: 'GetOrCreateSession', type: 'main', index: 0 }]] },
    GetOrCreateSession: { main: [[{ node: 'LoadHistory', type: 'main', index: 0 }]] },
    LoadHistory: { main: [[{ node: 'ClassifyIntent', type: 'main', index: 0 }]] },
    ClassifyIntent: { main: [[{ node: 'ClassifyOpenAI', type: 'main', index: 0 }]] },
    ClassifyOpenAI: { main: [[{ node: 'RouteAndCall', type: 'main', index: 0 }]] },
    RouteAndCall: { main: [[{ node: 'MergeResults', type: 'main', index: 0 }]] },
    MergeResults: { main: [[{ node: 'BuildSynthesisReq', type: 'main', index: 0 }]] },
    BuildSynthesisReq: { main: [[{ node: 'IsSkipLLM', type: 'main', index: 0 }]] },
    IsSkipLLM: { main: [[{ node: 'FinalizeSkip', type: 'main', index: 0 }], [{ node: 'SynthOpenAI', type: 'main', index: 0 }]] },
    SynthOpenAI: { main: [[{ node: 'FinalizeSynth', type: 'main', index: 0 }]] },
    FinalizeSkip: { main: [[{ node: 'SaveUserMsg', type: 'main', index: 0 }]] },
    FinalizeSynth: { main: [[{ node: 'SaveUserMsg', type: 'main', index: 0 }]] },
    SaveUserMsg: { main: [[{ node: 'PrepAssistantMsg', type: 'main', index: 0 }]] },
    PrepAssistantMsg: { main: [[{ node: 'SaveAssistantMsg', type: 'main', index: 0 }]] },
    SaveAssistantMsg: { main: [[{ node: 'ComposeResponse', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
});

// ---------------- 05_voice_ask ----------------
// Binary audio in -> transcribe -> orchestrator -> synthesize -> binary
// audio out. VOICE_BASE_URL points at whichever voice backend is active
// (fallback service by default; swap to voicebox's URL if/when it's up -
// both expose POST /transcribe and POST /speak).
const prepAsk = read('voice/prep_ask.js');
const prepSpeak = read('voice/prep_speak.js');
const VOICE_BASE_URL = 'http://dental-voice:8000';

writeWf('05_voice_ask.json', {
  name: '05_voice_ask',
  nodes: [
    { parameters: { httpMethod: 'POST', path: 'voice/ask', responseMode: 'lastNode', responseData: 'firstEntryBinary', options: {} },
      id: 'd0000000-0000-0000-0000-000000000001', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [-400, 0], webhookId: 'd0000000-0000-0000-0000-000000000001' },
    { parameters: {
        method: 'POST', url: VOICE_BASE_URL + '/transcribe',
        sendBody: true, contentType: 'multipart-form-data',
        bodyParameters: { parameters: [{ parameterType: 'formBinaryData', name: 'file', inputDataFieldName: 'audio' }] },
        options: { timeout: 30000 },
      },
      id: 'd0000000-0000-0000-0000-000000000002', name: 'Transcribe', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [-180, 0] },
    { parameters: { jsCode: prepAsk },
      id: 'd0000000-0000-0000-0000-000000000003', name: 'PrepAsk', type: 'n8n-nodes-base.code', typeVersion: 2, position: [40, 0] },
    { parameters: {
        method: 'POST', url: 'http://localhost:5678/webhook/ask',
        sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json) }}',
        options: { timeout: 90000 },
      },
      id: 'd0000000-0000-0000-0000-000000000004', name: 'AskOrchestrator', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [260, 0] },
    { parameters: { jsCode: prepSpeak },
      id: 'd0000000-0000-0000-0000-000000000005', name: 'PrepSpeak', type: 'n8n-nodes-base.code', typeVersion: 2, position: [480, 0] },
    { parameters: {
        method: 'POST', url: VOICE_BASE_URL + '/speak',
        sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.speak_body) }}',
        options: { timeout: 30000, response: { response: { responseFormat: 'file' } } },
      },
      id: 'd0000000-0000-0000-0000-000000000006', name: 'Speak', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [700, 0] },
  ],
  connections: {
    Webhook: { main: [[{ node: 'Transcribe', type: 'main', index: 0 }]] },
    Transcribe: { main: [[{ node: 'PrepAsk', type: 'main', index: 0 }]] },
    PrepAsk: { main: [[{ node: 'AskOrchestrator', type: 'main', index: 0 }]] },
    AskOrchestrator: { main: [[{ node: 'PrepSpeak', type: 'main', index: 0 }]] },
    PrepSpeak: { main: [[{ node: 'Speak', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
});
