// Browser/Node static export adapter. No private store is serialized here.
import { projectItemFiles, archiveRows, serialize } from './publication.mjs';
import { latestVersion, pinnedVersions, validatePublisherItem, isIso8601Utc } from './item.mjs';
import { sha256HexOfBytes } from './hash.mjs';
import { buildFeed } from './feed.mjs';
import { renderItem, renderArchive } from './render.mjs';
import { createSiteZip } from './zip.mjs';

function mount(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/')) throw new Error('origin must be an HTTP(S) directory URL without credentials, query or fragment');
  return url.href;
}

// ZIP paths and public routes must agree, without aliases or traversal.
function safePath(path, { decoded = false } = {}) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || /[\\?#:\x00-\x1f]/.test(path) || (!decoded && path.includes('%')) || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error(`unsafe export path: ${path}`);
  return path;
}
const bytes = body => typeof body === 'string' ? new TextEncoder().encode(body) : body;

/**
 * items: lifecycle.listItems(), never drafts or a reader store.
 * assets: [{url, mime, bytes: Uint8Array, digest}] from durable media storage;
 * digest is the immutable baseline registered at publish time.
 * previousFiles: last successful export, used to enforce pin/media preservation.
 * content_html is already sanitized and baked by the composition adapter.
 */
export function buildStaticPublication({ origin, title, author = {}, items, assets = [], updated, window = 50, previousFiles = [] }) {
  origin = mount(origin);
  if (typeof title !== 'string' || !Array.isArray(items)) throw new Error('title and published items are required');
  const rows = archiveRows(items);
  updated ??= rows[0]?.updated;
  if (!isIso8601Utc(updated) || !Number.isFinite(Date.parse(updated)) || rows.some(r => Date.parse(r.updated) > Date.parse(updated))) throw new Error('updated must be a UTC instant at or after every publish event (required for an empty site)');
  const files = new Map();
  const add = (path, body) => {
    safePath(path, {decoded:true});
    if (files.has(path)) throw new Error(`duplicate export path: ${path}`);
    files.set(path, typeof body === 'string' ? body : body.slice());
  };
  const projected = projectItemFiles(items);
  const projectedByPath = new Map(projected.map(({path,value}) => [path,value]));
  const documents = new Map();
  for (const item of items) {
    if (item.origin !== origin) throw new Error('item origin differs from publication origin');
    const doc = projectedByPath.get(`items/${item.id}.json`);
    if (!validatePublisherItem(doc).valid) throw new Error(`invalid published item: ${item.id}`);
    if (typeof doc.page !== 'string' || !doc.page.endsWith('/')) throw new Error('item page must be a relative directory path');
    safePath(doc.page.slice(0,-1));
    documents.set(doc.id, doc);
    add(`${doc.page}index.html`, renderItem(doc, { origin }));
    for (const v of pinnedVersions(item)) {
      const pin = projectedByPath.get(`items/${item.id}/v${v.version}.json`);
      add(`${doc.page}v${v.version}/index.html`, renderItem(pin, { origin, pin:true }));
    }
  }
  for (const {path, value} of projected) add(path, serialize(value));
  // Explicit manifest allow-list: local settings, tokens, notes never escape.
  const imprint = {};
  for (const key of ['name','bio','avatar']) if (typeof author[key] === 'string') imprint[key] = author[key];
  if (Array.isArray(author.links)) imprint.links = author.links.map(({label,url}) => ({label:String(label),url:String(url)}));
  const manifest = { blyg:'0.3', generator:'BlyggerPress/0.0.0', generator_url:'https://github.com/ksurya/blyggerpress', site:origin, title, author:imprint, feed:'feed.xml', items:'items/index.json', updated };
  add('blyg.json', serialize(manifest));
  add('items/index.json', serialize({updated, items:rows}));
  add('feed.xml', buildFeed({origin,title,updated,items,window}));
  const ordered = rows.map(r => documents.get(r.id));
  const pages = renderArchive({origin,title,documents:ordered});
  add('index.html', pages.home);
  add('archive/index.html', pages.archive);
  add('.nojekyll', '');
  // Supported by several static hosts; other hosts must configure these headers.
  add('_headers', '/*\n  Access-Control-Allow-Origin: *\n');
  const needed = new Map();
  for (const item of items) {
    for (const version of [latestVersion(item), ...pinnedVersions(item)]) {
      for (const entry of version.media ?? []) {
        const url = new URL(entry.url, origin);
        if (url.hash || url.search || !url.href.startsWith(origin)) throw new Error('media must be immutable files within the publication mount');
        const path = safePath(url.href.slice(origin.length).split('/').map(segment => {
          const decoded = decodeURIComponent(segment);
          if (/[\\/]/.test(decoded)) throw new Error('unsafe media path segment');
          return decoded;
        }).join('/'), {decoded:true});
        if (!path.startsWith('media/')) throw new Error('media must live under media/');
        if (needed.has(path) && needed.get(path).mime !== entry.mime) throw new Error('conflicting media MIME');
        needed.set(path, entry);
      }
    }
  }
  for (const [path, entry] of needed) {
    const candidates = assets.filter(a => new URL(a.url, origin).href === new URL(entry.url, origin).href);
    if (candidates.length !== 1) throw new Error(`missing or duplicate media bytes: ${path}`);
    const asset = candidates[0];
    if (!(asset.bytes instanceof Uint8Array) || asset.mime !== entry.mime || sha256HexOfBytes(asset.bytes) !== asset.digest) throw new Error(`media differs from its immutable baseline: ${path}`);
    add(path, asset.bytes);
  }
  for (const prior of previousFiles) {
    // Pins and their readable pages, plus all previously published media bytes,
    // must survive. Old unpinned media can be retained without exposing history.
    const immutable = /^items\/[^/]+\/v\d+\.json$/.test(prior.path) || /\/v\d+\/index\.html$/.test(prior.path);
    if (prior.path.startsWith('media/') && !files.has(prior.path)) add(prior.path, prior.body);
    if (immutable || prior.path.startsWith('media/')) {
      const next = files.get(prior.path);
      if (next === undefined || sha256HexOfBytes(bytes(next)) !== sha256HexOfBytes(bytes(prior.body))) throw new Error(`immutable file changed or disappeared: ${prior.path}`);
    }
    if (/^items\/[^/]+\.json$/.test(prior.path) && !files.has(prior.path)) throw new Error(`published item disappeared: ${prior.path}`);
  }
  return [...files].sort(([a],[b]) => a.localeCompare(b)).map(([path,body]) => ({path,body}));
}

export function exportSiteBundle(options) {
  return new Blob([createSiteZip(buildStaticPublication(options))], {type:'application/zip'});
}

export function downloadSiteBundle(options, filename = 'blyg-site.zip') {
  const blob = exportSiteBundle(options);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
