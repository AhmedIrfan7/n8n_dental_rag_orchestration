// Validate the incoming request (Code node, first after Webhook).
// A malformed/absent session_id must never reach a Postgres ::uuid cast
// (that throws), so validate the shape here and null it out otherwise.
const body = $input.first().json.body || $input.first().json || {};
const query = String(body.query || '').trim();
if (!query) throw new Error('query is required');

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const raw = body.session_id;
const session_id = (typeof raw === 'string' && uuidRe.test(raw)) ? raw : null;

return [{ json: { query, website_url: body.website_url, session_id } }];
