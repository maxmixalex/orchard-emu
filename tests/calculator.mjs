// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { CALCULATORS, identifyROM } from '../dist/catalog.js';
const read=name=>readFile(new URL('../dist/'+name,import.meta.url),'utf8');
const html=await read('index.html'),debug=await read('debug.html');
for(const word of ['Boot setup','CPU registers','Instructions','Virtual ticks','SRAM alias','Unverified LCD','UART0','preset','frame-view'])assert(!html.includes(word),word);
assert(html.includes('calculator.js'));assert(html.includes('debug.html'));
assert(debug.includes('CPU registers')&&debug.includes('Boot setup')&&debug.includes('main.js'));
assert(!html.includes('main.js'));
assert.deepEqual(CALCULATORS.map(c=>c.id),[1,4]);
assert(CALCULATORS.every(c=>c.hash.length===64 && c.name && c.help));
for(const b of [null,new ArrayBuffer(8),new ArrayBuffer(1048576)])await assert.rejects(identifyROM(b));
const w=new Worker(new URL('./web-worker-node.mjs',import.meta.url));
let last;const waiters=[];
w.on('message',d=>{last=d;for(const a of [...waiters])if(a.filter(d)){clearTimeout(a.timer);waiters.splice(waiters.indexOf(a),1);a.resolve(d);}});
function wait(filter){return new Promise((resolve,reject)=>{const a={filter,resolve,timer:setTimeout(()=>reject(new Error('Worker timeout: '+last?.type)),5000)};waiters.push(a);});}
async function send(data,filter){const p=wait(filter);w.postMessage(data);return p;}
const noInternals=d=>{for(const k of ['state','preset','events','aliasReads','aliasWrites','lcdReads','reason','frameView'])assert(!(k in d),k);};
try{
 await wait(d=>d.type==='ready');
 const created=await send({type:'create',generation:1,model:4,preset:'strict',audience:'calculator'},d=>d.type==='snapshot');noInternals(created);
 const rom=new Uint8Array(2097152);new DataView(rom.buffer).setUint32(0,0xeafffffe,true);
 await send({type:'load',generation:1,rom:rom.buffer},d=>d.type==='loaded');
 const running=await send({type:'run',generation:1},d=>d.type==='snapshot'&&d.running);noInternals(running);
 assert.equal(running.stopped,false);assert.equal(running.loaded,true);
 const paused=await send({type:'pause',generation:1},d=>d.type==='snapshot'&&!d.running);noInternals(paused);
 assert.equal(paused.pixels.length,131*64);
 const reset=await send({type:'reset',generation:1},d=>d.type==='snapshot');noInternals(reset);
 const dev=await send({type:'create',generation:2,model:4,preset:'strict',audience:'debug'},d=>d.type==='snapshot'&&d.generation===2);
 assert.equal(dev.state.length,33);assert.equal(dev.state[22],0);assert('events' in dev);
 const invalid=await send({type:'create',generation:3,model:4,preset:'strict',audience:'arbitrary'},d=>d.type==='error');assert.match(invalid.message,/audience/);
 console.log('User/debug entrypoints are separate; user snapshots contain no CPU/research metadata. ROM rejection and Worker audience/reset contracts pass. Not browser DOM E2E.');
}finally{await w.terminate();for(const a of waiters)clearTimeout(a.timer);}
