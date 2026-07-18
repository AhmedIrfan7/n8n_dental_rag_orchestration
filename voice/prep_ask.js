// Build the orchestrator request from the transcript (Code node).
// Input : Transcribe's HTTP response { text, duration }.
// session_id/website_url come from the ORIGINAL webhook call (multipart
// form fields), read via named reference since Transcribe sits between.
const transcript = $input.first().json;
const webhookJson = $('Webhook').first().json;
const body = webhookJson.body || {};

const query = (transcript.text || '').trim();
if (!query) throw new Error('transcription produced no text');

return [{
  json: {
    query,
    session_id: body.session_id || null,
    website_url: body.website_url,
  },
}];
