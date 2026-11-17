import test from 'node:test';
import assert from 'node:assert/strict';
import {testToken,repositoryName,pendingFiles,conflictPaths,commitFiles} from '../src/github.mjs';
import {pullWorkspace} from '../src/sync.mjs';
import {publish,surface} from '../src/protocol.mjs';
test('connection test authenticates without writing; invalid token and network errors are actionable',async()=>{
 const original=globalThis.fetch;const calls=[];
 try{globalThis.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({login:'surya'})};};assert.equal(await testToken(' secret '),'surya');assert.equal(calls[0].url,'https://api.github.com/user');assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.headers.Authorization,'Bearer secret');
 globalThis.fetch=async()=>({ok:false,status:401,json:async()=>({})});await assert.rejects(testToken('bad'),/invalid or expired/);
 globalThis.fetch=async()=>{throw Error('network');};await assert.rejects(testToken('x'),/reach GitHub/);
 }finally{globalThis.fetch=original;}
 assert.equal(repositoryName('https://github.com/owner/repo.git'),'owner/repo');assert.throws(()=>repositoryName('https://evil.com/owner/repo'));
});
test('commit uses base tree and non-force ref update; branch fallback never changes original ref',async()=>{
 const original=globalThis.fetch,calls=[];
 const snap={repo:'owner/repo',branch:'main',head:'old',tree:'tree',folder:'public',files:{}};
 try{globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body),method:options.method});return {ok:true,json:async()=>({sha:'new'})};};
 await commitFiles('token',snap,{'public/post.txt':'text'},'Write');
 assert.equal(calls[0].body.base_tree,'tree');assert.deepEqual(calls[1].body.parents,['old']);assert.equal(calls[2].body.force,false);
 calls.length=0;const result=await commitFiles('token',snap,{'public/post.txt':'text'},'Write',{branch:true});assert.match(result.url,/compare/);assert.match(calls[2].body.ref,/refs\/heads\/blyggerpress\//);assert.ok(!calls.some(c=>c.method==='PATCH'));
 }finally{globalThis.fetch=original;}
});
test('draft changes include deletions and preserve all unrelated paths',()=>{
 const b={files:{},drafts:[{id:'a',body:'new'}],remote:{folder:'public',draftPrefix:'.blyggerpress/drafts/public/',files:{'.blyggerpress/drafts/public/a.json':'old','.blyggerpress/drafts/public/b.json':'old','unrelated':'keep'}}};
 const changes=pendingFiles(b);assert.equal(changes['.blyggerpress/drafts/public/b.json'],null);assert.ok(!Object.hasOwn(changes,'unrelated'));assert.deepEqual(conflictPaths({a:'old'},{a:'remote'},{a:'local'}),['a']);
});
test('pull combines independent posts and rebuilds indexes; concurrent same-post edits stop without mutation',async()=>{
 const settings={title:'Notes',author:'Author',origin:'https://example.com/'};
 const first=await publish({body:'# First',origin:settings.origin,author:'Author'});
 const second=await publish({body:'# Second',origin:settings.origin,author:'Author'});
 const third=await publish({body:'# Third',origin:settings.origin,author:'Author'});
 const base={folder:'public',draftPrefix:'.blyggerpress/drafts/public/',files:Object.fromEntries(Object.entries(surface([first],settings)).map(([p,v])=>['public/'+p,v])),items:[first],drafts:[],manifest:JSON.parse(surface([first],settings)['blyg.json']),siteSettings:{}};
 const local={settings,remote:base,items:[first,second],drafts:[],files:surface([first,second],settings)};
 const latest={...base,items:[first,third],files:Object.fromEntries(Object.entries(surface([first,third],settings)).map(([p,v])=>['public/'+p,v]))};
 const merged=pullWorkspace(local,latest);assert.equal(merged.items.length,3);assert.equal(JSON.parse(merged.files['items/index.json']).items.length,3);
 const left=await publish({body:'left',previous:first,origin:settings.origin,author:'Author'}),right=await publish({body:'right',previous:first,origin:settings.origin,author:'Author'});
 assert.throws(()=>pullWorkspace({...local,items:[left],files:surface([left],settings)},{...latest,items:[right],files:Object.fromEntries(Object.entries(surface([right],settings)).map(([p,v])=>['public/'+p,v]))}),/overlap/);
 assert.equal(local.items.length,2);
});
test('empty repository opens read-only and initializes only on explicit commit',async()=>{
 const {inspectRepository,readSnapshot}=await import('../src/github.mjs');
 const original=globalThis.fetch,calls=[];
 try{globalThis.fetch=async(url,options)=>{
  const body=options.body?JSON.parse(options.body):null;calls.push({url,method:options.method,body});
  if(url.endsWith('/repos/owner/empty'))return {ok:true,json:async()=>({default_branch:'main',permissions:{push:true}})};
  if(url.includes('/git/ref/heads/'))return {ok:false,status:409,json:async()=>({message:'Git Repository is empty.'})};
  if(url.includes('/branches?'))return {ok:true,json:async()=>([])};
  if(url.includes('/contents/'))return {ok:true,json:async()=>({commit:{sha:'initial',tree:{sha:'initial-tree'},parents:[]}})};
  return {ok:true,json:async()=>({sha:'new'})};
 };
 const snapshot=await readSnapshot('token',await inspectRepository('token','owner/empty'),'public');
 assert.equal(snapshot.head,null);assert.deepEqual(snapshot.items,[]);assert.ok(calls.every(c=>c.method==='GET'));
 calls.length=0;
 await commitFiles('token',snapshot,{'public/index.html':'hello'},'First publication');
 const writes=calls.filter(c=>c.method!=='GET');
 assert.equal(writes[0].method,'PUT');assert.match(writes[0].url,/contents\/\.blyggerpress\/README.md$/);
 assert.equal(writes[1].body.base_tree,'initial-tree');assert.deepEqual(writes[2].body.parents,['initial']);assert.equal(writes[3].body.force,false);
 calls.length=0;await assert.rejects(commitFiles('token',snapshot,{'public/index.html':'hello'},'First',{branch:true}),/first commit/);assert.equal(calls.length,0);
 }finally{globalThis.fetch=original;}
});
test('a missing branch in an existing repository is not treated as an empty repository',async()=>{
 const {inspectRepository}=await import('../src/github.mjs');const original=globalThis.fetch;
 try{globalThis.fetch=async url=>url.endsWith('/repos/owner/repo')?{ok:true,json:async()=>({default_branch:'main'})}:url.includes('/branches?')?{ok:true,json:async()=>[{name:'main'}]}:{ok:false,status:404,json:async()=>({message:'Not Found'})};
 await assert.rejects(inspectRepository('token','owner/repo','typo'),/branch not found/);
 }finally{globalThis.fetch=original;}
});
test('initialization race stops before writing publication files',async()=>{
 const original=globalThis.fetch,calls=[];
 try{globalThis.fetch=async(url,options)=>{calls.push(url);
 if(url.endsWith('/repos/owner/empty'))return {ok:true,json:async()=>({default_branch:'main'})};
 if(url.includes('/git/ref/heads/'))return {ok:false,status:409,json:async()=>({message:'empty'})};
 if(url.includes('/branches?'))return {ok:true,json:async()=>[]};
 return {ok:true,json:async()=>({commit:{sha:'initial',tree:{sha:'tree'},parents:[{sha:'concurrent'}]}})};
 };
 await assert.rejects(commitFiles('token',{repo:'owner/empty',branch:'main',head:null,folder:'public',files:{}},{'public/index.html':'local'},'First'),/changed during initialization/);
 assert.ok(!calls.some(url=>url.includes('/git/trees')));
 }finally{globalThis.fetch=original;}
});
test('nested publication output keeps draft and project sources outside it and reloads source settings',async()=>{
 const {readSnapshot,projectSettingsPath}=await import('../src/github.mjs');
 const folder='website/public/notes',settings={title:'Source title',author:'Writer',origin:'https://example.com/notes/',navigation:'About | /about'};
 const path=projectSettingsPath(folder),draftPrefix='.blyggerpress/drafts/'+encodeURIComponent(folder)+'/';
 const content=JSON.stringify({publicationFolder:folder,settings},null,2)+'\n';
 const original=globalThis.fetch;
 try{globalThis.fetch=async()=>({ok:true,json:async()=>({encoding:'base64',content:Buffer.from(content).toString('base64')})});
 const remote=await readSnapshot('token',{repo:'owner/repo',entries:[{type:'blob',path,sha:'settings'}]},folder);
 assert.deepEqual(remote.projectSettings,settings);assert.equal(remote.settingsPath,path);
 const pending=pendingFiles({remote,settings,drafts:[{id:'draft',body:'Unpublished text'}],files:{'index.html':'public page'}});
 assert.equal(pending[folder+'/index.html'],'public page');assert.ok(pending[draftPrefix+'draft.json']);assert.ok(!Object.hasOwn(pending,path));
 const edited=pendingFiles({remote,settings:{...settings,title:'Changed'},drafts:[],files:{}});
 assert.equal(JSON.parse(edited[path]).settings.title,'Changed');assert.ok(!path.startsWith(folder+'/'));
 }finally{globalThis.fetch=original;}
});
