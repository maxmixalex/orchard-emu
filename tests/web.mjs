// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { KEY_ROWS, KEYS, HP48_ROM, shortcut, applySetup, TapQueue } from '../web/hp48.js';
assert.equal(KEY_ROWS.flat().length,51);assert.equal(KEYS.size,51);
assert.equal(shortcut('Enter'),6);assert.equal(shortcut('7'),24);assert.equal(shortcut('x'),undefined);
const events=[],t=new TapQueue((scan,down,tick)=>events.push([scan,down,tick]),10,5);
t.push(26);t.push(5);assert.equal(t.pending,2);t.update(0);assert.equal(t.boundary(0),10);
t.update(9);assert.equal(events.length,1);t.update(10);t.update(14);assert.equal(events.length,2);
t.update(15);t.clear(17);assert.deepEqual(events,[[26,true,0],[26,false,10],[5,true,15],[5,false,17]]);assert.equal(t.pending,0);
assert.throws(()=>t.push(55));for(let i=0;i<32;++i)t.push(6);assert.throws(()=>t.push(6));t.clear(18);
assert.throws(()=>applySetup({},1,'hp48-home'));assert.throws(()=>applySetup({},4,'bogus'));
const {instance:{exports:core}}=await WebAssembly.instantiate(await readFile(new URL('../dist/orchard.wasm',import.meta.url)),{});
assert.equal(core.create(4),0);applySetup(core,4,'hp48-home');core.reset();applySetup(core,4,'hp48-home');
assert.equal(core.sram_alias_reads(),0n);assert.equal(core.lcd_probe68_reads(),0n);
const w=new Worker(new URL('./web-worker-node.mjs',import.meta.url),{type:'module'});
const messages=[],waiters=[];let last;
w.on('message',d=>{messages.push(d);last=d;for(const job of [...waiters])if(job.filter(d)){clearTimeout(job.timer);waiters.splice(waiters.indexOf(job),1);job.resolve(d);}});
function wait(filter,timeout=5000){return new Promise((resolve,reject)=>{const job={filter,resolve,timer:setTimeout(()=>reject(new Error('Worker response timed out: '+JSON.stringify({type:last?.type,ticks:last?.state?.[22],running:last?.running,message:last?.message}))),timeout)};waiters.push(job);});}
async function send(data,filter){const p=wait(filter);w.postMessage(data);return p;}
try{
 await wait(d=>d.type==='ready');
 await send({type:'create',generation:1,model:4,preset:'strict'},d=>d.type==='created'&&d.generation===1);
 const rom=new Uint8Array(0x200000);new DataView(rom.buffer).setUint32(0,0xeafffffe,true); // ARM branch, no HP bytes
 await send({type:'load',generation:1,rom:rom.buffer},d=>d.type==='loaded');
 await send({type:'run',generation:1},d=>d.type==='snapshot'&&d.running);
 const s=await wait(d=>d.type==='snapshot'&&d.state[22]>10000);assert.equal(s.state[28],0);
 const paused=await send({type:'pause',generation:1},d=>d.type==='snapshot'&&!d.running);assert(paused.state[22]>0);
 await new Promise(r=>setTimeout(r,30));
 const stepped=await send({type:'step',generation:1},d=>d.type==='snapshot');assert.equal(stepped.state[22],paused.state[22]+1);
 const reset=await send({type:'reset',generation:1},d=>d.type==='snapshot');assert.equal(reset.state[22],0);assert.equal(reset.pending,0);
 await send({type:'create',generation:2,model:4,preset:'hp48-home'},d=>d.type==='created'&&d.generation===2);
 const rejected=await send({type:'load',generation:2,rom:rom.buffer},d=>d.type==='error');assert.match(rejected.message,/hash/);
 await send({type:'create',generation:3,model:4,preset:'strict'},d=>d.type==='created'&&d.generation===3);
 w.postMessage({type:'run',generation:2});await new Promise(r=>setTimeout(r,20));
 const view=await send({type:'view',generation:3,view:1},d=>d.type==='snapshot'&&d.generation===3&&d.frameView===1);
 assert.equal(view.loaded,false);assert.equal(view.running,false);assert.equal(view.state[22],0);
 await send({type:'load',generation:3,rom:new ArrayBuffer(8)},d=>d.type==='error');
 await send({type:'create',generation:4,model:1,preset:'hp39-home'},d=>d.type==='created'&&d.generation===4);
 const wrong39=new Uint8Array(0x100000);new DataView(wrong39.buffer).setUint32(0,0xeafffffe,true);
 const rejected39=await send({type:'load',generation:4,rom:wrong39.buffer},d=>d.type==='error'&&d.generation===4);assert.match(rejected39.message,/hash/);
 assert.equal(HP48_ROM.length,64);
 console.log('Web: 51 unique keys, virtual tap boundaries/cancellation/pressure, setup ABI, production Worker run/pause/step/reset, stale-generation and ROM-hash rejection pass (Node adapter, not browser E2E).');
}finally{await w.terminate();}
