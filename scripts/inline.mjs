import {readFile,writeFile,rm} from 'node:fs/promises';
let html=await readFile('dist/index.html','utf8');
for(const m of [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g)]) {const js=await readFile('dist/'+m[1].replace(/^\//,''),'utf8');html=html.replace(m[0],()=>`<script type="module">${js.replace(/<\/script/gi,'<\\/script')}</script>`);}
for(const m of [...html.matchAll(/<link[^>]*href="([^"]+\.css)"[^>]*>/g)]) {const css=await readFile('dist/'+m[1].replace(/^\//,''),'utf8');html=html.replace(m[0],()=>`<style>${css}</style>`);}
await writeFile('dist/index.html',html);await rm('dist/assets',{recursive:true,force:true});
console.log('Standalone dist/index.html: '+Math.round(Buffer.byteLength(html)/1024)+' KB');
