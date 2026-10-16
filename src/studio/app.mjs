import { openStore, inspectBackup } from './store.mjs';
import { createStudio, readerRows } from './controller.mjs';
import { createSiteZip } from '../blyg/index.mjs';
const $ = id => document.getElementById(id);
const CANCEL = Symbol('cancel');
let studio, active, restoreText, busy = false, dirty = false;
// Working buffers keep per-field input the user has typed but not yet saved.
// render() rebuilds persisted fields from state, so a buffer is applied first
// and only dropped once the field is saved or its value matches the last render.
const buffers = new Map();
const fieldKey = el => el?.dataset?.field ?? null;
function hasUnsaved() { return dirty || buffers.size > 0; }
function clearBuffers() { buffers.clear(); }
function setField(el, saved) { const key = fieldKey(el); el.dataset.saved = saved; el.value = key && buffers.has(key) ? buffers.get(key) : saved; }
function watch(el) {
  el.oninput = () => {
    const key = fieldKey(el);
    if (el.value === el.dataset.saved) buffers.delete(key); else buffers.set(key, el.value);
    status(hasUnsaved() ? 'Unsaved changes.' : 'No unsaved changes.');
  };
}
function captureFocus() { const el = document.activeElement, key = fieldKey(el); return key ? { key, start: el.selectionStart, end: el.selectionEnd } : null; }
function restoreFocus(focus) {
  if (!focus) return;
  const el = [...document.querySelectorAll('[data-field]')].find(e => fieldKey(e) === focus.key);
  if (el) { el.focus(); try { if (focus.start != null) el.setSelectionRange(focus.start, focus.end); } catch {} }
}
function status(text, error = false) { $('status').textContent = text; $('status').className = error ? 'error' : ''; }
function download(body, filename, type) { const url = URL.createObjectURL(new Blob([body], {type})); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
async function run(fn) {
  if (busy) return;
  const focus = captureFocus();
  busy = true; document.querySelector('main').inert = true;
  try {
    const message = await fn();
    if (message !== CANCEL) { render(); status(typeof message === 'string' ? message : 'Saved in this browser.'); }
  }
  catch (e) { status(e.message, true); }
  finally { busy = false; document.querySelector('main').inert = false; restoreFocus(focus); }
}
function button(text, action) { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = () => run(action); return b; }
function text(tag, value, parent) { const el = document.createElement(tag); el.textContent = value; parent.append(el); return el; }
function view(id) { for (const key of ['write','read','settings']) $(key).hidden = key !== id; }
// Editor changes are the only ones that must be confirmed before a draft switch.
function confirmDiscard() { return !dirty || confirm('Discard unsaved editor changes?'); }
function openDraft(d, approved = false) {
  if (!approved && !confirmDiscard()) return false;
  active = d; dirty = false; $('editor').hidden = false; $('markdown').value = d.contentMd; $('note').value = d.note ?? ''; $('draft-heading').textContent = `${d.kind} draft`; $('composition-metadata').value = JSON.stringify({...(d.stubOf ? {stubOf:d.stubOf} : {}), ...(d.generatedSpans?.length ? {generatedSpans:d.generatedSpans} : {})},null,2); view('write'); return true;
}
async function save() { active = await studio.saveDraft(active.localId, {contentMd:$('markdown').value,note:$('note').value || null, ...metadata()}); dirty = false; }
function metadata() {
  const value = JSON.parse($('composition-metadata').value || '{}');
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(k => !['stubOf','generatedSpans'].includes(k))) throw new Error('Composition metadata accepts stubOf and generatedSpans only.');
  return {stubOf: undefined, generatedSpans: [], ...value};
}
function render() {
  const s = studio.state;
  setField($('origin'), s.publicationIdentity?.origin ?? ''); setField($('title'), s.publicationIdentity?.title ?? '');
  $('drafts').replaceChildren();
  for (const d of s.drafts) $('drafts').append(button(`${d.kind}: ${d.contentMd.slice(0,55) || 'Untitled'}`, () => openDraft(d) ? undefined : CANCEL));
  if (!s.drafts.length) text('p','No drafts yet.', $('drafts'));
  $('published').replaceChildren();
  for (const item of s.publication.items) {
    const box = document.createElement('article'); $('published').append(box);
    text('small',`${item.id} · ${item.versions.length} versions`,box);
    box.append(button('Preview item', () => { showPreview(studio.previewItem(item.id)); }), button('Edit / return', async () => { if (!confirmDiscard()) return CANCEL; openDraft(await studio.edit(item.id), true); }), button('Pin current version', () => studio.pin(item.id)), button('Withdraw', () => confirm('Publish a withdrawal endcap? Existing pins remain available.') ? studio.withdraw(item.id) : CANCEL));
    for (const version of item.versions.filter(v => v.pinned)) box.append(button(`Fork pinned v${version.version}`, async () => { if (!confirmDiscard()) return CANCEL; openDraft(await studio.forkLocal(item.id,version.version), true); }));
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
    const label = document.createElement('label'); label.textContent = 'Private note'; const note = document.createElement('textarea'); note.dataset.field = 'note:' + key; note.style.minHeight = '5rem'; setField(note, s.notes.find(n => n.targetKey === key)?.text ?? ''); watch(note); label.append(note); box.append(label,button('Save private note', async () => { await studio.annotate(row,note.value); buffers.delete(note.dataset.field); }));
    if (!row.l0 && row.kind !== 'withdrawn') box.append(button('Quote in new thread', async () => { if (!confirmDiscard()) return CANCEL; openDraft(await studio.saveDraft(null,{kind:'thread',contentMd:`![[${row.id}]]`,transclusions:[]}), true); }));
    if (row.retainedPinnedVersion && row.pinnedSnapshot) box.append(button('Fork retained pin', async () => { if (!confirmDiscard()) return CANCEL; openDraft(await studio.fork({...row.pinnedSnapshot,pinned:true,content_md:row.pinnedSnapshot.content_md ?? row.pinnedSnapshot.contentMd,content_html:row.pinnedSnapshot.content_html ?? row.pinnedSnapshot.contentHtml,origin:row.origin,id:row.id,version:row.retainedPinnedVersion}), true); }));
  }
  if (!$('reader').children.length) text('p','No posts in this view. Subscribe or import a feed to begin.', $('reader'));
}
function showPreview(html) { $('preview-frame').srcdoc = isolated(html); $('preview-frame').hidden = false; $('preview-hint').hidden = true; }
function isolated(html) { return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">${html}`; }
for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => view(b.dataset.view);
for (const el of [$('origin'), $('title'), $('subscription-url'), $('feed-url')]) { el.dataset.saved = el.value; watch(el); }
$('identity').onsubmit = e => { e.preventDefault(); run(async () => { await studio.configure($('origin').value,$('title').value); buffers.delete('origin'); buffers.delete('title'); }); };
for (const [id,kind] of [['new','fragment'],['thread','thread']]) $(id).onclick = () => run(async () => { if (!confirmDiscard()) return CANCEL; openDraft(await studio.saveDraft(null,{kind,transclusions:kind === 'thread' ? [] : undefined}), true); });
$('editor').onsubmit = e => { e.preventDefault(); run(save); };
for (const id of ['markdown','note','composition-metadata']) $(id).oninput = () => { dirty = true; status('Unsaved editor changes.'); };
window.addEventListener('beforeunload', e => { if (hasUnsaved()) { e.preventDefault(); e.returnValue = ''; } });
$('preview').onclick = () => run(async () => { await save(); showPreview(studio.preview(active)); });
$('publish').onclick = () => run(async () => { await save(); const result = await studio.publish(active.localId); active = null; $('editor').hidden = true; return `Published v${result.version} locally.${result.warnings?.length ? ' ' + JSON.stringify(result.warnings) : ''}`; });
$('discard').onclick = () => run(async () => { if (!confirm('Discard this draft?')) return CANCEL; await studio.discard(active.localId); active = null; dirty = false; $('editor').hidden = true; });
$('subscribe').onsubmit = e => { e.preventDefault(); run(async () => { await studio.subscribe($('subscription-url').value); buffers.delete('subscription-url'); $('subscription-url').dataset.saved = $('subscription-url').value; }); };
$('import-feed').onclick = () => run(async () => { const file = $('feed-file').files[0]; if (!file) throw new Error('Choose a feed file.'); await studio.importFeed($('feed-url').value,await file.text()); buffers.delete('feed-url'); $('feed-url').dataset.saved = $('feed-url').value; });
$('filter').onchange = renderReader; $('since').onchange = renderReader;
$('export').onclick = () => run(async () => download(createSiteZip(await studio.exportFiles()),'blyg-site.zip','application/zip'));
$('backup').onclick = () => run(async () => download(await studio.backup(),'blyggerpress-private.json','application/json'));
$('restore-file').onchange = () => run(async () => { restoreText = null; $('restore').hidden = true; const file = $('restore-file').files[0]; if (!file) return; const input = await file.text(); const state = inspectBackup(input); $('restore-preview').textContent = `Replace current library with:\n${state.drafts.length} drafts\n${state.publication.items.length} authored items\n${state.subscriptions.length} subscriptions\n${state.notes.length} private notes`; restoreText = input; $('restore').hidden = false; });
$('restore').onclick = () => run(async () => {
  if (!restoreText) return CANCEL;
  const warning = hasUnsaved() ? ' Unsaved input in this session will be lost.' : '';
  if (!confirm(`Download your current backup, then replace this entire local library?${warning}`)) return CANCEL;
  download(await studio.backup(),'blyggerpress-before-restore.json','application/json'); await studio.restore(restoreText); active = null; dirty = false; clearBuffers(); $('editor').hidden = true; $('restore').hidden = true; for (const id of ['subscription-url','feed-url']) { $(id).value = ''; $(id).dataset.saved = ''; }
});
try { const library = await openStore(); studio = createStudio(library,await library.read()); render(); document.querySelector('main').inert = false; if (!studio.state.publicationIdentity?.origin) view('settings'); status('Local library ready.'); } catch(e) { status(`Cannot open library: ${e.message}. Existing data has not been reset.`,true); }
