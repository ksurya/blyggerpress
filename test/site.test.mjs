import test from 'node:test';
import assert from 'node:assert/strict';
import {sitePages,navigationLinks} from '../src/site.mjs';
const settings={origin:'https://example.com/notes/',title:'My <blyg>',author:'A & B',navigation:'About | about/\nEmail | mailto:hello@example.com',profileImage:'photo.jpg'};
const posts=Array.from({length:25},(_,n)=>({id:String(n),kind:'thread',page:`posts/${n}/`,created:new Date(Date.UTC(2026,0,n+1)).toISOString(),updated:'2026-03-01T00:00:00Z',content_md:`# Post ${n}`,content_html:`<h1>Post ${n}</h1>`,version:1,author:{name:'Author'}}));
test('home has newest 20 by creation, archive has all, withdrawals excluded, nested links and header shared',()=>{
 const files=sitePages([...posts,{...posts[0],id:'withdrawn',page:'posts/withdrawn/',kind:'withdrawn'}],settings);
 assert.equal((files['index.html'].match(/<li>/g)||[]).length,20);
 assert.equal((files['archive/index.html'].match(/<li>/g)||[]).length,25);
 assert.ok(files['index.html'].indexOf('posts/24/')<files['index.html'].indexOf('posts/23/'));
 assert.ok(!files['index.html'].includes('posts/4/'));
 assert.ok(!files['archive/index.html'].includes('posts/withdrawn/'));
 for(const path of ['index.html','archive/index.html','posts/0/index.html']){
 assert.match(files[path],/My &lt;blyg&gt;/);assert.match(files[path],/A &amp; B/);
 assert.match(files[path],/https:\/\/example.com\/notes\/photo.jpg/);
 assert.match(files[path],/href="https:\/\/example.com\/notes\/about\/"/);
 }
 assert.deepEqual(JSON.parse(files['blyggerpress.json']),{navigation:settings.navigation,profileImage:settings.profileImage});
 assert.match(sitePages([],settings)['index.html'],/No posts yet/);
});
test('navigation and profile URLs reject unsafe schemes and report malformed lines',()=>{
 assert.throws(()=>navigationLinks('About',settings.origin),/line 1/);
 assert.throws(()=>navigationLinks('X | javascript:alert(1)',settings.origin));
 assert.throws(()=>sitePages([],{...settings,profileImage:'data:text/html,unsafe'}));
 assert.match(sitePages([],{...settings,navigation:'<img> | /safe'})['index.html'],/&lt;img&gt;/);
});
