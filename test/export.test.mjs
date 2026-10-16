import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createLifecycle, buildStaticPublication, createSiteZip, exportSiteBundle, sha256HexOfBytes } from '../src/blyg/index.mjs';
import { PUB_CHECKS, parseFeed } from '../tools/lib/publication-checks.mjs';
import cases from '../fixtures/cases/80-publication.json' with {type:'json'};

function sample(origin = 'https://example.com/deep/nested/') {
  let n=0, tick=0;
  const engine = createLifecycle({origin, idFactory:() => String(++n).padStart(26,'0'), clock:() => `2026-10-${String(++tick).padStart(2,'0')}T12:00:00Z`});
  const entry = {url:'media/image.png',mime:'image/png',alt:'A diagram'};
  const bytes = new Uint8Array([137,80,78,71]);
  engine.registerMedia(entry,{bytes});
  const a = engine.newDraft({contentMd:'Pinned text',contentHtml:`<p>Pinned text <img src="${origin}media/image.png" alt="A diagram"></p>`, media:[entry]});
  const first = engine.publish(a.localId);
  engine.pin(first.itemId,1);
  engine.saveDraft(a.localId,{contentMd:'WITHHELD_OLD_BODY',contentHtml:'<p>WITHHELD_OLD_BODY</p>',media:[],note:'revision'});
  engine.publish(a.localId);
  engine.saveDraft(a.localId,{contentMd:'Latest <& text',contentHtml:'<p>Latest &lt;&amp; text</p>',note:'latest & change'});
  engine.publish(a.localId);
  const b = engine.newDraft({kind:'thread',transclusions:[], contentMd:'WITHDRAWN_SECRET',contentHtml:'<p>WITHDRAWN_SECRET</p>'});
  const second = engine.publish(b.localId);
  engine.withdraw(second.itemId);
  engine.newDraft({contentMd:'DRAFT_SECRET',contentHtml:'<p>DRAFT_SECRET</p>'});
  const options = {origin,title:'My <& blyg', author:{name:'Writer',credentials:'TOKEN_SECRET'},items:engine.listItems(),assets:[{...entry,bytes,digest:sha256HexOfBytes(bytes)}]};
  return {engine,options,first,second};
}
const text = files => new Map(files.map(f => [f.path,f.body]));

test('generated lifecycle surface passes every shared publication fixture assertion', () => {
  const {options} = sample();
  const files = buildStaticPublication(options);
  const dir = mkdtempSync(join(tmpdir(),'blyg-export-'));
  try {
    for (const {path,body} of files) { mkdirSync(dirname(join(dir,path)),{recursive:true}); writeFileSync(join(dir,path),body); }
    for (const name of cases[0].assert) PUB_CHECKS[name]({dir});
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('no drafts, private configuration, withdrawn bodies or unpinned history escape', () => {
  const {options,first,second} = sample();
  const files = buildStaticPublication(options), map = text(files);
  const corpus = files.filter(f => typeof f.body === 'string').map(f => f.body).join('\n');
  for (const token of ['WITHHELD_OLD_BODY','WITHDRAWN_SECRET','DRAFT_SECRET','TOKEN_SECRET']) assert.equal(corpus.includes(token),false,token);
  assert.equal(map.has(`items/${first.itemId}/v2.json`),false);
  assert.equal(map.has(`items/${first.itemId}/v3.json`),false);
  assert.equal(map.has(`t/${second.itemId}/index.html`),true);
  assert.equal(map.has('media/image.png'),true);
  assert.match(map.get(`f/${first.itemId}/v1/index.html`),/Pinned text/);
  assert.equal(JSON.parse(map.get('blyg.json')).level,undefined);
});

test('RSS windows publish events, retains latest content, and never windows archive', () => {
  const {options,engine,first} = sample();
  let files = text(buildStaticPublication({...options,window:2}));
  let feed = parseFeed(files.get('feed.xml'));
  assert.equal(feed.entries.length,2);
  assert.equal(JSON.parse(files.get('items/index.json')).items.length,2);
  const before = files.get('feed.xml');
  engine.pin(first.itemId,2);
  files = text(buildStaticPublication({...options,items:engine.listItems(),window:2}));
  assert.equal(files.get('feed.xml'),before);
  feed = parseFeed(text(buildStaticPublication(options)).get('feed.xml'));
  assert.equal(feed.entries.filter(e => e.id === first.itemId).length,3);
  for (const event of feed.entries.filter(e => e.id === first.itemId)) assert.equal(event.description,'<p>Latest &lt;&amp; text</p>');
  assert.equal(feed.entries.filter(e => e.kind === 'withdrawn').length,1);
});

test('root and nested mounts, escaped metadata, deterministic ZIP and Blob download artifact', async () => {
  for (const origin of ['https://example.com/','https://example.com/a/b/','https://example.com/a%20b/']) {
    const {options,first} = sample(origin);
    const files = buildStaticPublication(options), map = text(files);
    assert.match(map.get('index.html'),/My &lt;&amp; blyg/);
    assert.ok(map.get(`f/${first.itemId}/index.html`).includes(`${origin}items/${first.itemId}.json`));
    assert.deepEqual(createSiteZip(files),createSiteZip(files));
    const blob = exportSiteBundle(options);
    assert.equal(blob.type,'application/zip');
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),createSiteZip(files));
  }
});

test('fail closed on absent or changed media, unsafe routes, collisions and origin mismatch', () => {
  const {options} = sample();
  assert.throws(() => buildStaticPublication({...options,assets:[]}),/media bytes/);
  assert.throws(() => buildStaticPublication({...options,assets:options.assets.map(a => ({...a,bytes:new Uint8Array([0])}))}),/baseline/);
  assert.throws(() => buildStaticPublication({...options,origin:'https://other.example/'}),/origin differs/);
  assert.throws(() => buildStaticPublication({...options,items:[...options.items,options.items[0]]}),/duplicate/);
  for (const page of ['../escape/','/outside/','%2e%2e/','archive/','https://evil.test/']) {
    const items = structuredClone(options.items); items[0].page=page;
    assert.throws(() => buildStaticPublication({...options,items}),/unsafe|duplicate|relative/);
  }
});

test('prior publication protects pins, media and permanent item routes', () => {
  const {options,engine,first} = sample();
  const previousFiles = buildStaticPublication(options);
  engine.withdraw(first.itemId);
  const next = buildStaticPublication({...options,items:engine.listItems(),previousFiles});
  assert.deepEqual(text(next).get('media/image.png'),text(previousFiles).get('media/image.png'));
  assert.equal(text(next).get(`items/${first.itemId}/v1.json`),text(previousFiles).get(`items/${first.itemId}/v1.json`));
  const changed = structuredClone(options.items); changed[0].versions[0].pinned=false;
  assert.throws(() => buildStaticPublication({...options,items:changed,previousFiles}),/immutable/);
  assert.throws(() => buildStaticPublication({...options,items:[],updated:'2026-10-30T00:00:00Z',previousFiles}),/immutable|disappeared/);
});

test('empty publications need an explicit UTC timestamp and produce usable surfaces', () => {
  const options = {origin:'https://example.com/',title:'Empty',items:[]};
  assert.throws(() => buildStaticPublication(options),/updated/);
  const files = text(buildStaticPublication({...options,updated:'2026-10-16T00:00:00Z'}));
  assert.deepEqual(JSON.parse(files.get('items/index.json')).items,[]);
  assert.equal(parseFeed(files.get('feed.xml')).entries.length,0);
});

const xmlToolsAvailable = spawnSync('xmllint', ['--version']).status === 0 && spawnSync('unzip', ['-v']).status === 0;
test('CDATA terminators and Unicode survive independent ZIP and XML tools', {skip: !xmlToolsAvailable}, () => {
  const {engine,options,first} = sample();
  const draft = engine.newDraft({itemId:first.itemId,contentMd:'Unicode ☀ and terminator',contentHtml:'<p>Unicode ☀ ]]&gt;</p><!-- ]]> -->',note:'<& revision'});
  engine.publish(draft.localId);
  const files = buildStaticPublication({...options,items:engine.listItems()});
  const dir = mkdtempSync(join(tmpdir(),'blyg-xml-'));
  try {
    const xml = text(files).get('feed.xml');
    const path = join(dir,'feed.xml'); writeFileSync(path,xml);
    execFileSync('xmllint',['--noout',path]);
    assert.match(xml,/\]\]\]\]><!\[CDATA\[>/);
    const zipPath=join(dir,'site.zip'); writeFileSync(zipPath,createSiteZip(files));
    assert.match(execFileSync('unzip',['-t',zipPath],{encoding:'utf8'}),/No errors detected/);
    assert.equal(execFileSync('unzip',['-p',zipPath,'feed.xml'],{encoding:'utf8'}),xml);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('browser download adapter creates a ZIP link and releases the object URL', async () => {
  const { downloadSiteBundle } = await import('../src/blyg/export.mjs');
  const saved = {document:globalThis.document, create:URL.createObjectURL,revoke:URL.revokeObjectURL,timer:globalThis.setTimeout};
  let clicked=false, revoked=false;
  const anchor = {click() {clicked=true;}};
  try {
    globalThis.document = {createElement(tag) {assert.equal(tag,'a'); return anchor;}};
    URL.createObjectURL = blob => { assert.equal(blob.type,'application/zip'); return 'blob:test'; };
    URL.revokeObjectURL = url => {assert.equal(url,'blob:test'); revoked=true;};
    globalThis.setTimeout = callback => {callback();};
    downloadSiteBundle(sample().options,'publication.zip');
    assert.equal(anchor.href,'blob:test');
    assert.equal(anchor.download,'publication.zip');
    assert.equal(clicked,true); assert.equal(revoked,true);
  } finally {
    if (saved.document === undefined) delete globalThis.document; else globalThis.document=saved.document;
    URL.createObjectURL=saved.create; URL.revokeObjectURL=saved.revoke; globalThis.setTimeout=saved.timer;
  }
});
