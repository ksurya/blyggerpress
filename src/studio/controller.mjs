import { createLifecycle, compose, renderPage, renderItem, buildItemDocument, buildStaticPublication, subscribe, refreshSubscription, importFeedFile, createHttpPorts, escapeMarkup, originKey } from '../blyg/index.mjs';

export function createStudio(library, initial, ports = createHttpPorts()) {
  let { state, revision } = initial;
  const identity = () => state.publicationIdentity;
  function writer() {
    if (!identity()?.origin) throw new Error('Set your publication URL first.');
    return createLifecycle({ origin: identity().origin, initialItems: state.publication.items,
      initialDrafts: state.drafts.map(d => ({...d, generated: d.generationMetadata})), getImported: () => state.imported });
  }
  async function commit(next) {
    const saved = await library.save(next, revision);
    state = saved.state; revision = saved.revision;
    return state;
  }
  async function change(fn) { const next = structuredClone(state); await fn(next); return commit(next); }
  async function author(fn) {
    const engine = writer(); const result = fn(engine);
    await change(next => { next.publication.items = JSON.parse(JSON.stringify(engine.listItems())); next.drafts = JSON.parse(JSON.stringify(engine.listDrafts().map(({generated, ...d}) => ({...d, generationMetadata:generated})))); });
    return result;
  }
  return {
    get state() { return structuredClone(state); },
    configure: (origin, title) => change(next => {
      const url = new URL(origin);
      if (!['https:', 'http:'].includes(url.protocol) || url.search || url.hash || url.username || url.password || !url.pathname.endsWith('/')) throw new Error('Use an HTTP(S) publication URL ending in /.');
      if (next.publication.items.length && next.publicationIdentity.origin !== url.href) throw new Error('Published origin cannot change.');
      next.publicationIdentity = { origin: url.href, title };
    }),
    saveDraft: (id, fields) => author(w => id ? w.saveDraft(id, fields) : w.newDraft(fields)),
    edit: id => author(w => { const d = w.itemDocument(id); return w.newDraft({ itemId: id, kind: w.snapshot(id).kind, contentMd: d.content_md ?? '', transclusions: [] }); }),
    discard: id => author(w => w.discardDraft(id)),
    publish: id => author(w => w.publishComposed(id)),
    pin: id => author(w => w.pin(id, w.itemDocument(id).version)),
    withdraw: id => author(w => w.withdraw(id)),
    fork: doc => author(w => w.newFork(doc)),
    forkLocal: (id, version) => author(w => w.newFork(w.pinnedDocument(id, version))),
    previewItem: id => renderItem(buildItemDocument(state.publication.items.find(i => i.id === id)), identity()),
    preview(fields) {
      const baked = compose({ ...fields, origin: identity().origin, local: state.publication.items, imported: state.imported });
      return renderPage({ origin: identity().origin, title: identity().title, body: baked.contentHtml });
    },
    async subscribe(url) { const r = await subscribe(state, url, ports); if (!r.ok) throw new Error(r.error?.message ?? r.error ?? r.reason ?? 'Request failed'); await commit(r.store); return r; },
    async refresh(id) { const r = await refreshSubscription(state, id, ports); await commit(r.store); if (!r.ok) throw new Error(r.error?.message ?? r.error ?? r.reason ?? 'Request failed'); return r; },
    async importFeed(feedUrl, text) { const r = await importFeedFile(state, {feedUrl,text}, ports); if (!r.ok) throw new Error(r.error?.message ?? r.error ?? r.reason ?? 'Request failed'); return commit(r.store); },
    curate: (id, visible) => change(n => { n.subscriptions.find(s => s.id === id).blogrollVisible = visible; }),
    unsubscribe: id => change(n => { n.subscriptions = n.subscriptions.filter(s => s.id !== id); }),
    annotate: (row, text) => change(n => { const targetKey = row.origin + '#' + row.id; n.notes = n.notes.filter(x => x.targetKey !== targetKey); n.notes.push({targetKey,text,at:new Date().toISOString()}); }),
    feedback: (row, value) => change(n => { const targetKey = row.origin + '#' + row.id; n.feedback = n.feedback.filter(x => x.targetKey !== targetKey); n.feedback.push({targetKey,value,at:new Date().toISOString()}); }),
    async exportFiles() {
      const files = buildStaticPublication({ ...identity(), items: state.publication.items, updated: new Date().toISOString(), previousFiles: state.publication.previousFiles ?? [] });
      const curated = state.subscriptions.filter(s => s.blogrollVisible && s.feedUrl);
      if (curated.length) {
        files.push({path:'blogroll.opml',body:`<?xml version="1.0"?><opml version="2.0"><head><title>Curated blogroll</title></head><body>${curated.map(s => `<outline type="rss" text="${escapeMarkup(s.title ?? s.identityOrigin)}" xmlUrl="${escapeMarkup(s.feedUrl)}"/>`).join('')}</body></opml>`});
        const manifest = files.find(f => f.path === 'blyg.json'); const doc = JSON.parse(manifest.body); doc.blogroll = 'blogroll.opml'; manifest.body = JSON.stringify(doc,null,2);
      }
      await change(n => { n.publication.previousFiles = files; });
      return files;
    },
    backup: () => library.backup(),
    async restore(text) { const saved = await library.restore(text, revision); state = saved.state; revision = saved.revision; },
  };
}

export function readerRows(state, { subscription = '', since = '' } = {}) {
  const origin = state.subscriptions.find(s => s.id === subscription)?.identityOrigin;
  return state.imported.filter(r => !r.dropped && (!subscription || originKey(r.origin) === originKey(origin)) && (!since || (r.updated ?? r.observedAt) >= since))
    .sort((a,b) => (b.updated ?? b.observedAt).localeCompare(a.updated ?? a.observedAt));
}
