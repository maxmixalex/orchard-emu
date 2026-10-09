// SPDX-License-Identifier: MIT
import {build} from 'esbuild';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const result=await build({entryPoints:['web/entry.jsx'],bundle:true,format:'esm',target:['es2022'],outfile:'dist/calculator.js',minify:true,metafile:true,legalComments:'eof',define:{'process.env.NODE_ENV':'"production"'}});
// Include notices for every package actually used by the browser bundle.
const packages=[...new Set(Object.keys(result.metafile.inputs).filter(p=>p.includes('node_modules/')).map(p=>{const parts=p.split('node_modules/').at(-1).split('/');return parts[0].startsWith('@')?parts.slice(0,2).join('/'):parts[0];}))].sort();
let notices='Third-party browser dependencies. Original Orchard code is MIT.\n\n';
for(const name of packages){const root=resolve('node_modules',name),info=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
 const names=await readdir(root),file=names.find(n=>/^licen[sc]e(?:\.(?:txt|md))?$/i.test(n));let text;
 if(file)text=await readFile(resolve(root,file),'utf8');
 else if(name==='react-remove-scroll-bar'&&info.version==='2.3.8')text=await readFile('licenses/npm/react-remove-scroll-bar-2.3.8.txt','utf8');
 else throw Error(`Missing license: ${name}@${info.version}`);
 notices+=`===== ${name}@${info.version} (${info.license||'see below'}) =====\n${text}\n\n`;
}
await mkdir('dist/licenses',{recursive:true});await writeFile('dist/licenses/frontend.txt',notices);
console.log(`React frontend bundled; notices for ${packages.length} packages`);
