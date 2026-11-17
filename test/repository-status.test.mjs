import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {connect,repositoryStatus} from '../scripts/companion.mjs';
const exec=promisify(execFile);
test('status distinguishes browser, disk, Git index and committed content',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'blygger-status-'));
 const git=async(...args)=>(await exec('git',['-C',root,...args])).stdout;
 try{
  await git('init');await mkdir(path.join(root,'public'));
  const c=await connect({mode:'local',repo:root,folder:'public'});
  const read=async()=> (await repositoryStatus({connectionId:c.connectionId,files:{'feed.xml':'expected'}})).files['feed.xml'];
  assert.match(await read(),/Browser only/);
  await writeFile(path.join(root,'public/feed.xml'),'expected');assert.match(await read(),/not staged/);
  await git('add','public/feed.xml');assert.equal(await read(),'Git staged');
  await git('-c','user.name=Test','-c','user.email=test@example.com','-c','core.hooksPath=/dev/null','commit','--no-gpg-sign','-m','fixture');
  assert.match(await read(),/no staged change/);
  await writeFile(path.join(root,'public/feed.xml'),'external');assert.match(await read(),/differs/);
  await assert.rejects(repositoryStatus({connectionId:'expired',files:{}}),/Reconnect/);
  await assert.rejects(repositoryStatus({connectionId:c.connectionId,files:{'../escape':'bad'}}),/Invalid/);
 }finally{await rm(root,{recursive:true,force:true});}
});
