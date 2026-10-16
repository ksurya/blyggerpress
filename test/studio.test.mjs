import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { openStore } from '../src/studio/store.mjs';
import { createStudio, readerRows } from '../src/studio/controller.mjs';
async function setup() { const library = await openStore({indexedDB,name:crypto.randomUUID()}); return {library, studio:createStudio(library,await library.read())}; }
test('studio saves, reloads, composes, edits, pins and withdraws without leaking private state',async () => {
 const {library,studio} = await setup();
 await studio.configure('https://example.com/blyg/','My blyg');
 const draft = await studio.saveDraft(null,{contentMd:'Hello **world**'});
 assert.match(studio.preview(draft),/<strong>world<\/strong>/);
 const event = await studio.publish(draft.localId);
 const reloaded = createStudio(library,await library.read());
 await reloaded.pin(event.itemId);
 const edit = await reloaded.edit(event.itemId);
 await reloaded.saveDraft(edit.localId,{contentMd:'Updated public words'});
 await reloaded.publish(edit.localId);
 await reloaded.annotate({origin:'https://private.example/',id:'private'},'SECRET NOTE');
 const files = await reloaded.exportFiles();
 assert.equal(JSON.parse(files.find(f => f.path === `items/${event.itemId}.json`).body).version,2);
 assert.ok(files.some(f => f.path.endsWith('/v1.json')));
 assert.ok(!JSON.stringify(files).includes('SECRET NOTE'));
 await reloaded.withdraw(event.itemId);
 const after = createStudio(library,await library.read());
 assert.equal(after.state.publication.items[0].versions.length,3);
 assert.ok((await after.exportFiles()).some(f => f.path.endsWith('/v1.json')));
 library.close();
});
test('private feed import, filters, annotations, opt-in curation and backup restore integrate',async () => {
 const {library,studio} = await setup(); await studio.configure('https://example.com/','Test');
 await studio.importFeed('https://feed.example/rss.xml','<rss version="2.0"><channel><title>Feed</title><link>https://feed.example/</link><description>Feed</description><item><guid>one</guid><title>One</title><description>Hello</description><link>https://feed.example/one</link></item></channel></rss>');
 const row = studio.state.imported[0], sub = studio.state.subscriptions[0];
 assert.ok(row); assert.equal(sub.blogrollVisible,false);
 assert.equal(readerRows(studio.state,{subscription:sub.id}).length,1);
 assert.equal(readerRows(studio.state,{since:'9999-01-01'}).length,0);
 await studio.annotate(row,'SECRET'); await studio.feedback(row,'like');
 assert.ok(!(await studio.exportFiles()).some(f => f.path === 'blogroll.opml'));
 await studio.curate(sub.id,true);
 const files = await studio.exportFiles(); assert.ok(files.some(f => f.path === 'blogroll.opml'));
 assert.ok(!JSON.stringify(files).includes('SECRET'));
 const backup = await studio.backup(); await studio.unsubscribe(sub.id); await studio.restore(backup);
 assert.equal(studio.state.notes[0].text,'SECRET'); assert.equal(studio.state.subscriptions.length,1);
 library.close();
});
test('stale tab saves fail without changing its in-memory state',async () => {
 const {library,studio} = await setup(); const stale = createStudio(library,await library.read());
 await studio.configure('https://example.com/','A');
 await assert.rejects(stale.configure('https://other.example/','B'));
 assert.equal(stale.state.publicationIdentity,undefined); library.close();
});

test('restored sparse draft IDs stay unique; pinned forks survive a fresh controller',async () => {
 const {library,studio} = await setup(); await studio.configure('https://example.com/','Test');
 const one = await studio.saveDraft(null,{contentMd:'Original'});
 const two = await studio.saveDraft(null,{contentMd:'Discard me'});
 await studio.saveDraft(null,{contentMd:'Keep me'}); await studio.discard(two.localId);
 const event = await studio.publish(one.localId); await studio.pin(event.itemId);
 const next = createStudio(library,await library.read());
 const fresh = await next.saveDraft(null,{contentMd:'Fourth'}); assert.equal(fresh.localId,'draft-4');
 const fork = await next.forkLocal(event.itemId,1); assert.equal(fork.forkedFrom.id,event.itemId);
 await next.publish(fork.localId);
 const reloaded = createStudio(library,await library.read());
 assert.equal(reloaded.state.publication.items.length,2);
 assert.match(reloaded.previewItem(event.itemId),/Original/); library.close();
});
