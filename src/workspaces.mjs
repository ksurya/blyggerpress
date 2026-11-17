export const storageKey = 'blyggerpress-workspaces-v1';
export function emptyBlog(title = 'My Blyg') {
  return {settings:{title,author:'',origin:''},drafts:[],items:[],files:{},staged:[],manifest:null};
}
export function loadWorkspaces(storage) {
  const saved = JSON.parse(storage.getItem(storageKey) || 'null');
  if (saved?.blogs?.[saved.active]) return integerBlogIds(saved);
  const legacy = JSON.parse(storage.getItem('blyggerpress-v1') || 'null');
  const blog = legacy && Array.isArray(legacy.drafts) && Array.isArray(legacy.items)
    ? {...emptyBlog(), ...legacy} : emptyBlog();
  return integerBlogIds({active:'default', blogs:{default:blog}});
}
export function updateBlog(state, id, update) {
  return {...state, blogs:{...state.blogs, [id]:update(state.blogs[id])}};
}

export function nextBlogId(blogs) {
  let maximum=0n;
  for(const id of Object.keys(blogs))if(/^[1-9][0-9]*$/.test(id)&&BigInt(id)>maximum)maximum=BigInt(id);
  return String(maximum+1n);
}
export function integerBlogIds(state) {
  const blogs={},aliases={...state.aliases};
  for(const [id,blog] of Object.entries(state.blogs))if(/^[1-9][0-9]*$/.test(id))blogs[id]=blog;
  for(const [id,blog] of Object.entries(state.blogs))if(!/^[1-9][0-9]*$/.test(id)){
    const next=nextBlogId(blogs);blogs[next]=blog;aliases[id]=next;
  }
  return {...state,active:aliases[state.active]||state.active,blogs,aliases};
}

// Removing a blyg affects only this browser. Keep an undo copy with the workspace.
export function removeBlog(state,id){
 if(!state.blogs[id])return state;
 const blogs={...state.blogs};delete blogs[id];
 const removedBlogs={...state.removedBlogs,[id]:state.blogs[id]};
 if(!Object.keys(blogs).length)blogs[nextBlogId({...state.blogs,...removedBlogs})]=emptyBlog();
 return {...state,blogs,removedBlogs,active:state.active===id?Object.keys(blogs)[0]:state.active};
}
export function restoreBlog(state,id){
 const blog=state.removedBlogs?.[id];if(!blog)return state;
 const restoredId=state.blogs[id]?nextBlogId({...state.blogs,...state.removedBlogs}):id;
 const removedBlogs={...state.removedBlogs};delete removedBlogs[id];
 return {...state,active:restoredId,blogs:{...state.blogs,[restoredId]:blog},removedBlogs};
}

export function isEmptyWorkspace(blog){
 return !blog.remote&&!blog.repository&&!blog.drafts?.length&&!blog.items?.length&&!Object.keys(blog.files||{}).length&&!blog.settings?.origin&&!blog.settings?.author&&['My blog','My Blyg',''].includes(blog.settings?.title||'');
}
