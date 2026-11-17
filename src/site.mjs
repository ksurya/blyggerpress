import {escape,originURL,excerpt} from './protocol.mjs';
function safeURL(value,origin,image=false){
 const url=new URL(value,origin);
 if(!(image?['https:','http:']:['https:','http:','mailto:']).includes(url.protocol)||url.username||url.password)throw Error('Use an HTTP(S) or relative URL'+(image?' for the profile picture.':', or mailto: for navigation links.'));
 return url.href;
}
export function navigationLinks(text='',origin){return text.split('\n').flatMap((line,index)=>{
 if(!line.trim())return [];
 const split=line.indexOf('|'),title=line.slice(0,split).trim(),href=line.slice(split+1).trim();
 if(split<0||!title||!href)throw Error(`Navigation line ${index+1}: use Title | link.`);
 return [{title,href:safeURL(href,origin)}];
});}
export function sitePages(items,settings){
 const origin=originURL(settings.origin),navigation=String(settings.navigation||''),profileImage=String(settings.profileImage||'').trim();
 const links=navigationLinks(navigation,origin),photo=profileImage?safeURL(profileImage,origin,true):'';
 const title=i=>i.content_md?.match(/^#{1,6}\s+(.+)$/m)?.[1]||excerpt(i);
 const publicItems=items.filter(i=>i.kind!=='withdrawn').sort((a,b)=>b.created.localeCompare(a.created)||a.id.localeCompare(b.id));
 const css=`*{box-sizing:border-box}body{margin:0;background:#fafbf9;color:#293b38;font:17px/1.7 system-ui,sans-serif}body>header,main,body>footer{max-width:800px;margin:auto;padding:36px 24px}body>header{padding-top:64px;border-bottom:1px solid #dce5df}.identity{display:flex;align-items:center;gap:20px}.avatar{width:80px;height:80px;object-fit:cover;border-radius:50%;flex-shrink:0}.site-title{font-size:32px;line-height:1.2;font-weight:650;text-decoration:none;color:inherit}.author,time,.meta{color:#66766f;font-size:14px}.author{margin:8px 0 0}nav{display:flex;flex-wrap:wrap;gap:12px 24px;margin-top:28px}a{color:#28756c;text-underline-offset:4px}h1{font-size:28px}h2{font-size:22px;line-height:1.4;margin:6px 0 12px}.posts{list-style:none;padding:0}.posts li{padding:24px 0;border-bottom:1px solid #dce5df}.posts p{margin:8px 0}.archive li{display:flex;gap:24px;align-items:baseline}.archive time{white-space:nowrap}img{max-width:100%;height:auto}pre{overflow:auto;padding:16px;background:#eef2ed}blockquote{border-left:3px solid #91b3a4;margin-left:0;padding-left:20px}body>footer{font-size:14px;border-top:1px solid #dce5df}@media(max-width:480px){body>header{padding-top:32px}.site-title{font-size:26px}.avatar{width:60px;height:60px}.archive li{display:block}}`;
 const shell=(heading,body,item)=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="generator" content="BlyggerPress"><title>${escape(heading)} · ${escape(settings.title)}</title><link rel="alternate" type="application/rss+xml" href="${escape(origin)}feed.xml">${item?`<link rel="alternate" type="application/json" href="${escape(origin)}items/${item.id}.json">`:''}<style>${css}</style></head><body><header><div class="identity">${photo?`<img class="avatar" src="${escape(photo)}" alt="${escape(settings.author)}">`:''}<div><a class="site-title" href="${escape(origin)}">${escape(settings.title)}</a><p class="author">${escape(settings.author)}</p></div></div><nav aria-label="Main navigation"><a href="${escape(origin)}">Home</a><a href="${escape(origin)}archive/">Archive</a>${links.map(l=>`<a href="${escape(l.href)}">${escape(l.title)}</a>`).join('')}</nav></header><main>${body}</main><footer><a href="${escape(origin)}feed.xml">RSS feed</a> · ${escape(settings.author)}</footer></body></html>\n`;
 const row=(i,archive=false)=>`<li><time datetime="${escape(i.created)}">${escape(i.created.slice(0,10))}</time>${archive?`<a href="${escape(new URL(i.page,origin).href)}">${escape(title(i))}</a>`:`<h2><a href="${escape(new URL(i.page,origin).href)}">${escape(title(i))}</a></h2><p>${escape(excerpt(i))}</p>`}</li>`;
 const files={
 'blyggerpress.json':JSON.stringify({navigation,profileImage},null,2)+'\n',
 'index.html':shell('Home',`<h1>Latest posts</h1>${publicItems.length?`<ol class="posts">${publicItems.slice(0,20).map(i=>row(i)).join('')}</ol>`:'<p>No posts yet.</p>'}<p><a href="${escape(origin)}archive/">View all posts →</a></p>`),
 'archive/index.html':shell('Archive',`<h1>Archive</h1><p class="meta">${publicItems.length} posts</p><ol class="posts archive">${publicItems.map(i=>row(i,true)).join('')}</ol>`)
 };
 for(const i of items)files[i.page+'index.html']=shell(title(i),`<article>${i.kind==='withdrawn'?'<h1>This post has been withdrawn.</h1>':i.content_html}</article><p class="meta">${escape(i.author?.name||'')} · ${escape(i.updated.slice(0,10))} · v${i.version}</p>`,i);
 return files;
}
