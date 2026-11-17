import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';
test('standalone artifact has exactly one valid inline module and no external assets',async()=>{
 const html=await readFile('dist/index.html','utf8');const scripts=[...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];assert.equal(scripts.length,1);assert.ok(!/<script[^>]+src=|<link[^>]+(?:stylesheet|modulepreload)/.test(html));assert.deepEqual(await readdir('dist'),['index.html']);
 const dir=await mkdtemp(path.join(os.tmpdir(),'blygger-bundle-'));try{const file=path.join(dir,'bundle.mjs');await writeFile(file,scripts[0][1]);await promisify(execFile)(process.execPath,['--check',file]);}finally{await rm(dir,{recursive:true,force:true});}
});
