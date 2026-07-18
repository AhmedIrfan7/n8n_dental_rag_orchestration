// Eval runner - drives tests/eval/qa.jsonl against the live orchestrator
// (POST /webhook/ask) and scores correctness/grounding/latency.
// Usage: node scripts/run_eval.js [--base http://localhost:5679]
const fs = require('fs');
const path = require('path');
const http = require('http');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const baseIdx = args.indexOf('--base');
const BASE = baseIdx !== -1 ? args[baseIdx + 1] : 'http://localhost:5679';

// Every webhook now requires X-Webhook-Key (see docs/N8N_CONTROL.md) -
// read the real secret straight from .env since this runs on the host.
function loadWebhookKey() {
  try {
    const envText = fs.readFileSync(path.join(root, '.env'), 'utf8');
    const m = envText.match(/^N8N_WEBHOOK_API_KEY=(.*)$/m);
    return m ? m[1].trim() : '';
  } catch (e) { return ''; }
}
const WEBHOOK_KEY = loadWebhookKey();

function postJson(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'X-Webhook-Key': WEBHOOK_KEY },
      timeout: timeoutMs || 90000,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          let parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) parsed = parsed[0] || {};
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) { resolve({ status: res.statusCode, body: null, raw }); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function loadCases() {
  const raw = fs.readFileSync(path.join(root, 'tests/eval/qa.jsonl'), 'utf8');
  return raw.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

function containsAny(haystack, needles) {
  const h = haystack.toLowerCase();
  return needles.some((n) => h.includes(n.toLowerCase()));
}
function containsAll(haystack, needles) {
  const h = haystack.toLowerCase();
  return needles.every((n) => h.includes(n.toLowerCase()));
}

async function runCase(c) {
  const t0 = Date.now();
  const session_id = uuid();
  let res;
  try {
    res = await postJson(BASE + '/webhook/ask', {
      query: c.query, website_url: 'https://www.deroodeortho.com/', session_id,
    });
  } catch (e) {
    return { id: c.id, category: c.category, pass: false, latency_ms: Date.now() - t0, error: String(e.message || e), reply: null };
  }
  const latency_ms = Date.now() - t0;
  const b = res.body || {};
  const reply = b.reply || '';
  const grounded = !!b.grounded;
  const routed = b.routed || [];

  const failures = [];
  if (c.expect_grounded === true && !grounded) failures.push('expected grounded=true, got false');
  if (c.expect_grounded === false && grounded) failures.push('expected grounded=false, got true');
  if (c.expect_keywords && c.expect_keywords.length && !containsAny(reply, c.expect_keywords)) {
    failures.push(`expected one of [${c.expect_keywords.join(', ')}] in reply`);
  }
  if (c.forbid_keywords && c.forbid_keywords.length && containsAny(reply, c.forbid_keywords)) {
    failures.push(`forbidden keyword found from [${c.forbid_keywords.join(', ')}]`);
  }
  if (c.expect_routed_includes && routed.indexOf(c.expect_routed_includes) === -1) {
    failures.push(`expected routed to include '${c.expect_routed_includes}', got [${routed.join(', ')}]`);
  }

  return {
    id: c.id, category: c.category, pass: failures.length === 0,
    failures, latency_ms, grounded, routed, reply, note: c.note,
  };
}

async function main() {
  const cases = loadCases();
  console.log(`Running ${cases.length} eval cases against ${BASE} ...\n`);
  const results = [];
  for (const c of cases) {
    process.stdout.write(`  ${c.id} ... `);
    const r = await runCase(c);
    results.push(r);
    console.log(r.pass ? `PASS (${r.latency_ms}ms)` : `FAIL (${r.latency_ms}ms) - ${(r.failures || [r.error]).join('; ')}`);
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  const avgLatency = Math.round(results.reduce((s, r) => s + r.latency_ms, 0) / results.length);
  const byCategory = {};
  for (const r of results) {
    byCategory[r.category] = byCategory[r.category] || { pass: 0, total: 0 };
    byCategory[r.category].total++;
    if (r.pass) byCategory[r.category].pass++;
  }

  console.log(`\n${passed}/${results.length} passed, avg latency ${avgLatency}ms\n`);

  const outPath = path.join(root, 'tests/eval/results.json');
  fs.writeFileSync(outPath, JSON.stringify({ ran_at: new Date().toISOString(), base: BASE, passed, failed, avg_latency_ms: avgLatency, byCategory, results }, null, 2));
  console.log('Wrote ' + outPath);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
