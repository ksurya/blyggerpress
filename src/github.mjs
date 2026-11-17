// All requests go directly to GitHub; tokens never enter workspace data or exports.
export async function github(token,path,body,method){
 if(!token?.trim())throw Error('Add a token in GitHub connection first.');
 let response;try{response=await fetch('https://api.github.com'+path,{method:method||(body?'POST':'GET'),headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token.trim(),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}catch{throw Error('Could not reach GitHub. Check your connection and try again.');}
 const value=response.status===204?{}:await response.json();
 if(!response.ok){const message=response.status===401?'Token is invalid or expired.':response.status===403?'GitHub denied access. Check token permissions, organization approval, or API rate limits.':response.status===404?'Repository or branch not found, or this token cannot access it.':value.message||'GitHub request failed.';throw Object.assign(Error(message),{status:response.status,detail:value.message});}
 return value;
}
export async function testToken(token){const user=await github(token,'/user');return user.login;}
export function repositoryName(input){const value=input.trim().replace(/^https:\/\/github\.com\//,'').replace(/\.git\/?$/,'').replace(/\/$/,'');if(!/^[\w.-]+\/[\w.-]+$/.test(value))throw Error('Use owner/repository or its github.com URL.');return value;}
export function folderPath(input){const path=input.trim().replace(/^\/+|\/+$/g,'');if(path.split('/').some(p=>p==='..'||p==='.'||p==='.git')||/[\\\x00-\x1f]/.test(path)||path.includes('//'))throw Error('Choose a relative repository folder.');return path;}
const enc=s=>s.split('/').map(encodeURIComponent).join('/');
export async function inspectRepository(token,input,branch=''){
 const repo=repositoryName(input),info=await github(token,`/repos/${repo}`);
 if(info.permissions?.push===false)throw Error('Your GitHub account does not have write access to this repository.');
 branch=branch.trim()||info.default_branch||'main';
 let ref;
 try{ref=await github(token,`/repos/${repo}/git/ref/heads/${enc(branch)}`);}catch(e){
  if(e.status!==409&&e.status!==404)throw e;
  const branches=await github(token,`/repos/${repo}/branches?per_page=1`);
  if(!Array.isArray(branches)||branches.length)throw e;
  return {repo,branch,head:null,tree:null,entries:[],folders:[]};
 }
 const commit=await github(token,`/repos/${repo}/git/commits/${ref.object.sha}`);
 const tree=await github(token,`/repos/${repo}/git/trees/${commit.tree.sha}?recursive=1`);
 if(tree.truncated)throw Error('This repository is too large to inspect safely. Choose a smaller repository.');
 return {repo,branch,head:ref.object.sha,tree:commit.tree.sha,entries:tree.tree,folders:tree.tree.filter(e=>e.path==='blyg.json'||e.path.endsWith('/blyg.json')).map(e=>e.path==='blyg.json'?'':e.path.slice(0,-10))};
}
export function projectSettingsPath(folder){return `.blyggerpress/projects/${encodeURIComponent(folder||'_root')}/settings.json`;}
export async function readSnapshot(token,inspected,folder){
 folder=folderPath(folder);const prefix=folder?folder+'/':'';const settingsPath=projectSettingsPath(folder);
 const draftPrefix=`.blyggerpress/drafts/${encodeURIComponent(folder||'_root')}/`;
 const files={};
 for(const entry of inspected.entries){if(entry.type!=='blob')continue;
 if(!(entry.path.startsWith(prefix)&&(/^(blyg.json|blyggerpress.json|feed.xml|index.html|archive\/index.html|items\/.*\.json|posts\/.*\/index.html)$/.test(entry.path.slice(prefix.length)))||entry.path.startsWith(draftPrefix)||entry.path===settingsPath))continue;
 const blob=await github(token,`/repos/${inspected.repo}/git/blobs/${entry.sha}`);
 if(blob.encoding!=='base64')throw Error('Unsupported repository file encoding.');
 const bytes=Uint8Array.from(atob(blob.content.replace(/\s/g,'')),c=>c.charCodeAt(0));files[entry.path]=new TextDecoder().decode(bytes);
 }
 const parse=p=>files[p]?JSON.parse(files[p]):null;
 const manifest=parse(prefix+'blyg.json'),siteSettings=parse(prefix+'blyggerpress.json')||{};
 const projectSettings=parse(settingsPath);
 if(projectSettings&&(!projectSettings.settings||projectSettings.publicationFolder!==folder))throw Error('Project settings do not match this publication folder.');
 if(manifest){for(const [key,expected]of Object.entries({feed:'feed.xml',items:'items/index.json',item:'items/{id}.json',pin:'items/{id}/v{n}.json'}))if(manifest[key]&&manifest[key]!==expected)throw Error('Relocated protocol paths are not supported.');}
 const index=parse(prefix+'items/index.json');if(manifest&&!index)throw Error('Missing items/index.json. Repair this blyg before opening it.');
 const items=(index?.items||[]).map(row=>{if(!/^[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$/.test(row.id))throw Error('Invalid post identifier.');const item=parse(prefix+`items/${row.id}.json`);if(!item||item.id!==row.id||item.version!==row.version||!item.page?.startsWith('posts/')||!item.page.endsWith('/')||item.page.includes('..'))throw Error('Invalid or unsupported post layout.');return item;});
 const drafts=Object.entries(files).filter(([p])=>p.startsWith(draftPrefix)&&p.endsWith('.json')).map(([,v])=>JSON.parse(v));
 return {...inspected,folder,draftPrefix,settingsPath,projectSettings:projectSettings?.settings||null,files,manifest,siteSettings,items,drafts};
}
export function pendingFiles(blog){
 const snap=blog.remote;if(!snap)return {};
 const prefix=snap.folder?snap.folder+'/':'';
 const changes={...blog.repositoryChanges,...Object.fromEntries(Object.entries(blog.files).map(([p,v])=>[prefix+p,v]))};
 if(blog.settings?.origin)changes[projectSettingsPath(snap.folder)]=JSON.stringify({publicationFolder:snap.folder,settings:blog.settings},null,2)+'\n';
 for(const draft of blog.drafts)changes[snap.draftPrefix+draft.id+'.json']=JSON.stringify(draft,null,2)+'\n';
 for(const path of Object.keys(snap.files))if(path.startsWith(snap.draftPrefix)&&!blog.drafts.some(d=>path===snap.draftPrefix+d.id+'.json'))changes[path]=null;
 return Object.fromEntries(Object.entries(changes).filter(([p,v])=>v!==(snap.files[p]??null)));
}
export function conflictPaths(base,latest,changes){return Object.keys(changes).filter(p=>(base[p]??null)!==(latest[p]??null)&&(latest[p]??null)!==changes[p]);}
export async function commitFiles(token,snapshot,changes,message,{branch=false}={}){
 if(!message.trim())throw Error('Enter a commit message.');
 if(!Object.keys(changes).length)throw Error('No changes to commit.');
 for(const [path,value]of Object.entries(changes))if((path===`${snapshot.folder?snapshot.folder+'/':''}index.html`||path===`${snapshot.folder?snapshot.folder+'/':''}archive/index.html`)&&snapshot.files[path]&&snapshot.files[path]!==value&&!snapshot.files[path].includes('<meta name="generator" content="BlyggerPress">'))throw Error(`Existing ${path} is not a generated page. Move or rename it on GitHub first.`);
 if(!snapshot.head){
  if(branch)throw Error('Make the first commit before creating a pull-request branch.');
  const latest=await inspectRepository(token,snapshot.repo,snapshot.branch);
  if(latest.head)throw Error('This repository was initialized elsewhere. Pull latest before committing. Your local changes are kept.');
  // GitHub requires the Contents API to initialize a completely empty repository.
  // Keep bootstrap metadata outside the public output so interrupted setup can be retried.
  const initialized=await github(token,`/repos/${snapshot.repo}/contents/.blyggerpress/README.md`,{
   message:'Initialize BlyggerPress repository',branch:snapshot.branch,
   content:btoa('# BlyggerPress\n\nDrafts and editor metadata live here. Deploy only your chosen publication folder.\n')
  },'PUT');
  if(initialized.commit.parents?.length)throw Error('The repository changed during initialization. Pull latest before committing your pending files.');
  snapshot={...snapshot,head:initialized.commit.sha,tree:initialized.commit.tree.sha};
 }
 const tree=await github(token,`/repos/${snapshot.repo}/git/trees`,{base_tree:snapshot.tree,tree:Object.entries(changes).map(([path,content])=>content===null?{path,mode:'100644',type:'blob',sha:null}:{path,mode:'100644',type:'blob',content})});
 const commit=await github(token,`/repos/${snapshot.repo}/git/commits`,{message,tree:tree.sha,parents:[snapshot.head]});
 if(branch){const name='blyggerpress/'+crypto.randomUUID();await github(token,`/repos/${snapshot.repo}/git/refs`,{ref:'refs/heads/'+name,sha:commit.sha});return {sha:commit.sha,url:`https://github.com/${snapshot.repo}/compare/${encodeURIComponent(snapshot.branch)}...${encodeURIComponent(name)}?expand=1`};}
 try{await github(token,`/repos/${snapshot.repo}/git/refs/heads/${enc(snapshot.branch)}`,{sha:commit.sha,force:false},'PATCH');}catch(e){if(e.status===422||e.status===409)throw Error('The branch changed or is protected. Pull latest, or save to a branch for a pull request. Your local changes are kept.');throw e;}
 return {sha:commit.sha,tree:tree.sha};
}
