import http from 'node:http';
import {readFile,writeFile,mkdir,rename,lstat,realpath,rm,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),token=randomBytes(32).toString('hex'),port=Number(process.env.PORT||4318),host=`http://127.0.0.1:${port}`;
const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');let connection;
const git=async(root,args)=>(await exec('git',['-C',root,...args],{maxBuffer:16*1024*1024,timeout:120000,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}})).stdout;
export function safeRelative(p){if(typeof p!=='string'||!p||p.startsWith('/')||p.includes('\\')||p.split('/').some(x=>!x||x==='..'||x==='.'||x.toLowerCase()==='.git')||/[\x00-\x1f]/.test(p))throw Error('Invalid relative path.');return p;}
async function safePath(root,rel){safeRelative(rel);let cur=root;for(const part of rel.split('/')){cur=path.join(cur,part);try{if((await lstat(cur)).isSymbolicLink())throw Error('Symbolic links are not supported in the publication folder.');}catch(e){if(e.code!=='ENOENT')throw e;}}return cur;}
async function readMaybe(p){try{return await readFile(p,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export async function connect(data){
 let root;
 if(data.mode==='github'){
  if(!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/.test(data.repo))throw Error('Enter an HTTPS GitHub repository URL. Private repositories use your installed Git credential helper.');
  const clones=path.join(os.homedir(),'.blyggerpress','repositories');await mkdir(clones,{recursive:true});root=await mkdtemp(path.join(clones,'blog-'));await exec('git',['clone','--',data.repo,root],{timeout:120000,maxBuffer:8*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
 }else{if(!path.isAbsolute(data.repo))throw Error('Enter the absolute path to a local Git repository.');root=await realpath(data.repo);}
 const top=(await git(root,['rev-parse','--show-toplevel'])).trim();root=await realpath(top);
 const folder=(data.folder||'').replace(/^\/+|\/+$/g,'');const dest=folder?await safePath(root,folder):root;
 const baseline=new Map();const get=async rel=>{const value=await readMaybe(await safePath(dest,rel));baseline.set(rel,value);return value;};
 const manifestText=await get('blyg.json');let manifest=manifestText?JSON.parse(manifestText):null;let items=[];
 if(manifest){for(const [k,d] of Object.entries({feed:'feed.xml',items:'items/index.json',item:'items/{id}.json',pin:'items/{id}/v{n}.json'}))if(manifest[k]&&manifest[k]!==d)throw Error('This blog uses relocated protocol paths. Import is not supported yet; choose its default-path publication folder.');
 const index=JSON.parse(await get('items/index.json'));for(const row of index.items){if(!/^[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$/.test(row.id))throw Error('Invalid item ID in archive.');const item=JSON.parse(await get(`items/${row.id}.json`));if(item.id!==row.id||item.version!==row.version)throw Error('Archive and item mismatch; repair the blog before editing.');if(!item.page||!item.page.endsWith('/'))throw Error('This item uses an unsupported permalink layout.');await get(item.page+'index.html');items.push(item);}
 }
 await get('feed.xml');
 await get('index.html');await get('archive/index.html');
 const siteText=await get('blyggerpress.json');const siteSettings=siteText?JSON.parse(siteText):null;
 const draftPath=await safePath(root,`.blyggerpress/drafts/${createHash('sha256').update(folder).digest('hex').slice(0,16)}.json`);
 const draftText=await readMaybe(draftPath);const drafts=draftText?JSON.parse(draftText).drafts:[];
 if(!Array.isArray(drafts))throw Error('Invalid repository draft store.');
 const connectionId=randomBytes(16).toString('hex');
 connection={root,dest,folder,baseline,manifest,owned:new Map(),draftPath,draftText,connectionId};return {root,folder,manifest,siteSettings,items,drafts,connectionId,draftPath:path.relative(root,draftPath),branch:(await git(root,['branch','--show-current'])).trim()};
}
export async function stage(data){
 if(!connection)throw Error('Connect a repository first.');if(data.connectionId&&data.connectionId!==connection.connectionId)throw Error('Repository connection changed. Reconnect before publishing.');const {root,dest,folder,baseline}=connection;
 const entries=Object.entries(data.files||{});if(!entries.length||entries.length>10000)throw Error('Invalid file batch.');
 const paths=[];for(const [rel,content]of entries){safeRelative(rel);if(typeof content!=='string'||Buffer.byteLength(content)>5e6)throw Error('Invalid file content.');if(!['blyg.json','feed.xml','items/index.json','index.html','blyggerpress.json'].includes(rel)&&!/^items\/[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}(?:\/v[1-9][0-9]*)?\.json$/.test(rel)&&!rel.endsWith('/index.html'))throw Error('Unsupported publication path.');
 const absolute=await safePath(dest,rel);const current=await readMaybe(absolute),expected=baseline.get(rel)??null;
 if(['index.html','archive/index.html'].includes(rel)&&current!==null&&current!==content&&!current.includes('<meta name="generator" content="BlyggerPress">'))throw Error(`Existing ${rel} was not generated by BlyggerPress. Move or rename it before generating your blyg pages.`);
 if(current!==expected)throw Error(`Conflict: ${rel} changed since connection. Reconnect before publishing.`);
 if(/\/v\d+\.json$/.test(rel)&&current!==null&&current!==content)throw Error('Pinned versions are immutable.');
 if(current!==content)paths.push({rel,absolute,content,before:current,gitPath:(folder?folder+'/':'')+rel});}
 if(!paths.length)return {paths:[],root};
 // Only explicit output paths enter the index. No commit, push, reset or git add .
 const staged=await git(root,['diff','--cached','--name-only','--',...paths.map(p=>p.gitPath)]);
 for(const name of staged.trim().split('\n').filter(Boolean)){const content=await git(root,['show',':'+name]);if(connection.owned.get(name)!==content)throw Error('An output file has independently staged changes. Commit or unstage it manually, then reconnect.');}
 const backups=[];
 try{for(const p of paths){await mkdir(path.dirname(p.absolute),{recursive:true});await writeFile(p.absolute,p.content);backups.push(p);}await git(root,['add','--',...paths.map(p=>p.gitPath)]);}catch(e){for(const p of backups){if(p.before===null)await rm(p.absolute,{force:true});else await writeFile(p.absolute,p.before);}throw e;}
 for(const p of paths){baseline.set(p.rel,p.content);connection.owned.set(p.gitPath,p.content);}return {paths:paths.map(p=>p.gitPath),root};
}
let draftQueue=Promise.resolve();
export function saveDrafts(data){
 const operation=draftQueue.then(async()=>{
  const c=connection;
  if(!c||data.connectionId!==c.connectionId)throw Error('Repository connection changed. Reconnect to save drafts.');
  if(!Array.isArray(data.drafts)||data.drafts.length>10000||data.drafts.some(d=>!d||!/^([0-7][0-9abcdefghjkmnpqrstvwxyz]{25})$/.test(d.id)||typeof d.body!=='string'))throw Error('Invalid drafts.');
  const file=await safePath(c.root,path.relative(c.root,c.draftPath));
  if(await readMaybe(file)!==c.draftText)throw Error('Repository drafts changed outside this editor. Reconnect to merge them.');
  const content=JSON.stringify({folder:c.folder,drafts:data.drafts},null,2)+'\n';
  if(Buffer.byteLength(content)>20e6)throw Error('Draft storage exceeds 20 MB.');
  await mkdir(path.dirname(file),{recursive:true});
  const temp=file+'.'+randomBytes(8).toString('hex')+'.tmp';
  try{await writeFile(temp,content,{flag:'wx',mode:0o600});await rename(temp,file);}finally{await rm(temp,{force:true});}
  c.draftText=content;return {saved:true};
 });
 draftQueue=operation.catch(()=>{});return operation;
}
export async function repositoryStatus(data){
 const c=connection;if(!c||c.connectionId!==data.connectionId)throw Error('Repository connection changed. Reconnect in Settings.');
 const files={};
 for(const [rel,content] of Object.entries(data.files||{})){
  if(typeof content!=='string')throw Error('Invalid file content.');
  const absolute=await safePath(c.dest,rel);const disk=await readMaybe(absolute);
  const gitPath=(c.folder?c.folder+'/':'')+rel;
  let index=null;try{index=await git(c.root,['show',':'+gitPath]);}catch{}
  const changed=(await git(c.root,['diff','--cached','--name-only','--',gitPath])).trim();
  files[rel]=disk===null?'Browser only — not saved to repository':disk!==content?'Repository differs from browser copy':index===content&&changed?'Git staged':index===content?'Saved in repository — no staged change':'Saved in repository — not staged';
 }
 return {files};
}
async function body(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>25e6)throw Error('Request too large.');}return JSON.parse(data||'{}');}
export function createServer(){return http.createServer(async(req,res)=>{try{
 if(req.headers.host!==`127.0.0.1:${port}`)throw Error('Invalid host.');
 if(req.headers.origin&&req.headers.origin!==host)throw Error('Open BlyggerPress from the companion URL to connect.');
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.url==='/api/session'&&req.headers['x-blygger']==='1'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({token,capabilities:['connect','stage','drafts','status']}));return;}
 if(req.url?.startsWith('/api/')){if(req.headers.authorization!==`Bearer ${token}`)throw Error('Session expired. Reload BlyggerPress.');res.setHeader('Content-Type','application/json');
 if(req.method!=='POST')throw Error('Method not allowed.');const data=await body(req);const result=req.url==='/api/connect'?await connect(data):req.url==='/api/stage'?await stage(data):req.url==='/api/drafts'?await saveDrafts(data):req.url==='/api/status'?await repositoryStatus(data):null;if(!result)throw Error('Unknown endpoint.');res.end(JSON.stringify(result));return;}
 if(req.method==='GET'&&(req.url==='/'||req.url==='/index.html')){res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"frame-ancestors 'none'");res.end(await readFile(path.join(appRoot,'dist/index.html')));return;}
 res.writeHead(404);res.end('Not found');
 }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});}
if(process.argv[1]===fileURLToPath(import.meta.url))createServer().listen(port,'127.0.0.1',()=>console.log(`BlyggerPress: ${host}\nAll publishing stages files locally. Commit and push manually.`));
