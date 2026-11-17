const pages={posts:['Posts','All'],drafts:['Posts','Drafts'],repository:['Posts','Repository'],withdrawn:['Posts','Withdrawn'],changes:['Changes','All'],settings:['Settings','All']};
export function parseRoute(hash){
 try{
  const parts=hash.replace(/^#\/?/,'').split('/').map(decodeURIComponent);
  if(parts[0]!=='blygs'||!parts[1])return null;
  const [,blogId,section,id,action,preview]=parts;
  if(parts.length===3&&pages[section])return {blogId,page:pages[section][0],tab:pages[section][1],id:null,kind:null,preview:false};
  if(['posts','drafts'].includes(section)&&id&&action==='edit'&&(parts.length===5||parts.length===6&&preview==='preview'))return {blogId,page:'Posts',tab:'All',id,kind:section,preview:preview==='preview'};
 }catch{}
 return null;
}
export function routeHash({blogId,page='Posts',tab='All',id='',kind='drafts',preview=false}){
 const base='#/blygs/'+encodeURIComponent(blogId)+'/';
 if(id)return base+kind+'/'+encodeURIComponent(id)+'/edit'+(preview?'/preview':'');
 const section=page==='Posts'?({All:'posts',Drafts:'drafts',Repository:'repository',Withdrawn:'withdrawn'}[tab]||'posts'):page.toLowerCase();
 return base+section;
}
export function publicPostURL(item){
 try{const url=new URL(item.page,item.origin);return ['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}
}
