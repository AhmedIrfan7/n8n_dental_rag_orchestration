// Validate session_id shape before it reaches a Postgres ::uuid cast
// (an invalid cast throws). Runs right after Webhook.
const webhookJson = $input.first().json;
const body = webhookJson.body || webhookJson || {};
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const session_id = (typeof body.session_id === 'string' && uuidRe.test(body.session_id)) ? body.session_id : null;
return [{ json: { session_id } }];
