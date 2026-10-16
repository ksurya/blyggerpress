// §5.6: flatten the pinned document's bake, never resolve inherited composition.
import { absoluteHtmlUrls } from './markdown.mjs';
import { isValidId } from './ids.mjs';
import { isCited } from './item.mjs';
import { compositionInternals as dom, CompositionError } from './compose.mjs';
import { originKey } from './primitives.mjs';

const plain = s => s.replace(/([\\`*_[\]<>])/g, '\\$1');
const quote = s => s.trim().split('\n').map(line => `> ${line}`).join('\n');
function descendants(node, test) {
  return dom.children(node).flatMap(n => [ ...(test(n) ? [n] : []), ...descendants(n, test) ]);
}

export function forkPinnedDocument(pin, { cited, pageForQuote } = {}) {
  if (!pin?.pinned || pin.kind === 'withdrawn' || !isValidId(pin.id) || !Number.isInteger(pin.version) || pin.version < 1 || !pin.origin || typeof pin.content_md !== 'string' || typeof pin.content_html !== 'string') {
    throw new CompositionError('a fork requires a local pinned document');
  }
  if (cited !== undefined && !isCited(cited)) throw new CompositionError('invalid frozen citation');
  const root = dom.parseFragment(absoluteHtmlUrls(pin.content_html, pin.origin));
  function convert(node, contextOrigin) {
    if (node.nodeName === '#text') return plain(node.value);
    const a = dom.attrs(node);
    const remote = a['data-blyg-origin'] ?? contextOrigin;
    const body = dom.children(node).map(n => convert(n, remote)).join('');
    let text;
    switch (node.tagName) {
      case 'p': case 'div': text = `${body.trim()}\n\n`; break;
      case 'br': text = '\n'; break;
      case 'strong': case 'b': text = `**${body}**`; break;
      case 'em': case 'i': text = `*${body}*`; break;
      case 'a': text = `[${body}](${a.href ?? ''})`; break;
      case 'img': text = `![${plain(a.alt ?? '')}](${a.src ?? ''})`; break;
      case 'code': text = `\`\`${body}\`\``; break;
      case 'pre': text = `\n\n${quote(body)}\n\n`; break;
      case 'li': text = `- ${body.trim()}\n`; break;
      case 'blockquote': {
        text = `${quote(body)}\n\n`;
        if (dom.hasClass(node, 'blyg-transclusion')) {
          const id = a['data-blyg-id'];
          const url = pageForQuote?.({ origin: remote, id, version: Number(a['data-blyg-version']) }) ?? new URL(`items/${id}.json`, remote).href;
          text += `[${plain(remote)} ${id}](${url})\n\n`;
        }
        break;
      }
      default: text = body;
    }
    return text;
  }
  const topQuotes = [];
  function collect(node, inside = false) {
    const isQuote = dom.hasClass(node, 'blyg-transclusion');
    if (isQuote && !inside) topQuotes.push(node);
    for (const n of dom.children(node)) collect(n, inside || isQuote);
  }
  collect(root);
  const md = dom.markdown({ reader: true });
  const tokens = md.parse(pin.content_md, {});
  const lines = pin.content_md.split('\n');
  const edits = [];
  let index = 0;
  for (const token of tokens) {
    if (token.type !== 'blyg') continue;
    const node = topQuotes[index++];
    if (!node) throw new CompositionError('pinned directive has no matching baked quote');
    const partial = dom.hasClass(node, 'blyg-partial');
    // Older clients' attached quote lines are prose unless the bake says partial.
    const line = lines[token.meta.start];
    const prefix = line.slice(0, line.indexOf('![['));
    // Keep enclosing quotes/lists when replacing a directive's entire line.
    // A list marker belongs on the first line; later lines use its indentation.
    const continuation = prefix.replace(/(?:[-+*]|[0-9]+[.)])\s+/g, marker => ' '.repeat(marker.length));
    const flattenedQuote = convert(node, pin.origin).trimEnd().split('\n')
      .map((text, i) => (i === 0 ? prefix : continuation) + text).join('\n');
    edits.push({ start: token.meta.start, end: partial ? token.meta.end : token.meta.start + 1,
      text: flattenedQuote });
  }
  if (index !== topQuotes.length) throw new CompositionError('pinned quote/directive mismatch');
  // The pinned renderer controls anchor labels. Correlate authored links in
  // document order, excluding anchors inside baked quotes; never assume the
  // label is the id or recompute a target's present-day page.
  const links = [];
  function collectLinks(n) {
    if (dom.hasClass(n, 'blyg-transclusion')) return;
    if (n.tagName === 'a') links.push(n);
    for (const c of dom.children(n)) collectLinks(c);
  }
  collectLinks(root);
  const protectedLines = new Set();
  for (const t of tokens) if (['fence', 'code_block', 'blyg'].includes(t.type)) {
    // For an older full bake, following quote lines remain authored prose.
    const stop = t.type === 'blyg' && !dom.hasClass(topQuotes[tokens.filter(x => x.type === 'blyg').indexOf(t)], 'blyg-partial')
      ? t.map[0] + 1 : t.map[1];
    for (let i = t.map[0]; i < stop; i++) protectedLines.add(i);
  }
  const masked = lines.map((line, i) => protectedLines.has(i) ? ' '.repeat(line.length) : line).join('\n');
  const inline = md.parseInline(masked, {})[0].children;
  let anchorIndex = 0;
  const replacements = [];
  for (const t of inline) {
    if (t.type === 'link_open') { anchorIndex++; continue; }
    if (t.type !== 'blyg_link') continue;
    const anchor = links[anchorIndex++];
    if (!anchor) throw new CompositionError(`pinned link has no baked anchor: ${t.meta.id}`);
    replacements.push({ start: t.meta.offset, end: t.meta.offset + t.content.length,
      text: `[${t.meta.id}](${dom.attrs(anchor).href})` });
  }
  const offsets = [0];
  for (const line of lines) offsets.push(offsets.at(-1) + line.length + 1);
  const sourceEdits = [...replacements, ...edits.map(e => ({
    start: offsets[e.start], end: e.end < lines.length ? offsets[e.end] : pin.content_md.length,
    text: e.text + (e.end < lines.length ? '\n' : ''),
  }))].sort((a, b) => b.start - a.start);
  let flattened = pin.content_md;
  for (const e of sourceEdits) flattened = flattened.slice(0, e.start) + e.text + flattened.slice(e.end);
  const contentMd = flattened;
  // Keep the pinned disclosure's exact span boundaries in HTML. Flattening
  // changes custody, not which words were disclosed as generated.
  const generated = [];
  let ownGeneratedIndex = 0;
  function collectGeneration(node, insideQuote = false) {
    const quoted = insideQuote || dom.hasClass(node, 'blyg-transclusion');
    if (dom.hasClass(node, 'blyg-tk-gen')) {
      // The source JSON describes its own spans; it does not map models onto
      // generated spans nested inside somebody else's baked quotation.
      const metadata = quoted ? undefined : pin.generated?.[ownGeneratedIndex++];
      generated.push({ sources: [], ...(metadata?.model ? { model: metadata.model } : {}) });
    }
    for (const child of dom.children(node)) collectGeneration(child, quoted);
  }
  collectGeneration(root);
  function flattenHtml(node, contextOrigin) {
    const a = dom.attrs(node);
    const quoteOrigin = a['data-blyg-origin'] ?? contextOrigin;
    for (const child of [...dom.children(node)]) flattenHtml(child, quoteOrigin);
    if (!dom.hasClass(node, 'blyg-transclusion')) return;
    const id = a['data-blyg-id'];
    const url = pageForQuote?.({ origin: quoteOrigin, id, version: Number(a['data-blyg-version']) }) ?? new URL(`items/${id}.json`, quoteOrigin).href;
    node.attrs = node.attrs.filter(attr => !attr.name.startsWith('data-blyg-')).map(attr =>
      attr.name === 'class' ? { ...attr, value: attr.value.split(/\s+/).filter(c => !['blyg-transclusion', 'blyg-partial'].includes(c)).join(' ') } : attr
    ).filter(attr => attr.name !== 'class' || attr.value);
    const attribution = dom.parseFragment('<p><a></a></p>').childNodes[0];
    const anchor = attribution.childNodes[0];
    anchor.attrs = [{ name: 'href', value: url }];
    anchor.childNodes = [{ nodeName: '#text', value: `${quoteOrigin} ${id}`, parentNode: anchor }];
    attribution.parentNode = node.parentNode;
    const siblings = node.parentNode.childNodes;
    siblings.splice(siblings.indexOf(node) + 1, 0, attribution);
  }
  flattenHtml(root, pin.origin);
  const html = dom.serialize(root);
  const forkedFrom = { origin: originKey(pin.origin), id: pin.id, version: pin.version, ...(cited ? { cited: structuredClone(cited) } : {}) };
  return { kind: pin.kind, contentMd, contentHtml: html,
    ...(pin.kind === 'thread' ? { transclusions: [] } : {}), forkedFrom, ...(generated?.length ? { generated } : {}) };
}

/** Optional conditional pin check. Host failure is a warning, never a veto. */
export async function checkForkPin(reference, { fetchPinned } = {}) {
  try {
    const response = await fetchPinned(reference);
    if (response.status >= 500) return { warning: 'pin-host-unavailable' };
    if (response.status === 304) return { valid: true };
    const d = response.doc;
    if (response.status >= 400 || (response.status === 200 && (!d?.pinned || d.id !== reference.id || d.version !== reference.version))) {
      throw new CompositionError('origin no longer serves the named pin');
    }
    return response.status === 200 ? { valid: true } : { warning: 'pin-check-inconclusive' };
  } catch (error) {
    if (error instanceof CompositionError) throw error;
    return { warning: 'pin-host-unavailable' };
  }
}
