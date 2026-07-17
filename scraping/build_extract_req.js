// Build one OpenAI chat-completions request per page (Code node, all items).
// Input : rows from pages_raw { url, page_type, clean_text }
// Output: { url, page_type, oai_body } — oai_body sent by the next HTTP node.
const SYS = [
  "You extract structured dental/orthodontic clinic data from ONE web page's text.",
  "Return ONLY a JSON object with these keys (use [] or null when absent on THIS page):",
  '{',
  '  "clinic": { "name": string|null, "phone": string|null, "email": string|null, "address": string|null, "booking_url": string|null, "about": string|null },',
  '  "services": [ { "name": string, "category": string|null, "description": string|null } ],',
  '  "doctors": [ { "name": string, "title": string|null, "bio": string|null, "specialties": [string] } ],',
  '  "pricing": [ { "service_name": string, "price_min": number|null, "price_max": number|null, "currency": string|null, "unit": string|null, "notes": string|null } ],',
  '  "hours": [ { "day_of_week": 0-6 (0=Sunday), "open_time": "HH:MM"|null, "close_time": "HH:MM"|null, "is_closed": boolean } ],',
  '  "faqs": [ { "question": string, "answer": string, "category": string|null } ],',
  '  "policies": [ { "policy_type": string, "title": string|null, "content": string } ]',
  '}',
  "RULES: Only include facts explicitly stated in the text. NEVER invent prices, hours, phone numbers, or names.",
  "Use the clinic's own service names. Keep descriptions/answers concise (<= 60 words). Omit navigation/boilerplate.",
].join("\n");

return $input.all().map(function (it) {
  const p = it.json;
  const text = String(p.clean_text || '').slice(0, 6000);
  return {
    json: {
      url: p.url,
      page_type: p.page_type,
      oai_body: {
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYS },
          { role: 'user', content: 'URL: ' + p.url + '\nPAGE TYPE: ' + p.page_type + '\n\nPAGE TEXT:\n' + text },
        ],
      },
    },
  };
});
