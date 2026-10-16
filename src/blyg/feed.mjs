// RSS is a notification plane: event identity, latest item content.
import { publishEvents } from './publication.mjs';
import { buildItemDocument } from './item.mjs';

export const escapeMarkup = (value) => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const tag = (name, value) => `<${name}>${escapeMarkup(value)}</${name}>`;
const cdata = value => `<![CDATA[${value.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;

export function feedTitle(doc, note = null) {
  if (doc.kind === 'withdrawn') return 'withdrawn';
  const text = doc.content_md.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_`>~]/g, '').replace(/\s+/g, ' ').trim();
  const excerpt = text.length > 80 ? text.slice(0, 79) + '…' : text;
  return note ? `${note} — ${excerpt}` : excerpt;
}

export function buildFeed({ origin, title, updated, items, window = 50 }) {
  if (!Number.isSafeInteger(window) || window < 1) throw new Error('feed window must be a positive integer');
  const events = items.flatMap(item => {
    const doc = buildItemDocument(item);
    return publishEvents(item).map(event => ({ event, doc }));
  })
    .sort((a,b) => Date.parse(b.event.at) - Date.parse(a.event.at) || a.event.id.localeCompare(b.event.id) || b.event.version - a.event.version).slice(0, window);
  const entries = events.map(({event:e, doc:d}) => `<item>
<guid isPermaLink="false">blyg:${d.id}:v${e.version}</guid>
${tag('link', new URL(d.page, origin).href)}
${tag('title', feedTitle(d, e.note))}
<description>${cdata(d.content_html)}</description>
${tag('pubDate', new Date(e.at).toUTCString())}
${tag('blyg:id', d.id)}${tag('blyg:kind', d.kind)}${tag('blyg:version', e.version)}
${tag('blyg:created', d.created)}${tag('blyg:item', new URL(`items/${d.id}.json`, origin).href)}
${e.note === null ? '' : tag('blyg:note', e.note)}${e.generated ? tag('blyg:generated', 'true') : ''}
${typeof d.author?.name === 'string' ? tag('dc:creator', d.author.name) : ''}
</item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:blyg="https://blygger.org/ns/0.1" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>${tag('title', title)}${tag('link', origin)}${tag('description', title)}${tag('lastBuildDate', new Date(updated).toUTCString())}${tag('blyg:manifest', new URL('blyg.json', origin).href)}
${entries}
</channel></rss>\n`;
}
