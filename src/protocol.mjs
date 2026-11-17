import {sitePages} from './site.mjs';
import { marked, Renderer } from 'marked';
export const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function originURL(value){const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('Use an HTTP(S) site URL without credentials, query, or fragment.');u.pathname=u.pathname.replace(/\/?$/,'/');return u.href;}
export function newId(){let n=BigInt('0x'+Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join(''));let s='';for(let i=0;i<26;i++){s='0123456789abcdefghjkmnpqrstvwxyz'[Number(n&31n)]+s;n>>=5n;}return s;}
export async function hash(s){return 'sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');}
export function render(md,origin){
 const r=new Renderer();r.html=({text})=>escape(text);
 const url=s=>{try{const u=new URL(s,origin);return ['https:','http:','mailto:'].includes(u.protocol)?escape(u.href):'';}catch{return '';}};
 r.link=function({href,tokens}){const u=url(href);return u?`<a href="${u}" rel="noopener noreferrer">${this.parser.parseInline(tokens)}</a>`:this.parser.parseInline(tokens);};
 r.image=({href,text})=>{const u=url(href);return u?`<img src="${u}" alt="${escape(text)}" loading="lazy">`:escape(text);};
 return marked.parse(md,{renderer:r,async:false});
}
export async function publish({body,kind='thread',note='',previous,origin,author,withdraw=false,generated=false}){
 origin=originURL(origin);body=withdraw?'':body.normalize('NFC');
 if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(body+note+author))throw Error('Text contains characters that cannot be published in XML.');
 if(!withdraw&&!body.trim())throw Error('Write something before publishing.');
 if(/!?\[\[/.test(body))throw Error('Blyg links and transclusions are not supported yet. Use ordinary Markdown links.');
 if(previous&&previous.kind!=='withdrawn'&&kind!==previous.kind&&!withdraw)throw Error('A published item cannot change kind.');
 if(kind==='fragment'&&Array.from(body).length>2000)throw Error('Fragments are limited to 2,000 characters. Use a thread for longer writing.');
 const id=previous?.id||newId(),at=new Date().toISOString(),version=(previous?.version||0)+1;
 const item={blyg:'0.4',id,kind:withdraw?'withdrawn':kind,origin,page:previous?.page||`posts/${id}/`,author:previous?.author||{name:author},created:previous?.created||at,updated:at,version,content_md:body,content_html:withdraw?'':render(body,origin),content_hash:await hash(body),media:[],changelog:[...(previous?.changelog||[]),{version,at,note:note.trim()||null}]};
 if(kind==='thread'||previous?.transclusions)item.transclusions=[];
 if(previous?.forked_from)item.forked_from=previous.forked_from;
 if(generated&&!withdraw){item.generated=[{sources:[],at}];item.content_html=`<div class="blyg-tk-gen">${item.content_html}</div>`;}
 return item;
}
export function excerpt(item){return item.kind==='withdrawn'?'Withdrawn':Array.from(item.content_md.replace(/[#*_`>]/g,'').replace(/\s+/g,' ').trim()).slice(0,100).join('')||'Untitled draft';}
export function surface(items,settings){
 const origin=originURL(settings.origin), sorted=[...items].sort((a,b)=>b.updated.localeCompare(a.updated)), updated=sorted[0]?.updated||new Date().toISOString();
 const files={},json=x=>JSON.stringify(x,null,2)+'\n';
 files['blyg.json']=json({blyg:'0.4',generator:'blyggerpress/0.1.0',site:origin,title:settings.title,author:{name:settings.author},updated});
 files['items/index.json']=json({updated,items:sorted.map(({id,kind,created,updated,version})=>({id,kind,created,updated,version}))});
 const events=sorted.flatMap(item=>(item.kind==='withdrawn'?item.changelog.slice(-1):item.changelog).map(event=>({item,event}))).sort((a,b)=>b.event.at.localeCompare(a.event.at)).slice(0,50);
 files['feed.xml']=`<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:blyg="https://blygger.org/ns/0.1" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>${escape(settings.title)}</title><link>${escape(origin)}</link><description>${escape(settings.title)}</description><lastBuildDate>${new Date(updated).toUTCString()}</lastBuildDate><blyg:manifest>${escape(origin)}blyg.json</blyg:manifest>${events.map(({item:i,event:e})=>`<item><guid isPermaLink="false">blyg:${i.id}:v${e.version}</guid><link>${escape(new URL(i.page,origin).href)}</link><title>${escape(i.kind==='withdrawn'?'withdrawn':(e.note?e.note+' — ':'')+excerpt(i))}</title><description>${escape(i.content_html)}</description><pubDate>${new Date(e.at).toUTCString()}</pubDate><blyg:id>${i.id}</blyg:id><blyg:kind>${i.kind}</blyg:kind><blyg:version>${e.version}</blyg:version><blyg:created>${i.created}</blyg:created><blyg:item>${escape(origin)}items/${i.id}.json</blyg:item>${i.author?.name?`<dc:creator>${escape(i.author.name)}</dc:creator>`:''}</item>`).join('')}</channel></rss>\n`;
 for(const i of sorted)files[`items/${i.id}.json`]=json(i);
 Object.assign(files,sitePages(items,settings));
 return files;
}
export function pin(item){if(item.kind==='withdrawn')throw Error('Withdrawn versions cannot be pinned.');const e=item.changelog.at(-1);const p={blyg:'0.4',id:item.id,kind:item.kind,version:item.version,at:e.at,note:e.note,pinned:true,origin:item.origin,author:item.author,content_md:item.content_md,content_html:item.content_html,content_hash:item.content_hash};for(const k of ['transclusions','generated','stub_of','forked_from'])if(item[k])p[k]=item[k];return p;}
