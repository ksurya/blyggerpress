import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,symlink,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';
import {connect,saveDrafts} from '../scripts/companion.mjs';
const exec=promisify(execFile);
test('repository drafts survive reconnect, stay out of index, isolate folders and detect external edits',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'blygger-drafts-'));
 try{
  await exec('git',['-C',root,'init']);
  const first=await connect({mode:'local',repo:root,folder:'public/blog'});
  const drafts=[{id:'00000000000000000000000001',body:'unpublished',updated:'2026-11-17'}];
  await saveDrafts({connectionId:first.connectionId,drafts});
  assert.deepEqual(JSON.parse(await readFile(path.join(root,first.draftPath),'utf8')).drafts,drafts);
  assert.equal((await exec('git',['-C',root,'diff','--cached','--name-only'])).stdout,'');
  const second=await connect({mode:'local',repo:root,folder:'public/other'});
  assert.deepEqual(second.drafts,[]);
  await assert.rejects(saveDrafts({connectionId:first.connectionId,drafts:[]}),/connection changed/);
  const again=await connect({mode:'local',repo:root,folder:'public/blog'});
  assert.deepEqual(again.drafts,drafts);
  await saveDrafts({connectionId:again.connectionId,drafts:[]});
  assert.deepEqual((await connect({mode:'local',repo:root,folder:'public/blog'})).drafts,[]);
  const current=await connect({mode:'local',repo:root,folder:'public/blog'});
  await writeFile(path.join(root,current.draftPath),'external edit');
  await assert.rejects(saveDrafts({connectionId:current.connectionId,drafts}),/changed outside/);
  assert.equal(await readFile(path.join(root,current.draftPath),'utf8'),'external edit');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('draft directory symlinks are rejected',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'blygger-drafts-link-'));
 try{await exec('git',['-C',root,'init']);await mkdir(path.join(root,'.blyggerpress'));await symlink(os.tmpdir(),path.join(root,'.blyggerpress/drafts'));await assert.rejects(connect({mode:'local',repo:root,folder:''}),/Symbolic links/);}
 finally{await rm(root,{recursive:true,force:true});}
});
