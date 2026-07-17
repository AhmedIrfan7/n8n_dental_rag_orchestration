// Prepare stage — n8n Code node (Run Once for All Items).
// Collapses all cleaned page items into ONE item carrying a JSON array, so the
// DB write is a single bulk insert with just two bound params (website_url + JSON).
const items = $input.all();
const website_url = items.length ? items[0].json.website_url : '';
const pages = items.map(function (it) {
  return {
    url: it.json.url,
    url_hash: it.json.url_hash,
    page_type: it.json.page_type,
    title: it.json.title || '',
    clean_text: it.json.clean_text || '',
    status_code: it.json.status_code || 0,
  };
});
return [{ json: { website_url, page_count: pages.length, pages_json: JSON.stringify(pages) } }];
