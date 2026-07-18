// Fetch + clean stage — n8n Code node (Run Once for All Items).
// Input : one item per discovered URL { website_url, url, ... }
// Output: one item per page { website_url, url, status_code, page_type, title, char_count, url_hash, clean_text }
// Sandbox: only this.helpers.httpRequest; no URL/fetch globals. HTML cleaned via regex.

const helpers = this.helpers;
const items = $input.all();
const ua = 'DentalRAGBot/1.0';

function djb2(str) { // stable id for url_hash (no crypto in sandbox)
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return 'h' + h.toString(16);
}
function decodeEntities(t) {
  return t.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
          .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
          .replace(/&apos;/gi, "'").replace(/&[a-z]+;/gi, ' ');
}
function cleanHtml(html) {
  if (!html) return '';
  let t = html;
  t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  t = t.replace(/<\/(p|div|li|h[1-6]|br|tr|section|article)>/gi, '\n'); // keep some structure
  t = t.replace(/<[^>]+>/g, ' ');
  t = decodeEntities(t);
  t = t.replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return t;
}
function extractTitle(html) {
  const m = html && html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1].replace(/\s+/g, ' ')).trim() : '';
}
function classify(url) {
  const u = String(url).toLowerCase();
  if (/contact|location|direction|map/.test(u)) return 'contact';
  if (/faq/.test(u)) return 'faq';
  if (/price|pricing|cost|\bfee|payment|insurance|financ|afford/.test(u)) return 'pricing';
  if (/appointment|consult|request|book/.test(u)) return 'booking';
  if (/about|team|doctor|board-certified|staff|meet|\bbio/.test(u)) return 'about';
  if (/blog|news|article|post/.test(u)) return 'blog';
  if (/service|treatment|braces|invisalign|damon|itero|laser|retainer|aligner|orthodon/.test(u)) return 'service';
  if (/privacy|notice|policy|terms|hipaa/.test(u)) return 'policy';
  return 'general';
}

// One slow/hanging page must not stall the whole run: rely on the request
// library's own `timeout` option (the sandbox has no global setTimeout, so a
// manual Promise.race timer throws synchronously and fails every request).
// Bounded concurrency keeps 46 pages well inside the task-runner ceiling.
async function fetchOne(it) {
  const website_url = it.json.website_url;
  const url = it.json.url;
  if (!url) return null;
  let html = null, status = 0;
  try {
    const res = await helpers.httpRequest({ url, method: 'GET', headers: { 'User-Agent': ua }, json: false, timeout: 25000 });
    html = typeof res === 'string' ? res : String(res);
    status = 200;
  } catch (e) { status = 0; }
  const title = extractTitle(html || '');
  const clean_text = cleanHtml(html || '');
  return {
    json: {
      website_url, url, status_code: status,
      page_type: classify(url), title,
      char_count: clean_text.length,
      url_hash: djb2(url),
      clean_text,
    },
  };
}

const CONCURRENCY = 3;
const out = [];
for (let i = 0; i < items.length; i += CONCURRENCY) {
  const batch = items.slice(i, i + CONCURRENCY);
  const results = await Promise.all(batch.map(fetchOne));
  for (const r of results) if (r) out.push(r);
}
return out;
