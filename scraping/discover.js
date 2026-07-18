// Discover stage — n8n Code node (Run Once for All Items).
// Input : { website_url } (webhook body). Output: one item per same-domain page URL.
// NOTE: the n8n JS Task Runner sandbox does NOT expose the global `URL` — all URL
// parsing/joining here is done with plain string ops. Only this.helpers.httpRequest
// is available for HTTP.

try {
  const helpers = this.helpers;
  const input = $input.first().json;
  const body = (input && input.body) ? input.body : (input || {});
  let website = String(body.website_url || (input && input.website_url) || '').trim();
  if (!website) { throw new Error('website_url is required'); }
  if (!/^https?:\/\//i.test(website)) website = 'https://' + website;

  function parseUrl(str) {
    const m = String(str).match(/^(https?:)\/\/([^\/:?#]+)(:\d+)?([^?#]*)/i);
    if (!m) return null;
    const host = m[2];
    return { protocol: m[1], host, port: m[3] || '', path: m[4] || '/', origin: m[1] + '//' + host + (m[3] || '') };
  }
  const startParsed = parseUrl(website);
  if (!startParsed) throw new Error('invalid website_url: ' + website);
  const startUrl = website;
  const origin = startParsed.origin;
  const baseDomain = startParsed.host.replace(/^www\./, '');
  const maxPages = parseInt(body.max_pages || 80, 10);
  const ua = body.user_agent || 'DentalRAGBot/1.0';

  function hostOf(url) { const p = parseUrl(url); return p ? p.host.replace(/^www\./, '') : null; }
  function sameDomain(url) { return hostOf(url) === baseDomain; }
  function resolveUrl(href) {
    href = String(href).trim();
    if (/^https?:\/\//i.test(href)) return href;
    if (/^\/\//.test(href)) return 'https:' + href;
    if (href.charAt(0) === '/') return origin + href;
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) return null;
    return origin + '/' + href.replace(/^\.?\//, '');
  }

  async function fetchText(url) {
    try {
      const res = await helpers.httpRequest({ url, method: 'GET', headers: { 'User-Agent': ua }, json: false, timeout: 12000 });
      return typeof res === 'string' ? res : String(res);
    } catch (e) { return null; }
  }

  const found = new Set();
  const sitemaps = [];

  const robots = await fetchText(origin + '/robots.txt');
  if (robots) {
    for (const line of robots.split(/\r?\n/)) {
      const m = line.match(/^\s*sitemap:\s*(\S+)/i);
      if (m) sitemaps.push(m[1].trim());
    }
  }
  if (sitemaps.length === 0) sitemaps.push(origin + '/sitemap.xml');

  const seen = new Set();
  const queue = sitemaps.slice();
  let walked = 0;
  while (queue.length && walked < 25 && found.size < maxPages) {
    const sm = queue.shift();
    if (seen.has(sm)) continue;
    seen.add(sm); walked++;
    const xml = await fetchText(sm);
    if (!xml) continue;
    const locs = (xml.match(/<loc>\s*[^<\s]+\s*<\/loc>/gi) || []).map(function (t) {
      return t.replace(/<\/?loc>/gi, '').trim();
    });
    for (const loc of locs) {
      if (/\.xml(\?|$)/i.test(loc)) queue.push(loc);
      else if (sameDomain(loc)) found.add(loc.split('#')[0]);
      if (found.size >= maxPages) break;
    }
  }

  let discovery = 'sitemap';
  if (found.size === 0) {
    discovery = 'crawl';
    found.add(startUrl);
    const html = await fetchText(startUrl);
    if (html) {
      const hrefs = (html.match(/href=["'][^"']+["']/gi) || []).map(function (h) {
        return h.replace(/^href=["']/i, '').replace(/["']$/, '');
      });
      for (let href of hrefs) {
        const abs = resolveUrl(href);
        if (abs && sameDomain(abs) && !/\.(png|jpe?g|gif|svg|pdf|zip|css|js|ico|woff2?|mp4|webp)(\?|$)/i.test(abs)) {
          found.add(abs.split('#')[0]);
        }
        if (found.size >= maxPages) break;
      }
    }
  }

  const urls = Array.from(found).slice(0, maxPages);
  return urls.map(function (url) {
    return { json: { website_url: startUrl, origin, base_domain: baseDomain, discovery, url } };
  });
} catch (err) {
  return [{ json: { __discover_error: String((err && err.message) || err) } }];
}
