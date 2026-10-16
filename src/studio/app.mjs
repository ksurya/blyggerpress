import { openStore, inspectBackup } from './store.mjs';
import { createStudio, readerRows } from './controller.mjs';
import { createSiteZip } from '../blyg/index.mjs';
const $ = id => document.getElementById(id);
let studio, active, restoreText, busy = false, dirty = false;
function status(text, error = false) { $('status').textContent = text; $('status').className = error ? 'error' : ''; }
function download(body, filename, type) { const url = URL.createObjectURL(new Blob([body], {type})); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
async function run(fn) {
  if (busy) return;
  busy = true; document.querySelector('main').inert = true;
  try { const message = await fn(); render(); status(typeof message === 'string' ? message : 'Saved in this browser.'); }
  catch (e) { status(e.message, true); }
  finally { busy = false; document.querySelector('main').inert = false; }
}
function button(text, action) { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = () => run(action); return b; }
function text(tag, value, parent) { const el = document.createElement(tag); el.textContent = value; parent.append(el); return el; }
function view(id) { for (const key of ['write','read','settings']) $(key).hidden = key !== id; }
function openDraft(d) { if (dirty && !confirm('Discard unsaved editor changes?')) return; active = d; dirty = false; $('editor').hidden = false; $('markdown').value = d.contentMd; $('note').value = d.note ?? ''; $('draft-heading').textContent = `${d.kind} draft`; $('composition-metadata').value = JSON.stringify({...(d.stubOf ? {stubOf:d.stubOf} : {}), ...(d.generatedSpans?.length ? {generatedSpans:d.generatedSpans} : {})},null,2); view('write'); }
async function save() { active = await studio.saveDraft(active.localId, {contentMd:$('markdown').value,note:$('note').value || null, ...metadata()}); dirty = false; }
function metadata() {
  const value = JSON.parse($('composition-metadata').value || '{}');
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(k => !['stubOf','generatedSpans'].includes(k))) throw new Error('Composition metadata accepts stubOf and generatedSpans only.');
  return {stubOf: undefined, generatedSpans: [], ...value};
}
function render() {
  const s = studio.state;
  $('origin').value = s.publicationIdentity?.origin ?? ''; $('title').value = s.publicationIdentity?.title ?? '';
  $('drafts').replaceChildren();
  for (const d of s.drafts) $('drafts').append(button(`${d.kind}: ${d.contentMd.slice(0,55) || 'Untitled'}`, () => openDraft(d)));
  if (!s.drafts.length) text('p','No drafts yet.', $('drafts'));
  $('published').replaceChildren();
  for (const item of s.publication.items) {
    const box = document.createElement('article'); $('published').append(box);
    text('small',`${item.id} · ${item.versions.length} versions`,box);
    box.append(button('Preview item', () => { showPreview(studio.previewItem(item.id)); }), button('Edit / return', async () => openDraft(await studio.edit(item.id))), button('Pin current version', () => studio.pin(item.id)), button('Withdraw', async () => { if(confirm('Publish a withdrawal endcap? Existing pins remain available.')) await studio.withdraw(item.id); }));
    for (const version of item.versions.filter(v => v.pinned)) box.append(button(`Fork pinned v${version.version}`, async () => openDraft(await studio.forkLocal(item.id,version.version))));
  }
  $('subscriptions').replaceChildren(); const selected = $('filter').value; $('filter').replaceChildren(new Option('All subscriptions',''));
  for (const sub of s.subscriptions) {
    const box = document.createElement('article'); $('subscriptions').append(box); text('small',sub.title || sub.identityOrigin,box);
    box.append(button('Refresh now', () => studio.refresh(sub.id)),button('Unsubscribe', () => studio.unsubscribe(sub.id)));
    const label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.checked = sub.blogrollVisible === true; check.onchange = () => run(() => studio.curate(sub.id, check.checked)); label.append(check, ' Include in public curated blogroll'); box.append(label);
    $('filter').append(new Option(sub.title || sub.identityOrigin,sub.id));
  }
  $('filter').value = selected; renderReader();
}
function renderReader() {
  const s = studio.state; $('reader').replaceChildren();
  for (const row of readerRows(s,{subscription:$('filter').value,since:$('since').value})) {
    const box = document.createElement('article'); $('reader').append(box); text('small',`${row.origin} · ${row.kind} · v${row.version}${row.l0 ? ' · legacy feed' : ''}`,box);
    if (row.discrepancies?.length) text('p',`Source discrepancy: ${row.discrepancies.map(d => d.type).join(', ')}`,box);
    // Untrusted reader HTML is isolated without scripts, forms, or network resources.
    const frame = document.createElement('iframe'); frame.title = 'Imported post'; frame.sandbox = ''; frame.referrerPolicy = 'no-referrer'; frame.srcdoc = isolated(row.kind === 'withdrawn' ? '<p>Withdrawn</p>' : row.contentHtml ?? ''); box.append(frame);
    const key = row.origin + '#' + row.id, feedback = s.feedback.find(f => f.targetKey === key)?.value;
    box.append(button(feedback === 'like' ? 'Liked' : 'Like', () => studio.feedback(row,'like')),button(feedback === 'dislike' ? 'Disliked' : 'Dislike', () => studio.feedback(row,'dislike')));
    const label = document.createElement('label'); label.textContent = 'Private note'; const note = document.createElement('textarea'); note.style.minHeight = '5rem'; note.value = s.notes.find(n => n.targetKey === key)?.text ?? ''; label.append(note); box.append(label,button('Save private note', () => studio.annotate(row,note.value)));
    if (!row.l0 && row.kind !== 'withdrawn') box.append(button('Quote in new thread', async () => { const d = await studio.saveDraft(null,{kind:'thread',contentMd:`![[${row.id}]]`,transclusions:[]}); openDraft(d); }));
    if (row.retainedPinnedVersion && row.pinnedSnapshot) box.append(button('Fork retained pin', async () => openDraft(await studio.fork({...row.pinnedSnapshot,pinned:true,content_md:row.pinnedSnapshot.content_md ?? row.pinnedSnapshot.contentMd,content_html:row.pinnedSnapshot.content_html ?? row.pinnedSnapshot.contentHtml,origin:row.origin,id:row.id,version:row.retainedPinnedVersion}))));
  }
  if (!$('reader').children.length) text('p','No posts in this view. Subscribe or import a feed to begin.', $('reader'));
}
function showPreview(html) { $('preview-frame').srcdoc = isolated(html); $('preview-frame').hidden = false; $('preview-hint').hidden = true; }
function isolated(html) { return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">${html}`; }
for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => view(b.dataset.view);
$('identity').onsubmit = e => { e.preventDefault(); run(() => studio.configure($('origin').value,$('title').value)); };
for (const [id,kind] of [['new','fragment'],['thread','thread']]) $(id).onclick = () => run(async () => { if (dirty && !confirm('Discard unsaved editor changes?')) return; dirty = false; openDraft(await studio.saveDraft(null,{kind,transclusions:kind === 'thread' ? [] : undefined})); });
$('editor').onsubmit = e => { e.preventDefault(); run(save); };
for (const id of ['markdown','note','composition-metadata']) $(id).oninput = () => { dirty = true; status('Unsaved editor changes.'); };
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
$('preview').onclick = () => run(async () => { await save(); showPreview(studio.preview(active)); });
$('publish').onclick = () => run(async () => { await save(); const result = await studio.publish(active.localId); active = null; $('editor').hidden = true; return `Published v${result.version} locally.${result.warnings?.length ? ' ' + JSON.stringify(result.warnings) : ''}`; });
$('discard').onclick = () => run(async () => { if(confirm('Discard this draft?')) { await studio.discard(active.localId); active = null; dirty = false; $('editor').hidden = true; } });
$('subscribe').onsubmit = e => { e.preventDefault(); run(() => studio.subscribe($('subscription-url').value)); };
$('import-feed').onclick = () => run(async () => { const file = $('feed-file').files[0]; if (!file) throw new Error('Choose a feed file.'); await studio.importFeed($('feed-url').value,await file.text()); });
$('filter').onchange = renderReader; $('since').onchange = renderReader;
$('export').onclick = () => run(async () => download(createSiteZip(await studio.exportFiles()),'blyg-site.zip','application/zip'));
$('backup').onclick = () => run(async () => download(await studio.backup(),'blyggerpress-private.json','application/json'));
$('restore-file').onchange = () => run(async () => { restoreText = null; $('restore').hidden = true; const file = $('restore-file').files[0]; if (!file) return; const input = await file.text(); const state = inspectBackup(input); $('restore-preview').textContent = `Replace current library with:\n${state.drafts.length} drafts\n${state.publication.items.length} authored items\n${state.subscriptions.length} subscriptions\n${state.notes.length} private notes`; restoreText = input; $('restore').hidden = false; });
$('restore').onclick = () => run(async () => { if (!restoreText || !confirm('Download your current backup, then replace this entire local library?')) return; download(await studio.backup(),'blyggerpress-before-restore.json','application/json'); await studio.restore(restoreText); active = null; dirty = false; $('editor').hidden = true; $('restore').hidden = true; });
try { const library = await openStore(); studio = createStudio(library,await library.read()); render(); document.querySelector('main').inert = false; if (!studio.state.publicationIdentity?.origin) view('settings'); status('Local library ready.'); } catch(e) { status(`Cannot open library: ${e.message}. Existing data has not been reset.`,true); }
