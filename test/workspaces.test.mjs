import test from 'node:test';
import assert from 'node:assert/strict';
import {nextBlogId,integerBlogIds,emptyBlog,loadWorkspaces,updateBlog,storageKey} from '../src/workspaces.mjs';
const storage = values => ({getItem:key=>values[key]??null});
test('migrates existing drafts and publication queue without changing legacy storage',()=>{
 const legacy={...emptyBlog('Original'),drafts:[{id:'draft',body:'private text'}],files:{'feed.xml':'feed'},staged:['feed.xml']};
 const values={'blyggerpress-v1':JSON.stringify(legacy)};
 const result=loadWorkspaces(storage(values));
 assert.deepEqual(result.blogs[result.active],legacy);
 assert.equal(values['blyggerpress-v1'],JSON.stringify(legacy));
});
test('switching, updating and reloading keeps blyg content and repository settings isolated',()=>{
 const first={...emptyBlog('First'),files:{'feed.xml':'first'},repository:{mode:'local',repo:'/first',folder:'notes'}};
 let state={active:'first',blogs:{first,second:emptyBlog('Second')}};
 state={...state,active:'second'};
 state=updateBlog(state,state.active,b=>({...b,drafts:[{id:'second-draft',body:'Second only'}]}));
 const restored=loadWorkspaces(storage({[storageKey]:JSON.stringify(state)}));
 assert.equal(restored.active,'2');
 assert.deepEqual(restored.blogs[1],first);
 assert.equal(restored.blogs[2].drafts[0].body,'Second only');
 assert.deepEqual(restored.blogs[2].files,{});
});

test('integer migration retains existing IDs and resolves old links without losing data',()=>{
 const a=emptyBlog('Original'),b=emptyBlog('Second');
 const migrated=integerBlogIds({active:'default',blogs:{default:a,'4':b}});
 assert.equal(migrated.active,'5');assert.equal(migrated.aliases.default,'5');
 assert.deepEqual(migrated.blogs['5'],a);assert.deepEqual(migrated.blogs['4'],b);
 assert.equal(nextBlogId(migrated.blogs),'6');
 assert.deepEqual(integerBlogIds(migrated),migrated);
});

test('remove and undo preserve unpublished work without affecting other blygs',async()=>{
 const {removeBlog,restoreBlog}=await import('../src/workspaces.mjs');
 const a={settings:{title:'A'},drafts:[{body:'unsynced'}],files:{'index.html':'pending'}},b={settings:{title:'B'}};
 const state={active:'1',blogs:{'1':a,'2':b}};
 const removed=removeBlog(state,'1');assert.equal(removed.active,'2');assert.equal(removed.blogs['1'],undefined);assert.deepEqual(removed.blogs['2'],b);
 const restored=restoreBlog(JSON.parse(JSON.stringify(removed)),'1');assert.deepEqual(restored.blogs['1'],a);assert.equal(restored.active,'1');
 const last=removeBlog({active:'1',blogs:{'1':a}},'1');assert.ok(last.blogs[last.active]);assert.deepEqual(restoreBlog(last,'1').blogs['1'],a);
});

test('first-run placeholders are hidden without hiding real or unsynced workspaces',async()=>{
 const {emptyBlog,isEmptyWorkspace}=await import('../src/workspaces.mjs');
 assert.equal(emptyBlog().settings.title,'My Blyg');
 assert.ok(isEmptyWorkspace(emptyBlog()));assert.ok(isEmptyWorkspace(emptyBlog('My blog')));
 assert.equal(isEmptyWorkspace({...emptyBlog(),drafts:[{body:'keep'}]}),false);
 assert.equal(isEmptyWorkspace({...emptyBlog(),files:{'index.html':'keep'}}),false);
 assert.equal(isEmptyWorkspace({...emptyBlog(),remote:{repo:'owner/repo'}}),false);
 assert.equal(isEmptyWorkspace(emptyBlog('My actual notes')),false);
});
