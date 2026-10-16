import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const result = await build({ entryPoints:['src/studio/app.mjs'], bundle:true, write:false, format:'esm', platform:'browser', target:'es2022', minify:true });
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const template = await readFile('src/studio/index.html','utf8');
await mkdir('dist',{recursive:true});
await writeFile('dist/index.html',template.replace('<script>/* STUDIO_BUNDLE */</script>',() => `<script type="module">${script}</script>`));
console.log('Built dist/index.html');
