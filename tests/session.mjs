// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { encodeSession, decodeSession, MAX_SESSION_BYTES } from '../dist/session.js';
// Structural guard for the independently rendered narrow-screen layout.
// This checks the shipped selector contract, not browser layout or click behavior.
const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const css=await readFile(new URL('../dist/calculator.css',import.meta.url),'utf8');
const app=await readFile(new URL('../web/App.jsx',import.meta.url),'utf8');
assert(html.includes('id="root"'));assert(app.includes('accept=".ord,.orchard"'));
assert(css.includes('100dvh'));
const state=Uint8Array.from({length:4096},(_,i)=>i%251);
const meta={model:1,romHash:'a'.repeat(64),preset:'hp39-home',frameView:1,state};
const encoded=await encodeSession(meta), decoded=await decodeSession(encoded.buffer);
assert.deepEqual(decoded.state,state);assert.equal(decoded.romHash,meta.romHash);
for(const data of [null,new ArrayBuffer(0),new ArrayBuffer(MAX_SESSION_BYTES+1),encoded.buffer.slice(0,11),encoded.buffer.slice(0,-1)])await assert.rejects(decodeSession(data));
for(const i of [0,8,11,14,encoded.length-1]){const bad=encoded.slice();bad[i]^=0xff;await assert.rejects(decodeSession(bad.buffer));}
for(const update of [{model:7},{model:4},{preset:'unknown'},{romHash:'no'},{frameView:3},{state:new Uint8Array(600001)}])await assert.rejects(encodeSession({...meta,...update}));
const w=new Worker(new URL('./web-worker-node.mjs',import.meta.url));
const waits=[];let last;
w.on('message',d=>{last=d;for(const a of [...waits])if(a.filter(d)){clearTimeout(a.timer);waits.splice(waits.indexOf(a),1);a.resolve(d);}});
function wait(filter){return new Promise((resolve,reject)=>{const a={filter,resolve,timer:setTimeout(()=>reject(new Error('Session Worker timeout: '+last?.type)),8000)};waits.push(a);});}
async function send(data,filter){const p=wait(filter);w.postMessage(data);return p;}
const message=(type,extra={})=>({type,generation:1,...extra});
try{
 await wait(d=>d.type==='ready');
 await send(message('create',{model:1,preset:'strict',audience:'debug'}),d=>d.type==='created');
 const rom=new Uint8Array(1048576);new DataView(rom.buffer).setUint32(0,0xeafffffe,true);
 await send(message('load',{rom:rom.buffer}),d=>d.type==='loaded');
 await send(message('step'),d=>d.type==='snapshot'&&d.state[22]===1);
 const saved=await send(message('checkpoint-save'),d=>d.type==='checkpoint-saved');
 assert.equal((await decodeSession(saved.file.buffer)).model,1);
 await send(message('step'),d=>d.type==='snapshot'&&d.state[22]===2);
 await send(message('checkpoint-load',{file:saved.file.buffer}),d=>d.type==='checkpoint-restored');
 const restored=await send(message('pause'),d=>d.type==='snapshot'&&!d.running);
 assert.equal(restored.state[22],1);assert.equal(restored.state[20],1);
 // File integrity and exact ROM binding fail without loading partial state.
 const foreign=await encodeSession({...await decodeSession(saved.file.buffer),romHash:'b'.repeat(64)});
 await send(message('checkpoint-load',{file:foreign.buffer}),d=>d.type==='error'&&/different ROM/.test(d.message));
 const after=await send(message('pause'),d=>d.type==='snapshot');assert.deepEqual(after.state,restored.state);
 const broken=saved.file.slice();broken[broken.length-1]^=1;
 await send(message('checkpoint-load',{file:broken.buffer}),d=>d.type==='error'&&/damaged/.test(d.message));
 const unchanged=await send(message('pause'),d=>d.type==='snapshot');assert.deepEqual(unchanged.state,restored.state);
 // An async old-session result must not replace a newly created calculator.
 w.postMessage(message('checkpoint-load',{file:saved.file.buffer}));
 await send({type:'create',generation:2,model:4,preset:'strict'},d=>d.type==='created'&&d.generation===2);
 const fresh=await send({type:'pause',generation:2},d=>d.type==='snapshot'&&d.generation===2);
 assert.equal(fresh.loaded,false);assert.equal(fresh.state[22],0);
 console.log('Session envelope integrity, wrong ROM rejection, Worker save/restore/continued step and stale-generation isolation pass. No ROM is included in the session.');
}finally{await w.terminate();for(const a of waits)clearTimeout(a.timer);}
