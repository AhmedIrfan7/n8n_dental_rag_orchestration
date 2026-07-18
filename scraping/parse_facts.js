// Parse + aggregate extraction (Code node, all items).
// Input : OpenAI responses (one per page), aligned by index with BuildExtractReq items.
// Output: ONE item with deduped entity arrays as JSON strings, ready for bulk store.
const responses = $input.all();
const reqs = $('BuildExtractReq').all();
const website_url = $('Webhook').first().json.body.website_url;

const clinic = { name: null, phone: null, email: null, address: null, booking_url: null, about: null };
const services = [], doctors = [], pricing = [], hours = [], faqs = [], policies = [];

function mergeClinic(c) { if (!c) return; for (const k in clinic) if (!clinic[k] && c[k]) clinic[k] = c[k]; }

for (let i = 0; i < responses.length; i++) {
  let data = null;
  try { data = JSON.parse(responses[i].json.choices[0].message.content); } catch (e) { continue; }
  const src = reqs[i] ? reqs[i].json.url : null;
  mergeClinic(data.clinic);
  (data.services || []).forEach(s => { if (s && s.name) services.push({ name: String(s.name).slice(0,200), category: s.category || null, description: s.description || null, source_url: src }); });
  (data.doctors || []).forEach(d => { if (d && d.name) doctors.push({ name: String(d.name).slice(0,200), title: d.title || null, bio: d.bio || null, specialties: Array.isArray(d.specialties) ? d.specialties : [], source_url: src }); });
  (data.pricing || []).forEach(p => { if (p && p.service_name) pricing.push({ service_name: String(p.service_name).slice(0,200), price_min: (p.price_min ?? null), price_max: (p.price_max ?? null), currency: p.currency || 'USD', unit: p.unit || null, notes: p.notes || null, source_url: src }); });
  (data.hours || []).forEach(h => { if (h && typeof h.day_of_week === 'number') hours.push({ day_of_week: h.day_of_week, open_time: h.open_time || null, close_time: h.close_time || null, is_closed: !!h.is_closed }); });
  (data.faqs || []).forEach(f => { if (f && f.question && f.answer) faqs.push({ question: String(f.question).slice(0,500), answer: String(f.answer).slice(0,2000), category: f.category || null, source_url: src }); });
  (data.policies || []).forEach(p => { if (p && p.content) policies.push({ policy_type: p.policy_type || 'general', title: p.title || null, content: String(p.content).slice(0,3000), source_url: src }); });
}

// Exact-match dedup after normalizing punctuation (catches "Invisalign" vs
// "Invisalign®", trailing periods, curly quotes, etc). Deliberately does NOT
// do fuzzy/subset matching here - two service names sharing a word ("Braces"
// vs "Clear Braces") are often genuinely different services, unlike a
// person's name (see dedupeNames below).
function normPunct(s) { return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim(); }
function dedupe(arr, key) {
  const seen = {}, out = [];
  for (const x of arr) { const k = normPunct(x[key]); if (k && !seen[k]) { seen[k] = 1; out.push(x); } }
  return out;
}

// Name-aware dedup for people: strips "Dr."/"Dr"/"Doctor" and punctuation,
// then merges any variant whose remaining words are a SUBSET of a longer
// variant's words - "Dr deRoode" and "Dr. deRoode" both collapse into
// "Dr. Elaine deRoode" (the most complete name seen), rather than being
// stored as 2-3 separate "different" doctors. The most-complete variant's
// name is kept as canonical; any field (title/bio/specialties) missing from
// it is backfilled from the shorter variants that do have it.
function normNameWords(s) {
  return String(s || '')
    .replace(/\b(dr\.?|doctor)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}
function dedupeNames(arr, key) {
  const withWords = arr.map(x => ({ x, words: normNameWords(x[key]) })).filter(w => w.words.length);
  withWords.sort((a, b) => b.words.length - a.words.length); // most complete name first
  const canon = [];
  for (const { x, words } of withWords) {
    const match = canon.find(c => words.every(w => c.wordSet.has(w)));
    if (match) {
      for (const field in x) {
        const v = x[field];
        const cur = match.merged[field];
        const isEmpty = cur == null || cur === '' || (Array.isArray(cur) && cur.length === 0);
        if (isEmpty && v) match.merged[field] = v;
      }
    } else {
      canon.push({ wordSet: new Set(words), merged: Object.assign({}, x) });
    }
  }
  return canon.map(c => c.merged);
}
const S = dedupe(services, 'name');
const D = dedupeNames(doctors, 'name');
const F = dedupe(faqs, 'question');
const hmap = {}; hours.forEach(h => { hmap[h.day_of_week] = h; }); const H = Object.keys(hmap).map(k => hmap[k]);

return [{
  json: {
    website_url,
    counts: { services: S.length, doctors: D.length, pricing: pricing.length, hours: H.length, faqs: F.length, policies: policies.length },
    clinic_json: JSON.stringify(clinic),
    services_json: JSON.stringify(S),
    doctors_json: JSON.stringify(D),
    pricing_json: JSON.stringify(pricing),
    hours_json: JSON.stringify(H),
    faqs_json: JSON.stringify(F),
    policies_json: JSON.stringify(policies),
  },
}];
