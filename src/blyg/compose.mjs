// Publish-time composition. All inputs are local snapshots; this module has no I/O.
import MarkdownIt from 'markdown-it';
import { absoluteHtmlUrls } from './markdown.mjs';
import { parseFragment, serialize } from 'parse5';
import { buildItemDocument, isStubOf, isGeneratedSpan, isCited } from './item.mjs';
import { originKey, escapeHtml, escapeAttr } from './primitives.mjs';

const ID = '[0-9abcdefghjkmnpqrstvwxyz]{26}';
const directive = new RegExp(`^\\s*!\\[\\[(${ID})\\]\\]\\s*$`);
export class CompositionError extends Error {
  constructor(message) { super(message); this.name = 'CompositionError'; }
}
const fail = message => { throw new CompositionError(message); };
const attrs = node => Object.fromEntries((node.attrs ?? []).map(a => [a.name, a.value]));
const hasClass = (node, cls) => (attrs(node).class ?? '').split(/\s+/).includes(cls);
const children = node => node.childNodes ?? [];
const blocks = new Set(['p', 'div', 'blockquote', 'li', 'ul', 'ol', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'section', 'article']);

/** §10.2 text content: decoded entities, collapsed inline space, block line breaks. */
export function compositionText(html) {
  function walk(n) {
    if (n.nodeName === '#text') return n.value.replace(/\s+/g, ' ');
    if (n.tagName === 'br') return '\n';
    const s = children(n).map(walk).join('');
    return blocks.has(n.tagName) ? `\n${s}\n` : s;
  }
  return walk(parseFragment(html)).split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

export function itemPage(snapshot) {
  return new URL(snapshot.page ?? `${snapshot.kind === 'thread' ? 't' : 'f'}/${snapshot.id}/`, snapshot.origin).href;
}

function localDoc(item) { return item.versions ? buildItemDocument(item) : item; }
function importedDoc(row) {
  const retained = row.kind === 'withdrawn';
  const s = retained ? row.pinnedSnapshot : row;
  if (!s) return null;
  return { ...s, origin: row.origin, id: row.id, kind: retained ? (s.kind ?? 'fragment') : row.kind,
    version: retained ? row.retainedPinnedVersion : row.version,
    content_html: s.content_html ?? s.contentHtml ?? '', content_md: s.content_md ?? s.contentMd ?? '',
    author: s.author ?? row.author, page: s.page ?? row.page, transclusions: s.transclusions ?? [],
    generated: s.generated, retained };
}

export function createCompositionResolver({ origin, local = [], imported = [] }) {
  const own = originKey(origin);
  const docs = local.map(localDoc);
  function resolve(id) {
    const here = docs.find(d => d.id === id && d.kind !== 'withdrawn' && d.version >= 1);
    if (here) return structuredClone({ ...here, origin: own });
    const matches = imported.filter(r => r.id === id && !r.l0 && !r.dropped &&
      (r.kind === 'fragment' || r.kind === 'thread' || (r.kind === 'withdrawn' && r.retainedPinnedVersion != null)));
    if (matches.length > 1) fail(`ambiguous imported id ${id}`);
    const doc = matches.length ? importedDoc(matches[0]) : null;
    if (!doc) fail(`unresolvable item ${id}`);
    return structuredClone(doc);
  }
  function checkClosure(target, publishingId, visited = new Set()) {
    if (originKey(target.origin) !== own) return;
    if (target.id === publishingId) fail(`local transclusion cycle through ${publishingId}`);
    if (visited.has(target.id)) return;
    visited.add(target.id);
    for (const ref of target.transclusions ?? []) {
      if (ref.origin && originKey(ref.origin) !== own) continue;
      if (ref.id === publishingId) fail(`local transclusion cycle through ${publishingId}`);
      const next = docs.find(d => d.id === ref.id);
      if (next) checkClosure(next, publishingId, visited);
    }
  }
  return { resolve, checkClosure };
}

function markdown({ onDirective, onLink, reader = false } = {}) {
  const md = new MarkdownIt({ html: false });
  md.block.ruler.before('paragraph', 'blyg', (state, line, end, silent) => {
    if (state.sCount[line] - state.blkIndent >= 4) return false;
    const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
    const match = directive.exec(text);
    if (!match) return false;
    if (silent) return true;
    const token = state.push('blyg', '', 0);
    token.meta = { id: match[1], start: line, end: line + 1 };
    token.map = [line, line + 1];
    let next = line + 1;
    if (next < end) {
      const following = state.src.slice(state.bMarks[next] + state.tShift[next], state.eMarks[next]);
      if (/^>/.test(following)) {
        const tailLines = [];
        for (let n = next; n < end; n++) tailLines.push(state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]));
        // Let the Markdown parser determine the complete blockquote, including
        // lazy continuation lines and multiple quoted paragraphs.
        const quote = new MarkdownIt({ html: false }).parse(tailLines.join('\n'), {})[0];
        const count = quote.map[1];
        token.meta.selectionMd = tailLines.slice(0, count).join('\n');
        next += count; token.meta.end = next; token.map[1] = next;
      }
    }
    state.line = next;
    return true;
  }, { alt: ['paragraph', 'blockquote', 'list'] });
  md.inline.ruler.before('link', 'blyg_link', (state, silent) => {
    const rest = state.src.slice(state.pos);
    const reserved = new RegExp(`^!\\[\\[${ID}@v[0-9]+\\]\\]`).exec(rest);
    if (reserved) {
      if (!reader) fail('explicit-version directives are reserved');
      if (!silent) state.push('blyg_reserved', '', 0).content = reserved[0];
      state.pos += reserved[0].length; return true;
    }
    // Inline directive-looking sequences remain literal, never plain links.
    const inert = new RegExp(`^!\\[\\[${ID}\\]\\]`).exec(rest);
    if (inert) { if (!silent) state.push('text', '', 0).content = inert[0]; state.pos += inert[0].length; return true; }
    const m = new RegExp(`^\\[\\[(${ID})\\]\\]`).exec(rest);
    if (!m) return false;
    if (!silent) {
      const token = state.push('blyg_link', '', 0); token.meta = { id: m[1], offset: state.pos }; token.content = m[0];
    }
    state.pos += m[0].length; return true;
  });
  md.renderer.rules.blyg_reserved = (tokens, i) => escapeHtml(tokens[i].content);
  md.renderer.rules.blyg = (tokens, i) => onDirective ? onDirective(tokens[i].meta) : escapeHtml(`![[${tokens[i].meta.id}]]`);
  md.renderer.rules.blyg_link = (tokens, i) => onLink ? onLink(tokens[i].meta) : escapeHtml(tokens[i].content);
  return md;
}

/** Detect active authoring constructs without resolving anything (code stays inert). */
export function hasCompositionSyntax(contentMd) {
  const tokens = markdown({ reader: true }).parse(contentMd, {});
  return tokens.some(t => t.type === 'blyg' || t.children?.some(c => ['blyg_link', 'blyg_reserved'].includes(c.type)));
}

/** generatedSpans are private UTF-16 offsets into Markdown, with public provenance. */
export function compose({ contentMd, kind = 'thread', origin, itemId, local = [], imported = [], stubOf,
  generatedSpans = [], citedFor } = {}) {
  const resolver = createCompositionResolver({ origin, local, imported });
  const transclusions = [], warnings = [];
  const md = markdown({
    onLink: ({ id }) => `<a href="${escapeAttr(itemPage(resolver.resolve(id)))}">${id}</a>`,
    onDirective: ({ id, selectionMd }) => {
      if (kind !== 'thread') fail('only threads may transclude');
      const source = resolver.resolve(id);
      resolver.checkClosure(source, itemId);
      const remote = originKey(source.origin) !== originKey(origin);
      const ref = { id, version: source.version, ...(remote ? { origin: source.origin } : {}) };
      let html = absoluteHtmlUrls(source.content_html, source.origin);
      if (selectionMd !== undefined) {
        const exact = compositionText(new MarkdownIt({ html: false }).render(selectionMd));
        if (!exact || !compositionText(html).includes(exact)) fail(`selection is not a substring of ${id} v${source.version}`);
        ref.selector = { exact };
        html = exact.split('\n').map(line => `<p>${escapeHtml(line)}</p>`).join('\n');
      }
      if (citedFor) {
        const cited = citedFor(structuredClone(source));
        if (cited !== undefined) {
          if (!isCited(cited)) fail("invalid citation");
          ref.cited = structuredClone(cited);
        }
      }
      transclusions.push(ref);
      if (remote && !source.retained && !source.pinned) warnings.push({ code: 'unpinned-remote', id, origin: source.origin });
      return `<blockquote class="blyg-transclusion${ref.selector ? ' blyg-partial' : ''}" data-blyg-id="${id}" data-blyg-version="${source.version}"${remote ? ` data-blyg-origin="${escapeAttr(source.origin)}"` : ''}>${html}</blockquote>\n`;
    },
  });
  const generated = [];
  let cursor = 0;
  const edits = [];
  // Private rendering tokens are inserted only after checking the author's text.
  if (/[\uE000\uE001]/.test(contentMd)) fail('reserved private rendering character');
  md.inline.ruler.before('text', 'generated_mark', (state, silent) => {
    const m = /^\uE000([oc])\uE001/.exec(state.src.slice(state.pos));
    if (!m) return false;
    if (!silent) state.push(m[1] === 'o' ? 'gen_open' : 'gen_close', '', 0);
    state.pos += m[0].length; return true;
  });
  // Ensure text parsing stops at our private marker too.
  const originalText = md.inline.ruler.__rules__.find(r => r.name === 'text').fn;
  md.inline.ruler.at('text', (state, silent) => {
    if (state.src[state.pos] === '\uE000') return false;
    const next = state.src.indexOf('\uE000', state.pos);
    const max = state.posMax;
    if (next >= 0 && next < max) state.posMax = next;
    const result = originalText(state, silent);
    state.posMax = max;
    return result;
  });
  md.block.ruler.before('paragraph', 'generated_block', (state, line, end, silent) => {
    const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
    const m = /^\uE000([OC])\uE001$/.exec(text);
    if (!m) return false;
    if (silent) return true;
    state.push(m[1] === 'O' ? 'gen_block_open' : 'gen_block_close', '', 0);
    state.line = line + 1; return true;
  }, { alt: ['paragraph', 'blockquote', 'list'] });
  md.renderer.rules.gen_block_open = () => '<div class="blyg-tk-gen">\n';
  md.renderer.rules.gen_block_close = () => '</div>\n';
  md.renderer.rules.gen_open = () => '<span class="blyg-tk-gen">';
  md.renderer.rules.gen_close = () => '</span>';
  for (const span of generatedSpans) {
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < cursor || span.end <= span.start || span.end > contentMd.length) fail('invalid or overlapping generated span');
    const provenance = { sources: (span.sources ?? []).map(s => ({ id: s.id, version: s.version })),
      ...(span.model !== undefined ? { model: span.model } : {}), ...(span.at !== undefined ? { at: span.at } : {}) };
    if (!isGeneratedSpan(provenance)) fail('invalid generation provenance');
    if ((span.sources ?? []).some(s => s.origin !== undefined)) fail('generation sources must be own-origin');
    generated.push(provenance);
    edits.push({ start: span.start, end: span.end, block: span.block === true || contentMd.slice(span.start, span.end).includes('\n\n') }); cursor = span.end;
  }
  // A whole-body span uses a block wrapper. Smaller spans use inline wrappers;
  // offset boundaries must surround prose, never split Markdown syntax.
  const whole = edits.length === 1 && edits[0].start === 0 && edits[0].end === contentMd.length;
  let renderMd = contentMd;
  if (!whole) for (const e of edits.reverse()) {
    renderMd = renderMd.slice(0, e.start) + (e.block ? '\n\n\uE000O\uE001\n\n' : '\uE000o\uE001') + renderMd.slice(e.start, e.end) + (e.block ? '\n\n\uE000C\uE001\n\n' : '\uE000c\uE001') + renderMd.slice(e.end);
  }
  let contentHtml = md.render(renderMd);
  if (whole) contentHtml = `<div class="blyg-tk-gen">${contentHtml}</div>\n`;
  contentHtml = absoluteHtmlUrls(contentHtml, origin);
  let target;
  if (stubOf !== undefined) {
    if (kind !== 'thread' || !isStubOf(stubOf)) fail('invalid stub target');
    target = structuredClone(stubOf);
    const baked = transclusions.find(r => r.id === target.id && originKey(r.origin ?? origin) === originKey(target.origin));
    if (baked) target.version = baked.version;
  }
  return { contentMd, contentHtml, ...(kind === 'thread' ? { transclusions } : {}),
    ...(target ? { stubOf: target } : {}), ...(generated.length ? { generated } : {}), warnings };
}

/** Readers display the baked HTML; this helper only tolerantly renders source previews. */
export function renderCompositionPreview(contentMd) { return markdown({ reader: true }).render(contentMd); }

// Exposed for fork flattening; parsing never executes publisher HTML.
export const compositionInternals = { markdown, attrs, hasClass, children, parseFragment, serialize };
