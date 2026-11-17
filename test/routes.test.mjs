import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRoute,routeHash,publicPostURL} from '../src/routes.mjs';
test('list and editor routes retain blyg, filter, identity and preview',()=>{
 for(const tab of ['All','Drafts','Repository','Withdrawn']){
  const route=parseRoute(routeHash({blogId:'my blyg',tab}));assert.equal(route.blogId,'my blyg');assert.equal(route.tab,tab);
 }
 for(const kind of ['posts','drafts'])for(const preview of [true,false]){
  const route=parseRoute(routeHash({blogId:'b',id:'123',kind,preview}));assert.equal(route.id,'123');assert.equal(route.kind,kind);assert.equal(route.preview,preview);
 }
 for(const page of ['Settings','Changes'])assert.equal(parseRoute(routeHash({blogId:'b',page})).page,page);
});
test('invalid hashes are rejected and public URL respects nested origins',()=>{
 for(const hash of ['#hosting-setup','#/blygs/b/bogus','#/blygs/b/posts/1/edit/other','#/blygs/%xx/posts'])assert.equal(parseRoute(hash),null);
 assert.equal(publicPostURL({origin:'https://example.com/notes/',page:'posts/abc/'}),'https://example.com/notes/posts/abc/');
 assert.equal(publicPostURL({origin:'https://example.com',page:'javascript:alert(1)'}),null);
});
