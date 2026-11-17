import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {connect,stage,safeRelative} from '../scripts/companion.mjs';
const exec=promisify(execFile);
test('Git staging preserves unrelated index entries, permits more posts, rejects outside edits',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'blygger-test-'));const git=async(...args)=>(await exec('git',['-C',root,...args])).stdout;
 try{await git('init');await writeFile(path.join(root,'unrelated.txt'),'keep me');await git('add','unrelated.txt');
 await connect({mode:'local',repo:root,folder:'public/nested/notes'});
 await stage({files:{'blyg.json':'{"title":"first"}\n','feed.xml':'first','items/index.json':'{"items":[]}', 'index.html':'<meta name="generator" content="BlyggerPress">','archive/index.html':'<meta name="generator" content="BlyggerPress">','blyggerpress.json':'{"navigation":"About | /about","profileImage":"/photo.jpg"}'}});
 assert.match(await git('diff','--cached','--name-only'),/unrelated.txt/);assert.equal(await git('show',':public/nested/notes/feed.xml'),'first');
 await stage({files:{'blyg.json':'{"title":"second"}\n','feed.xml':'second'}});assert.equal(await git('show',':public/nested/notes/feed.xml'),'second');
 await writeFile(path.join(root,'public/nested/notes/feed.xml'),'outside edit');await assert.rejects(stage({files:{'feed.xml':'third'}}),/Conflict/);assert.equal(await readFile(path.join(root,'public/nested/notes/feed.xml'),'utf8'),'outside edit');
 const reconnected=await connect({mode:'local',repo:root,folder:'public/nested/notes'});assert.equal(reconnected.siteSettings.profileImage,'/photo.jpg');await writeFile(path.join(root,'public/nested/notes/index.html'),'hand-written homepage');await connect({mode:'local',repo:root,folder:'public/nested/notes'});await assert.rejects(stage({files:{'index.html':'replacement'}}),/not generated/);assert.equal(await readFile(path.join(root,'public/nested/notes/index.html'),'utf8'),'hand-written homepage');await assert.rejects(git('rev-parse','HEAD'));assert.equal(await git('show',':unrelated.txt'),'keep me');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('traversal and symbolic publication folders are rejected',async()=>{for(const p of ['../x','/etc/passwd','x/.git/config','a\\b','a//b'])assert.throws(()=>safeRelative(p));const root=await mkdtemp(path.join(os.tmpdir(),'blygger-link-'));try{await exec('git',['-C',root,'init']);await symlink(os.tmpdir(),path.join(root,'linked'));await assert.rejects(connect({mode:'local',repo:root,folder:'linked/blog'}),/Symbolic links/);}finally{await rm(root,{recursive:true,force:true});}});
