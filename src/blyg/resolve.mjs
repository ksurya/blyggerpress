import { publicUrl } from './fetch.mjs';
import { parseFeed as defaultParseFeed } from './feed-reader.mjs';

function links(html) {
  return [...html.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => {
    const attrs = {};
    for (const m of tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[m[1].toLowerCase()] = (m[2] ?? m[3] ?? m[4]).replace(/&amp;/g, '&');
    return attrs;
  });
}

export async function resolveSubscription(input, { fetchText, parseFeed = defaultParseFeed } = {}) {
  const url = new URL(publicUrl(input));
  url.search = ''; url.hash = '';
  const candidate = new URL(url);
  if (!candidate.pathname.endsWith('/')) candidate.pathname += '/';
  const tried = [], cache = new Map(), budget = { remaining: 6 };
  async function get(target) {
    let key;
    try { key = publicUrl(target); } catch { return null; }
    if (cache.has(key)) return cache.get(key);
    if (tried.length >= 6 || budget.remaining <= 0) return null;
    tried.push(key);
    // Custom ports also obey the logical request cap; safe transport additionally
    // charges each redirect against this same budget.
    const before = budget.remaining;
    let res;
    try { res = await fetchText(key, { budget }); }
    catch (error) { res = { error: error.message, code: error.code }; }
    if (budget.remaining === before) budget.remaining--;
    if (res && !res.finalUrl) res = { ...res, finalUrl: key };
    cache.set(key, res);
    return res;
  }
  async function manifest(target) {
    const res = await get(target);
    if (res?.status !== 200) return null;
    let doc;
    try { doc = JSON.parse(res.body); } catch { return null; }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !Object.hasOwn(doc, 'blyg')) return null;
    const final = new URL(publicUrl(res.finalUrl));
    if (!final.pathname.endsWith('/blyg.json')) return null;
    final.search = ''; final.hash = ''; final.pathname = final.pathname.slice(0, -9);
    const identityOrigin = final.href;
    return { mode: 'blyg', identityOrigin, manifestUrl: res.finalUrl, feedUrl: new URL('feed.xml', identityOrigin).href, title: typeof doc.title === 'string' ? doc.title : identityOrigin, manifest: doc, notices: doc.site && doc.site !== identityOrigin ? [{ type: 'origin-disagreement', asserted: doc.site, actual: identityOrigin }] : [], tried };
  }
  let result = await manifest(new URL('blyg.json', candidate));
  if (result) return result;
  const page = await get(url);
  let feed;
  if (page?.status === 200) { try { feed = parseFeed(page.body, { baseUrl: page.finalUrl }); } catch {} }
  if (feed?.channel.manifest) {
    result = await manifest(new URL(feed.channel.manifest, page.finalUrl));
    if (result) return result;
  }
  const htmlLinks = page?.status === 200 && !feed ? links(page.body) : [];
  const rel = htmlLinks.find(l => l.rel?.toLowerCase().split(/\s+/).includes('blyg') && l.href);
  if (rel) {
    try {
      const base = new URL(rel.href, page.finalUrl);
      base.search = ''; base.hash = '';
      if (!base.pathname.endsWith('/')) base.pathname += '/';
      result = await manifest(new URL('blyg.json', base));
      if (result) return result;
    } catch { /* An invalid advertised URL does not disable conventional probes. */ }
  }
  for (const path of ['/blyg/blyg.json', '/blyg.json']) {
    result = await manifest(new URL(path, url));
    if (result) return result;
  }
  if (!feed) {
    const alt = htmlLinks.find(l => l.rel?.toLowerCase().split(/\s+/).includes('alternate') && ['application/rss+xml', 'application/atom+xml'].includes(l.type?.toLowerCase()) && l.href);
    if (alt) {
      const res = await get(new URL(alt.href, page.finalUrl));
      if (res?.status === 200) { try { feed = parseFeed(res.body, { baseUrl: res.finalUrl }); return { mode: 'legacy', identityOrigin: res.finalUrl, feedUrl: res.finalUrl, title: feed.channel.title, tried }; } catch {} }
    }
  }
  if (feed) return { mode: 'legacy', identityOrigin: page.finalUrl, feedUrl: page.finalUrl, title: feed.channel.title, tried };
  const error = new Error('No blyg or feed found; import a feed file if browser CORS blocks access.');
  error.tried = tried; error.failures = [...cache.values()].filter(r => r?.error);
  throw error;
}
