import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compose, compositionText, renderCompositionPreview } from '../src/blyg/compose.mjs';
import { forkPinnedDocument, checkForkPin } from '../src/blyg/fork.mjs';
import { createLifecycle } from '../src/blyg/lifecycle.mjs';
import { importCanonicalItem, retainPinnedVersion } from '../src/blyg/reconcile.mjs';
import { contentHash } from '../src/blyg/hash.mjs';
const A = '1jt332depwffcsyfz9txf8c9r9', B = '3ev1cjtw7c6q5y8cd0r7aj3bhc', C = '7gvp7ms7wq4nks6erdbbdp8cqc';
const O = 'https://own.test/blyg/', R = 'https://remote.test/';
const covered = new Set();
function conformance(name, requirements, fn) {
  for (const id of requirements) covered.add(id);
  test(name, fn);
}

const source = (extra = {}) => ({ origin: O, id: A, kind: 'fragment', version: 2, content_md: 'Hello *world*\n\nNext line', content_html: '<p>Hello <em>world</em></p><p>Next line</p>', ...extra });
const run = (contentMd, extra = {}) => compose({ contentMd, origin: O, local: [source()], ...extra });

conformance('directive grammar, code suppression, inline inert text, silent internal links', ["R10.1-1", "R10.1-3", "R10.1-4", "R5.8-1"], () => {
  const result = run(`Prose [[${A}]] and ![[${A}]]\n\n\`[[${A}]]\`\n\n\`\`\`\n![[${A}]]\n\`\`\`\n\n    ![[${A}]]\n\n  ![[${A}]]  `);
  assert.equal(result.transclusions.length, 1);
  assert.match(result.contentHtml, new RegExp(`<a href="${O}f/${A}/">`));
  assert.match(result.contentHtml, /and !\[\[/);
  assert.equal((result.contentHtml.match(/blyg-transclusion/g) ?? []).length, 1);
  assert.equal(run(`[[${A}]]`).transclusions.length, 0);
  assert.match(run(`[[${A}]]`, { local: [source({ page: 'custom/path/' })] }).contentHtml, /https:\/\/own.test\/blyg\/custom\/path\//);
  assert.throws(() => run(`[[${B}]]`), /unresolvable/);
  assert.throws(() => run(`![[${A}@v2]]`), /reserved/);
  assert.doesNotThrow(() => run(`\`![[${A}@v2]]\``));
  assert.doesNotThrow(() => renderCompositionPreview(`![[${A}@v2]]`));
});

conformance('partial quotations use normalized HTML text, escaped paragraphs, selectors and no cap', ["R10.1-2", "R10.2-3", "R10.3-2"], () => {
  const result = run(`![[${A}]]\n> Hello **world**\n>\n> Next line`);
  assert.deepEqual(result.transclusions[0].selector, { exact: 'Hello world\nNext line' });
  assert.match(result.contentHtml, /blyg-transclusion blyg-partial/);
  assert.match(result.contentHtml, /<p>Hello world<\/p>\n<p>Next line<\/p>/);
  assert.doesNotMatch(result.contentHtml, /<em>/);
  assert.throws(() => run(`![[${A}]]\n> invented`), /substring/);
  const detached = run(`![[${A}]]\n\n> own prose`);
  assert.equal(detached.transclusions[0].selector, undefined);
  assert.match(detached.contentHtml, /own prose/);
  const text = 'a'.repeat(5000) + ' & < >';
  assert.match(run(`![[${A}]]\n> ${'a'.repeat(5000)} & < >`, { local: [source({ content_html: `<p>${'a'.repeat(5000)} &amp; &lt; &gt;</p>` })] }).contentHtml, /&amp; &lt; &gt;/);
  assert.equal(compositionText('<p>A &amp; &#66;  <b>C</b></p><div>D<br>E</div>'), 'A & B C\nD\nE');
});

conformance('resolution prefers published local, rejects drafts, L0, dropped and ambiguous imports', ["R10.2-1", "R10.2-2"], () => {
  const imported = [{ ...source({ origin: R, version: 7 }), contentHtml: '<p>remote</p>' }];
  assert.equal(run(`![[${A}]]`, { imported }).transclusions[0].version, 2);
  const remote = run(`![[${A}]]`, { local: [], imported });
  assert.equal(remote.transclusions[0].origin, R);
  assert.match(remote.contentHtml, /data-blyg-origin="https:\/\/remote.test\/"/);
  assert.equal(remote.warnings[0].code, 'unpinned-remote');
  for (const row of [{ ...imported[0], l0: true }, { ...imported[0], dropped: true }, { ...imported[0], kind: 'withdrawn' }]) {
    assert.throws(() => run(`![[${A}]]`, { local: [], imported: [row] }), /unresolvable/);
  }
  assert.throws(() => run(`![[${A}]]`, { local: [{ id: A, kind: 'fragment' }] }), /unresolvable/);
  assert.throws(() => run(`![[${A}]]`, { local: [], imported: [...imported, { ...imported[0], origin: 'https://other.test/' }] }), /ambiguous/);
});

conformance('nested remote snapshots stay finite, direct provenance only; local closure rejects cycles', ["R10.2-5", "R10.3-1", "R5.3-3"], () => {
  const inner = run(`![[${A}]]`);
  const nested = run(`![[${B}]]`, { local: [], imported: [{ origin: R, id: B, kind: 'thread', version: 8, contentHtml: inner.contentHtml }] });
  assert.equal(nested.transclusions.length, 1);
  assert.equal(nested.transclusions[0].id, B);
  assert.equal((nested.contentHtml.match(/blyg-transclusion/g) ?? []).length, 2);
  const b = source({ id: B, kind: 'thread', transclusions: [{ id: C, version: 1 }] });
  const c = source({ id: C, kind: 'thread', transclusions: [{ id: A, version: 1 }] });
  assert.throws(() => run(`![[${B}]]`, { itemId: A, local: [b, c] }), /cycle/);
  assert.doesNotThrow(() => run(`![[${B}]]`, { itemId: A, local: [{ ...b, transclusions: [{ id: A, version: 1, origin: R }] }] }));
});

conformance('stub version agrees only with its direct baked target; citations remain frozen outside HTML', ["R5.9-1", "R5.9-3", "R5.9-4", "R10.2-4", "R10.6-1", "R10.6-2", "R10.6-3"], () => {
  const cited = { retrieved: '2026-10-01T00:00:00Z', source: 'OLD LABEL' };
  const stubOf = { origin: O, id: A, version: 1, cited };
  const r = run(`![[${A}]]`, { stubOf, citedFor: () => cited });
  assert.equal(r.stubOf.version, 2);
  assert.deepEqual(r.stubOf.cited, cited);
  assert.equal(run('response', { stubOf }).stubOf.version, 1);
  assert.equal(stubOf.version, 1);
  assert.doesNotMatch(r.contentHtml, /OLD LABEL/);
  const web = run('> web quote', { stubOf: { url: 'https://web.test/', cited } });
  assert.deepEqual(web.transclusions, []);
  assert.doesNotMatch(web.contentHtml, /blyg-transclusion|blyg-partial|OLD LABEL/);
  assert.throws(() => run('text', { stubOf: { id: A, version: 1 } }), /invalid stub/);
});

conformance('generation supports inline, whole-body and multiple spans, sources remain disjoint', ["R5.7-3", "R5.7-8", "R10.3-3"], () => {
  const r = run('Hello new words today', { generatedSpans: [{ start: 6, end: 15, model: 'test', sources: [{ id: A, version: 2 }] }] });
  assert.equal(r.contentHtml, '<p>Hello <span class="blyg-tk-gen">new words</span> today</p>\n');
  assert.equal(r.transclusions.length, 0);
  assert.equal(r.generated[0].model, 'test');
  assert.equal(run('text', { generatedSpans: [{ start: 0, end: 4 }] }).generated[0].sources.length, 0);
  const multi = run('one two three', { generatedSpans: [{ start: 0, end: 3 }, { start: 8, end: 13 }] });
  assert.equal((multi.contentHtml.match(/blyg-tk-gen/g) ?? []).length, 2);
  assert.throws(() => run('text', { generatedSpans: [{ start: 0, end: 4, sources: [{ id: A, version: 1, origin: R }] }] }), /own-origin/);
});

conformance('publish re-resolves current snapshots; failed republish is atomic and prior bake stays unchanged', ["R10.2-6", "R10.4-1", "R9-5"], () => {
  let imported = [{ origin: R, id: A, kind: 'fragment', version: 1, contentHtml: '<p>first</p>' }];
  const lc = createLifecycle({ origin: O, getImported: () => imported, idFactory: () => B, clock: () => '2026-10-01T00:00:00Z' });
  const d = lc.newDraft({ kind: 'thread', transclusions: [], contentMd: `![[${A}]]`, stubOf: { origin: R, id: A, version: 1 } });
  assert.equal(lc.publish(d.localId).warnings[0].code, 'unpinned-remote'); lc.pin(B, 1);
  const before = lc.itemDocument(B);
  imported[0].contentHtml = '<p>edited</p>'; imported[0].version = 2;
  assert.deepEqual(lc.itemDocument(B), before);
  lc.publish(d.localId);
  assert.equal(lc.itemDocument(B).transclusions[0].version, 2);
  assert.match(lc.pinnedDocument(B, 1).content_html, /first/);
  imported = [{ ...imported[0], kind: 'withdrawn', dropped: true }];
  assert.throws(() => lc.publish(d.localId), /unresolvable/);
  assert.equal(lc.itemDocument(B).version, 2);
  assert.equal(lc.itemDocument(B).stub_of.version, 2);
  assert.deepEqual(lc.versions(B).map(v => !!v.pinned), [true, false]);
});

test('reader retains composition and cited verbatim; withdrawal resolves pin content and version', () => {
  const cited = { retrieved: '2026-01-01T00:00:00Z', custom: { opaque: true } };
  const doc = source({ origin: R, generated: [{ sources: [] }], transclusions: [{ id: B, version: 1, cited }], content_hash: contentHash('text') });
  let store = importCanonicalItem({}, { origin: R, doc }).store;
  assert.deepEqual(store.imported[0].transclusions, doc.transclusions);
  store = retainPinnedVersion(store, { origin: R, id: A, version: 2, snapshot: { kind: 'thread', contentHtml: doc.content_html, contentMd: doc.content_md, transclusions: doc.transclusions, generated: doc.generated } }).store;
  store = importCanonicalItem(store, { origin: R, doc: { ...doc, version: 3, kind: 'withdrawn' } }).store;
  const r = run(`![[${A}]]`, { local: [], imported: store.imported });
  assert.equal(r.transclusions[0].version, 2);
  assert.match(r.contentHtml, /Hello/);
  assert.deepEqual(store.imported[0].transclusions, doc.transclusions);
});

const pin = (extra = {}) => ({ ...source(), pinned: true, ...extra });
conformance('fork flattens pinned nested quotes, remote scope and baked links without resolving current items', ["R5.6-4"], () => {
  const inner = run(`![[${A}]]`);
  const html = `<p>Own prose <a href="https://fixed.test/page/">${A}</a></p><blockquote class="blyg-transclusion" data-blyg-id="${B}" data-blyg-version="4">${inner.contentHtml}</blockquote>`;
  const r = forkPinnedDocument(pin({ kind: 'thread', content_md: `Own prose [[${A}]]\n\n![[${B}]]`, content_html: html }));
  assert.match(r.contentMd, /^Own prose \[/);
  assert.match(r.contentMd, /https:\/\/fixed.test\/page\//);
  assert.match(r.contentMd, /> > Hello/);
  assert.match(r.contentMd, new RegExp(`${O.replaceAll('.', '\\.')} ${B}`));
  assert.doesNotMatch(r.contentHtml, /blyg-transclusion|data-blyg/);
  assert.deepEqual(r.transclusions, []);
  assert.deepEqual(r.forkedFrom, { origin: O, id: A, version: 2 });
});

conformance('fork partiality is read from bake, preserves prose bytes and code, discloses generation', ["R5.7-7"], () => {
  const content_md = `Exact  *own* prose.\n\n![[${B}]]\n> author prose\n\n\`[[${B}]]\``;
  const content_html = `<p>Exact <em>own</em> prose.</p><blockquote class="blyg-transclusion" data-blyg-id="${B}" data-blyg-version="1"><p>frozen quote</p><span class="blyg-tk-gen">machine</span></blockquote><blockquote><p>author prose</p></blockquote>`;
  const r = forkPinnedDocument(pin({ kind: 'thread', content_md, content_html }));
  assert.match(r.contentMd, /^Exact  \*own\* prose\./);
  assert.match(r.contentMd, /> author prose/);
  assert.match(r.contentMd, new RegExp('`\\[\\[' + B + '\\]\\]`'));
  assert.match(r.contentHtml, /blyg-tk-gen/);
  assert.deepEqual(r.generated[0].sources, []);
  const partial = forkPinnedDocument(pin({ kind: 'thread', content_md, content_html: content_html.replace('class="blyg-transclusion"', 'class="blyg-transclusion blyg-partial"') }));
  assert.doesNotMatch(partial.contentMd, /author prose/);
  assert.throws(() => forkPinnedDocument({ ...pin(), pinned: false }), /pinned/);
});

conformance('fork custody is one hop and lineage cannot be retargeted or cleared', ["R5.6-1", "R5.6-6"], () => {
  const f = forkPinnedDocument(pin({ forked_from: { origin: R, id: C, version: 1 } }));
  const lc = createLifecycle({ origin: O, idFactory: () => B });
  const d = lc.newDraft(f); lc.publish(d.localId);
  assert.equal(lc.itemDocument(B).forked_from.id, A);
  assert.throws(() => lc.saveDraft(d.localId, { forkedFrom: undefined }), /cannot be changed/);
  lc.withdraw(B);
  assert.equal(lc.itemDocument(B).forked_from.id, A);
});

test('conditional pin checks reject contrary evidence but host failure only warns', async () => {
  const ref = { origin: O, id: A, version: 2 };
  for (const status of [404, 403]) await assert.rejects(checkForkPin(ref, { fetchPinned: async () => ({ status }) }), /named pin/);
  await assert.rejects(checkForkPin(ref, { fetchPinned: async () => ({ status: 200, doc: pin({ version: 3 }) }) }), /named pin/);
  assert.equal((await checkForkPin(ref, { fetchPinned: async () => ({ status: 503 }) })).warning, 'pin-host-unavailable');
  assert.equal((await checkForkPin(ref, { fetchPinned: async () => { throw Error('offline'); } })).warning, 'pin-host-unavailable');
  assert.equal((await checkForkPin(ref, { fetchPinned: async () => ({ status: 200, doc: pin() }) })).valid, true);
});

test('committed cross-client nested/withdrawn composition fixture is executable', () => {
  const f = JSON.parse(readFileSync(new URL('../fixtures/composition/snapshots.json', import.meta.url)));
  const r = compose(f);
  assert.deepEqual(r.transclusions, f.expectedReferences);
  assert.equal((r.contentHtml.match(/blyg-transclusion/g) ?? []).length, 3);
  assert.match(r.contentHtml, /Nested frozen prose/);
  f.imported[0].kind = 'withdrawn'; f.imported[0].dropped = true;
  assert.throws(() => compose(f), /unresolvable/);
  assert.match(r.contentHtml, /Remote prose/);
});

conformance('direct staleness uses fetched origin, never a cited label or transitive target', ["R5.9-2", "R10.4-2"], async () => {
  const { referenceStatus } = await import('../src/blyg/reference.mjs');
  const ref = { origin: R, id: A, version: 2, cited: { retrieved: '2026-01-01T00:00:00Z', source: 'current' } };
  assert.equal(referenceStatus(ref, { origin: R, doc: source({ version: 3 }) }, O), 'stale');
  assert.equal(referenceStatus(ref, { origin: O, doc: source({ version: 3 }) }, O), 'unavailable');
  assert.equal(referenceStatus(ref, { origin: R, doc: source({ transclusions: [{ id: B, version: 1 }] }) }, O), 'current');
});

test('fork uses arbitrary pinned link labels and pages; multiline code links stay inert', () => {
  const r = forkPinnedDocument(pin({ content_md: `own [normal](https://normal.test/) [[${A}]]\n\n\`code\n[[${B}]]\``,
    content_html: '<p>own <a href="https://normal.test/">normal</a> <a href="https://old.test/renamed/">custom caption</a></p><p><code>code link</code></p>' }));
  assert.match(r.contentMd, /https:\/\/old.test\/renamed\//);
  assert.match(r.contentMd, new RegExp(`\\[\\[${B}\\]\\]`));
});

test('removing the last directive clears provenance on republish; inline generation persists', () => {
  const lc = createLifecycle({ origin: O, getImported: () => [{ ...source(), origin: R }], idFactory: () => B });
  const d = lc.newDraft({ kind: 'thread', contentMd: `![[${A}]]`, transclusions: [] });
  lc.publish(d.localId);
  lc.saveDraft(d.localId, { contentMd: 'plain response' });
  lc.publish(d.localId);
  assert.deepEqual(lc.itemDocument(B).transclusions, []);
  assert.doesNotMatch(lc.itemDocument(B).content_html, /blyg-transclusion/);
  const g = lc.newDraft({ contentMd: 'hello generated', generatedSpans: [{ start: 6, end: 15 }] });
  lc.publish(g.localId, { id: C });
  lc.publish(g.localId);
  assert.match(lc.itemDocument(C).content_html, /hello <span class="blyg-tk-gen">generated<\/span>/);
});

test('every SUK-141 requirement has an executable conformance check', () => {
  const requirements = JSON.parse(readFileSync(new URL('../contracts/requirements.json', import.meta.url)));
  const owned = requirements.filter(r => r.issue === 'SUK-141').map(r => r.id);
  assert.deepEqual([...covered].sort(), owned.sort());
});

conformance('portable HTML uses absolute image and ordinary link URLs', ['R5.2-7'], () => {
  const r = run('[link](relative/page) ![image](media/a.png)');
  assert.match(r.contentHtml, /href="https:\/\/own.test\/blyg\/relative\/page"/);
  assert.match(r.contentHtml, /src="https:\/\/own.test\/blyg\/media\/a.png"/);
});

test('partial grammar includes Markdown lazy blockquote continuations', () => {
  const r = run(`![[${A}]]\n> Hello\nworld`);
  assert.deepEqual(r.transclusions[0].selector, { exact: 'Hello world' });
  assert.match(r.contentHtml, /<p>Hello world<\/p>/);
});

test('fork flattening preserves blockquote and list containers through recomposition', () => {
  for (const contentMd of [`> before\n>\n> ![[${A}]]\n>\n> after`, `- ![[${A}]]`]) {
    const baked = run(contentMd);
    const fork = forkPinnedDocument(pin({ id: B, kind: 'thread', content_md: contentMd, content_html: baked.contentHtml }));
    const recomposed = run(fork.contentMd);
    assert.deepEqual(recomposed.transclusions, []);
    assert.equal(compositionText(recomposed.contentHtml), compositionText(fork.contentHtml));
    const tag = contentMd.startsWith('>') ? 'blockquote' : 'li';
    assert.match(recomposed.contentHtml, new RegExp(`<${tag}>[\\s\\S]*<blockquote>`));
  }
});
