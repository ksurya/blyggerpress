import test from 'node:test';
import assert from 'node:assert/strict';
import {relocateWorkspace,cancelFolderChange} from '../src/relocate.mjs';
import {pendingFiles,projectSettingsPath} from '../src/github.mjs';
const settings={title:'Notes',author:'Writer',origin:'https://example.com/notes/'};
function fixture(){return {settings,items:[],drafts:[{id:'draft',body:'keep'}],files:{},manifest:null,remote:{folder:'public',head:'base',files:{'public/index.html':'old site','.blyggerpress/drafts/public/draft.json':'old draft',[projectSettingsPath('public')]:'old settings'},draftPrefix:'.blyggerpress/drafts/public/'},repository:{folder:'public'}};}
const target={folder:'docs/notes',head:'base',entries:[],files:{},drafts:[],manifest:null,projectSettings:null,draftPrefix:'.blyggerpress/drafts/docs%2Fnotes/'};
test('folder change stages new output and moves sources while preserving old published pages',()=>{
 const original=fixture(),moved=relocateWorkspace(original,target),pending=pendingFiles(moved);
 assert.ok(pending['docs/notes/index.html']);assert.equal(pending['public/index.html'],undefined);
 assert.equal(pending['.blyggerpress/drafts/public/draft.json'],null);
 assert.ok(pending['.blyggerpress/drafts/docs%2Fnotes/draft.json']);
 assert.ok(pending[projectSettingsPath('docs/notes')]);assert.equal(pending[projectSettingsPath('public')],null);
 assert.equal(moved.settings.origin,settings.origin);assert.equal(original.remote.folder,'public');
});
test('folder changes reject occupied output, existing blygs, stale bases and reserved directory',()=>{
 assert.throws(()=>relocateWorkspace(fixture(),{...target,entries:[{path:'docs/notes/index.html'}]}),/already contains/);
 assert.throws(()=>relocateWorkspace(fixture(),{...target,manifest:{}}),/already belongs/);
 assert.throws(()=>relocateWorkspace(fixture(),{...target,head:'new'}),/Pull latest/);
 assert.throws(()=>relocateWorkspace(fixture(),{...target,folder:'.blyggerpress/public'}),/outside/);
});

test('cancel restores original paths without losing later draft and settings edits',()=>{
 const moved=relocateWorkspace(fixture(),target);
 moved.drafts=[{id:'draft',body:'edited after moving'}];moved.settings={...moved.settings,title:'New title'};
 const restored=cancelFolderChange(moved),pending=pendingFiles(restored);
 assert.equal(restored.remote.folder,'public');assert.equal(restored.drafts[0].body,'edited after moving');assert.equal(restored.settings.title,'New title');
 assert.equal(restored.folderMove,undefined);assert.ok(pending['public/index.html']);assert.ok(!Object.keys(pending).some(p=>p.startsWith('docs/notes/')));
});
