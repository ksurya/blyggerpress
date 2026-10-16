// Page chrome never becomes protocol content. content_html is the sanitized,
// absolute-URL, fully baked rendering supplied by the composition layer (SUK-141).
import { escapeMarkup as e, feedTitle } from './feed.mjs';

export function renderPage({ origin, title, body, page = '', json = 'blyg.json' }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(title)}</title>
<link rel="canonical" href="${e(new URL(page, origin).href)}">
<link rel="alternate" type="application/json" href="${e(new URL(json, origin).href)}">
<link rel="alternate" type="application/rss+xml" href="${e(new URL('feed.xml', origin).href)}">
<link rel="blyg" href="${e(new URL('blyg.json', origin).href)}">
<style>body{max-width:42rem;margin:3rem auto;padding:0 1rem;font:1.1rem/1.65 Georgia,serif;color:#222;background:#fff}a{color:#174c7a}img,video{max-width:100%;height:auto}pre{overflow:auto}blockquote{margin-left:0;padding-left:1rem;border-left:2px solid #aaa}article{margin:2rem 0}small,time{color:#555}nav{border-bottom:1px solid #ccc;padding-bottom:1rem}h1{font-size:1.6rem}</style>
</head><body><nav><a href="${e(origin)}">Home</a> · <a href="${e(new URL('archive/', origin).href)}">Archive</a> · <a href="${e(new URL('feed.xml', origin).href)}">RSS</a></nav><main>${body}</main></body></html>\n`;
}

export function renderItem(doc, { origin, pin = false }) {
  const page = pin ? `${doc.page}v${doc.version}/` : doc.page;
  const json = pin ? `items/${doc.id}/v${doc.version}.json` : `items/${doc.id}.json`;
  return renderPage({ origin, title: feedTitle(doc), page, json, body: `<article><p><small>${e(doc.kind)} · v${doc.version} · <time>${e(doc.at ?? doc.updated)}</time>${pin ? ' · Pinned version' : ''}</small></p>${typeof doc.author?.name === 'string' ? `<p>${e(doc.author.name)}</p>` : ''}${doc.kind === 'withdrawn' ? '<p>withdrawn</p>' : doc.content_html}<p><a href="${e(new URL(json, origin).href)}">Item JSON</a></p></article>` });
}

export function renderArchive({ origin, title, documents }) {
  const body = `<h1>${e(title)}</h1><ol>${documents.map(d => `<li><a href="${e(new URL(d.page, origin).href)}">${e(feedTitle(d))}</a> <small>${e(d.updated)} · ${e(d.kind)}</small></li>`).join('\n')}</ol>`;
  return { home: renderPage({ origin, title, body }), archive: renderPage({ origin, title: `${title} — Archive`, body, page:'archive/', json:'items/index.json' }) };
}
