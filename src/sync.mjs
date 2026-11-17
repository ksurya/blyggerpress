import {surface} from './protocol.mjs';
import {pendingFiles,conflictPaths,projectSettingsPath} from './github.mjs';
export function pullWorkspace(blog,latest){
 const changes=pendingFiles(blog),prefix=latest.folder?latest.folder+'/':'';
 const generated=p=>p===prefix+'index.html'||p===prefix+'archive/index.html'||p===prefix+'feed.xml'||p===prefix+'items/index.json'||p.startsWith(prefix+'posts/')&&p.endsWith('/index.html');
 const sources=Object.fromEntries(Object.entries(changes).filter(([p])=>!generated(p)));
 const manifestPath=prefix+'blyg.json';
 const metadata=text=>{if(!text)return null;const {updated,...rest}=JSON.parse(text);return JSON.stringify(rest);};
 const localMetadataChanged=Object.hasOwn(sources,manifestPath)&&metadata(sources[manifestPath])!==metadata(blog.remote.files[manifestPath]);
 if(!localMetadataChanged)delete sources[manifestPath];
 const conflicts=conflictPaths(blog.remote.files,latest.files,sources).filter(p=>p!==manifestPath||metadata(latest.files[p])!==metadata(blog.remote.files[p])&&metadata(latest.files[p])!==metadata(sources[p]));
 // Do not overwrite hand-edited generated pages during regeneration.
 for(const p of Object.keys(changes).filter(generated))if((latest.files[p]??null)!==(blog.remote.files[p]??null)&&p.endsWith('index.html')&&latest.files[p]&&!latest.files[p].includes('<meta name="generator" content="BlyggerPress">'))conflicts.push(p);
 if(conflicts.length)throw Error('Changes overlap with another client: '+conflicts.join(', ')+'. Your work is kept. Save to a branch for a pull request.');
 const localItems=blog.items.filter(i=>Object.hasOwn(sources,prefix+'items/'+i.id+'.json'));
 const items=[...localItems,...latest.items.filter(i=>!localItems.some(l=>l.id===i.id))];
 const drafts=[...latest.drafts.filter(d=>!Object.hasOwn(sources,latest.draftPrefix+d.id+'.json')),...blog.drafts.filter(d=>Object.hasOwn(sources,latest.draftPrefix+d.id+'.json'))];
 const settings=Object.hasOwn(sources,projectSettingsPath(latest.folder))||Object.hasOwn(sources,prefix+'blyg.json')||Object.hasOwn(sources,prefix+'blyggerpress.json')?blog.settings:{...blog.settings,title:latest.manifest?.title||blog.settings.title,author:latest.manifest?.author?.name||blog.settings.author,origin:latest.manifest?.site||blog.settings.origin,...latest.siteSettings,...latest.projectSettings};
 const publicationChanged=Object.keys(changes).some(p=>p.startsWith(prefix)&&!p.startsWith(latest.draftPrefix));
 const files=publicationChanged?{...blog.files,...surface(items,settings)}:{};
 if(files['blyg.json'])files['blyg.json']=JSON.stringify({...latest.manifest,...JSON.parse(files['blyg.json'])},null,2)+'\n';
 return {...blog,items,drafts,settings,files,remote:latest,manifest:latest.manifest};
}
