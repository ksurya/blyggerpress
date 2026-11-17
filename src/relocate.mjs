import {folderPath,projectSettingsPath} from './github.mjs';
import {surface} from './protocol.mjs';
export function relocateWorkspace(blog,target){
 if(blog.folderMove)throw Error('Commit or cancel the current folder change first.');
 const old=blog.remote,folder=folderPath(target.folder);
 if(folder===old.folder)return blog;
 if(folder==='.blyggerpress'||folder.startsWith('.blyggerpress/'))throw Error('Choose a publication folder outside .blyggerpress.');
 if(target.head!==old.head)throw Error('New commits are available. Pull latest before changing folders.');
 if(target.manifest||target.projectSettings||target.drafts.length)throw Error('That folder already belongs to a blyg. Choose a different folder.');
 const oldPrefix=old.folder?old.folder+'/':'',prefix=folder?folder+'/':'';
 const files={...surface(blog.items,blog.settings),...blog.files};
 files['blyg.json']=JSON.stringify({...blog.manifest,...JSON.parse(files['blyg.json'])},null,2)+'\n';
 // Keep immutable pins when copying the publication surface.
 for(const [path,content]of Object.entries(old.files))if(path.startsWith(oldPrefix)&&/^items\/[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}\/v[1-9][0-9]*\.json$/.test(path.slice(oldPrefix.length)))files[path.slice(oldPrefix.length)]=content;
 const existing=new Set(target.entries.map(e=>e.path));
 for(const path of Object.keys(files))if(existing.has(prefix+path))throw Error(`The destination already contains ${prefix+path}. Choose a folder without conflicting files.`);
 const repositoryChanges={};
 for(const path of Object.keys(old.files))if(path.startsWith(old.draftPrefix)||path===projectSettingsPath(old.folder))repositoryChanges[path]=null;
 return {...blog,folderMove:{original:blog},repositoryChanges,files,remote:{...target,files:{...old.files,...target.files}},repository:{...blog.repository,folder}};
}
export function cancelFolderChange(blog){
 if(!blog.folderMove)return blog;
 // Restore paths only, retaining any writing or settings edited since preparation.
 return {...blog,remote:blog.folderMove.original.remote,repository:blog.folderMove.original.repository,folderMove:undefined,repositoryChanges:undefined};
}
